use crate::commands::Cancellation;
use crate::domain::{ChatRequest, ChatStreamEvent, NormalizedToolCall, RuntimeError, Usage};
use crate::tools;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

pub async fn stream(request: ChatRequest, app: AppHandle, cancellation: Cancellation) {
    let topic = format!("juniper://chat/{}", request.request_id);
    let started = Instant::now();
    let result = stream_openai_compatible(&request, &app, &topic, &cancellation).await;
    let event = match result {
        Ok(()) => ChatStreamEvent {
            request_id: request.request_id,
            delta: None,
            reasoning: None,
            tool_calls: None,
            tool_results: None,
            done: Some(true),
            usage: Some(Usage {
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
                duration_ms: Some(started.elapsed().as_millis() as u64),
            }),
            error: None,
        },
        Err(error) => ChatStreamEvent {
            request_id: request.request_id,
            delta: None,
            reasoning: None,
            tool_calls: None,
            tool_results: None,
            done: Some(true),
            usage: None,
            error: Some(RuntimeError {
                code: error.code,
                message: error.message,
            }),
        },
    };
    let _ = app.emit(&topic, event);
}

struct ProviderError {
    code: String,
    message: String,
}

struct TurnOutcome {
    tool_calls: Vec<NormalizedToolCall>,
}

#[derive(Default)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

async fn stream_openai_compatible(
    request: &ChatRequest,
    app: &AppHandle,
    topic: &str,
    cancellation: &Cancellation,
) -> Result<(), ProviderError> {
    let base = request.provider.base_url.trim_end_matches('/');
    let endpoint = if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    };
    let tools: Vec<Value> = request
        .tools
        .iter()
        .filter(|tool| tool.enabled)
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.schema
                }
            })
        })
        .collect();
    let mut messages: Vec<Value> = request
        .messages
        .iter()
        .map(|message| json!({ "role": message.role, "content": message.content }))
        .collect();

    for round in 0..tools::MAX_TOOL_ROUNDS {
        let outcome = stream_one_turn(
            request,
            &endpoint,
            &messages,
            &tools,
            app,
            topic,
            cancellation,
        )
        .await?;
        if outcome.tool_calls.is_empty() {
            return Ok(());
        }

        let mut assistant_tool_calls = Vec::new();
        let mut host_results = Vec::new();
        for (index, call) in outcome.tool_calls.iter().enumerate() {
            assistant_tool_calls.push(json!({
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": serde_json::to_string(&call.arguments)
                        .unwrap_or_else(|_| "{}".into())
                }
            }));
            host_results.push(tools::execute_call(
                &call.id,
                &call.name,
                &call.arguments,
                round,
                index as u32 + 1,
            ));
        }
        let _ = app.emit(
            topic,
            ChatStreamEvent {
                request_id: request.request_id.clone(),
                delta: None,
                reasoning: None,
                tool_calls: Some(outcome.tool_calls.clone()),
                tool_results: Some(host_results.clone()),
                done: Some(false),
                usage: None,
                error: None,
            },
        );
        messages.push(json!({
            "role": "assistant",
            "content": Value::Null,
            "tool_calls": assistant_tool_calls
        }));
        for (call, result) in outcome.tool_calls.iter().zip(host_results) {
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": result.to_string()
            }));
        }
    }

    Err(ProviderError {
        code: "TOOL_LOOP_LIMIT".into(),
        message: "The model exceeded Juniper's bounded tool loop.".into(),
    })
}

async fn stream_one_turn(
    request: &ChatRequest,
    endpoint: &str,
    messages: &[Value],
    tools: &[Value],
    app: &AppHandle,
    topic: &str,
    cancellation: &Cancellation,
) -> Result<TurnOutcome, ProviderError> {
    let mut body = json!({
        "model": request.model.model_id,
        "messages": messages,
        "stream": true,
        "temperature": request.generation.temperature.unwrap_or(0.7),
        "top_p": request.generation.top_p.unwrap_or(0.9),
        "max_tokens": request.generation.max_output.unwrap_or(2048)
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools.to_vec());
        body["tool_choice"] = json!("auto");
    }
    if request.generation.thinking == Some(false) {
        body["reasoning_effort"] = json!("none");
    }

    let client = Client::new();
    let mut call = client.post(endpoint).json(&body);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if request.provider.locality == "remote" {
        if let Some(reference) = &request.provider.api_key_ref {
            if let Ok(entry) = keyring::Entry::new("com.cinqic.juniper", reference) {
                if let Ok(secret) = entry.get_password() {
                    call = call.bearer_auth(secret);
                }
            }
        }
    }
    let response = call.send().await.map_err(|_| ProviderError {
        code: "PROVIDER_UNREACHABLE".into(),
        message: format!(
            "{} is not responding. Check the provider URL and that it is running.",
            request.provider.name
        ),
    })?;
    if !response.status().is_success() {
        return Err(ProviderError {
            code: "PROVIDER_ERROR".into(),
            message: format!(
                "{} returned HTTP {}.",
                request.provider.name,
                response.status()
            ),
        });
    }

    let mut bytes = response.bytes_stream();
    let mut buffer = String::new();
    let mut pending: BTreeMap<u64, ToolCallAccumulator> = BTreeMap::new();
    let mut stream_done = false;
    while let Some(chunk) = bytes.next().await {
        if cancellation.is_cancelled() {
            return Ok(TurnOutcome { tool_calls: Vec::new() });
        }
        let chunk = chunk.map_err(|_| ProviderError {
            code: "STREAM_ERROR".into(),
            message: "The model stream ended unexpectedly.".into(),
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(index) = buffer.find('\n') {
            let line = buffer.drain(..=index).collect::<String>();
            let line = line.trim();
            if !line.starts_with("data:") {
                continue;
            }
            let raw = line.trim_start_matches("data:").trim();
            if raw == "[DONE]" {
                stream_done = true;
                break;
            }
            if let Ok(value) = serde_json::from_str::<Value>(raw) {
                let choice = &value["choices"][0];
                let delta = choice["delta"]["content"].as_str().map(str::to_owned);
                let reasoning = choice["delta"]["reasoning_content"]
                    .as_str()
                    .map(str::to_owned);
                if delta.is_some() || reasoning.is_some() {
                    let _ = app.emit(
                        topic,
                        ChatStreamEvent {
                            request_id: request.request_id.clone(),
                            delta,
                            reasoning,
                            tool_calls: None,
                            tool_results: None,
                            done: Some(false),
                            usage: None,
                            error: None,
                        },
                    );
                }
                if let Some(calls) = choice["delta"]["tool_calls"].as_array() {
                    for (position, call) in calls.iter().enumerate() {
                        let index = call["index"].as_u64().unwrap_or(position as u64);
                        let entry = pending.entry(index).or_default();
                        if let Some(id) = call["id"].as_str() {
                            entry.id = id.to_owned();
                        }
                        if let Some(name) = call["function"]["name"].as_str() {
                            entry.name = name.to_owned();
                        }
                        if let Some(arguments) = call["function"]["arguments"].as_str() {
                            entry.arguments.push_str(arguments);
                        }
                    }
                }
            }
        }
        if stream_done {
            break;
        }
    }

    let tool_calls = pending
        .into_values()
        .filter_map(|call| {
            if call.id.is_empty() || call.name.is_empty() {
                return None;
            }
            Some(NormalizedToolCall {
                id: call.id,
                name: call.name,
                arguments: serde_json::from_str(&call.arguments).unwrap_or_else(|_| json!({})),
            })
        })
        .collect();
    Ok(TurnOutcome { tool_calls })
}

pub async fn health_check(provider_kind: &str, base_url: &str) -> Result<String, String> {
    let url = if provider_kind == "ollama" {
        format!("{}/api/tags", base_url.trim_end_matches('/'))
    } else {
        format!("{}/models", base_url.trim_end_matches('/'))
    };
    let response = Client::new()
        .get(url)
        .send()
        .await
        .map_err(|_| "Provider is not reachable.".to_owned())?;
    if response.status().is_success() {
        Ok("connected".into())
    } else {
        Err(format!("Provider returned HTTP {}.", response.status()))
    }
}

pub async fn list_models(provider_kind: &str, base_url: &str) -> Result<Vec<String>, String> {
    let url = if provider_kind == "ollama" {
        format!("{}/api/tags", base_url.trim_end_matches('/'))
    } else {
        format!("{}/models", base_url.trim_end_matches('/'))
    };
    let value: Value = Client::new()
        .get(url)
        .send()
        .await
        .map_err(|_| "Provider is not reachable.".to_owned())?
        .json()
        .await
        .map_err(|_| "Provider returned invalid model metadata.".to_owned())?;
    let empty = Vec::new();
    let models = if provider_kind == "ollama" {
        value["models"]
            .as_array()
            .unwrap_or(&empty)
            .iter()
            .filter_map(|model| model["name"].as_str().map(str::to_owned))
            .collect()
    } else {
        value["data"]
            .as_array()
            .unwrap_or(&empty)
            .iter()
            .filter_map(|model| model["id"].as_str().map(str::to_owned))
            .collect()
    };
    Ok(models)
}
