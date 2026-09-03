use crate::commands::{AppState, Cancellation, record_runtime_log};
use crate::domain::{ChatRequest, ChatStreamEvent, RuntimeError};
use crate::managed_models;
use crate::providers;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Emitter;
use tauri::{AppHandle, Manager, Runtime};
use tokio::time::{Duration, sleep};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const HEALTH_INTERVAL: Duration = Duration::from_millis(250);

/// Start Juniper's private, loopback-only llama-server for one generation.
///
/// The executable is resolved from the packaged resource directory or the
/// explicit developer override `JUNIPER_LLAMA_SERVER`. Ollama is deliberately
/// not probed or used as a fallback: the lifecycle belongs to Juniper.
pub async fn stream_chat<R: Runtime>(
    app: AppHandle<R>,
    request: ChatRequest,
    cancellation: Cancellation,
    state: &AppState,
) -> Result<(), String> {
    let catalog_id = request
        .model
        .catalog_id
        .clone()
        .unwrap_or_else(|| request.model.model_id.clone());
    let model_path = match managed_models::path_for_catalog(&app, &catalog_id) {
        Ok(path) => path,
        Err(error) => return Err(error),
    };
    let executable = runtime_executable(&app)?;
    let port = reserve_port()?;
    record_runtime_log(
        state,
        "local_runtime.starting",
        None,
        Some("juniper-local"),
        Some(&catalog_id),
    );

    let port_text = port.to_string();
    let model_path_text = model_path.to_string_lossy().into_owned();
    let mut child = tokio::process::Command::new(&executable)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port_text,
            "--model",
            &model_path_text,
            "--alias",
            &catalog_id,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "LOCAL_RUNTIME_UNAVAILABLE: Juniper's bundled local runtime is not available on this build.".to_owned())?;
    let endpoint = format!("http://127.0.0.1:{port}");
    let health = wait_for_health(&endpoint, &mut child, &cancellation).await;
    if let Err(error) = health {
        let _ = child.kill().await;
        let _ = child.wait().await;
        record_runtime_log(
            state,
            "local_runtime.failed",
            Some("LOCAL_RUNTIME_START_FAILED"),
            Some("juniper-local"),
            Some(&catalog_id),
        );
        return Err(error);
    }

    let mut normalized = request;
    normalized.provider.kind = "openai-compatible".into();
    normalized.provider.base_url = endpoint;
    providers::stream(normalized, app.clone(), cancellation.clone(), state).await;
    let _ = child.kill().await;
    let _ = child.wait().await;
    record_runtime_log(
        state,
        "local_runtime.stopped",
        None,
        Some("juniper-local"),
        Some(&catalog_id),
    );
    Ok(())
}

pub fn emit_error<R: Runtime>(app: &AppHandle<R>, request_id: &str, error: &str) {
    let mut pieces = error.splitn(2, ':');
    let code = pieces.next().unwrap_or("LOCAL_RUNTIME_FAILED");
    let message = pieces.next().unwrap_or(error).trim();
    let _ = app.emit(
        &format!("juniper://chat/{request_id}"),
        ChatStreamEvent {
            request_id: request_id.into(),
            delta: None,
            reasoning: None,
            tool_calls: None,
            tool_results: None,
            done: Some(true),
            usage: None,
            error: Some(RuntimeError {
                code: code.into(),
                message: message.into(),
            }),
            permission_request: None,
        },
    );
}

fn runtime_executable<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("JUNIPER_LLAMA_SERVER") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Ok(path);
        }
    }
    let resource = app.path().resource_dir().map_err(|_| {
        "LOCAL_RUNTIME_UNAVAILABLE: Juniper could not locate its runtime resources.".to_owned()
    })?;
    let candidates = [
        resource.join("runtime").join(if cfg!(windows) {
            "llama-server.exe"
        } else {
            "llama-server"
        }),
        resource.join("binaries").join(if cfg!(windows) {
            "llama-server.exe"
        } else {
            "llama-server"
        }),
    ];
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "LOCAL_RUNTIME_UNAVAILABLE: Juniper's bundled local runtime is not available on this build.".into())
}

fn reserve_port() -> Result<u16, String> {
    std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|_| {
            "LOCAL_RUNTIME_PORT_ERROR: Juniper could not reserve a private local port.".to_owned()
        })
        .and_then(|listener| {
            listener
                .local_addr()
                .map(|address| address.port())
                .map_err(|_| {
                    "LOCAL_RUNTIME_PORT_ERROR: Juniper could not inspect the private local port."
                        .into()
                })
        })
}

async fn wait_for_health(
    endpoint: &str,
    child: &mut tokio::process::Child,
    cancellation: &Cancellation,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let started = std::time::Instant::now();
    loop {
        if cancellation.is_cancelled() {
            return Err("REQUEST_CANCELLED: Generation cancelled.".into());
        }
        if child
            .try_wait()
            .map_err(|_| {
                "LOCAL_RUNTIME_FAILED: The local runtime stopped unexpectedly.".to_owned()
            })?
            .is_some()
        {
            return Err(
                "LOCAL_RUNTIME_FAILED: Juniper's local runtime stopped while loading the model."
                    .into(),
            );
        }
        if client
            .get(format!("{endpoint}/health"))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        if started.elapsed() >= STARTUP_TIMEOUT {
            return Err("LOCAL_RUNTIME_TIMEOUT: The local model took too long to start.".into());
        }
        tokio::select! {
            _ = sleep(HEALTH_INTERVAL) => {},
            _ = cancellation.wait() => return Err("REQUEST_CANCELLED: Generation cancelled.".into()),
        }
    }
}
