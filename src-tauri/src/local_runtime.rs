use crate::commands::{AppState, Cancellation, record_runtime_log};
use crate::domain::{ChatRequest, ChatStreamEvent, RuntimeError};
use crate::managed_models;
use crate::providers;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::Emitter;
use tauri::{AppHandle, Manager, Runtime};
use tokio::time::{Duration, sleep};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const HEALTH_INTERVAL: Duration = Duration::from_millis(250);

/// `llama-server` children Juniper started and has not yet reaped, by request.
///
/// Tauri ends the process with `std::process::exit`, which runs no destructors,
/// so a generation still streaming when the user quits would otherwise leave
/// its model server running with the model loaded. `terminate_all` runs from
/// the application exit event.
#[derive(Default)]
pub struct RuntimeProcesses(Mutex<HashMap<String, tokio::process::Child>>);

impl RuntimeProcesses {
    fn insert(&self, request_id: &str, child: tokio::process::Child) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "LOCAL_RUNTIME_FAILED: Runtime process state unavailable.".to_owned())?
            .insert(request_id.to_owned(), child);
        Ok(())
    }

    /// Whether the tracked child has exited. An untracked request counts as exited.
    fn exited(&self, request_id: &str) -> Result<bool, String> {
        let mut children = self
            .0
            .lock()
            .map_err(|_| "LOCAL_RUNTIME_FAILED: Runtime process state unavailable.".to_owned())?;
        match children.get_mut(request_id) {
            Some(child) => child
                .try_wait()
                .map(|status| status.is_some())
                .map_err(|_| {
                    "LOCAL_RUNTIME_FAILED: The local runtime stopped unexpectedly.".to_owned()
                }),
            None => Ok(true),
        }
    }

    /// Stops and reaps one tracked child.
    async fn stop(&self, request_id: &str) {
        let child = self
            .0
            .lock()
            .ok()
            .and_then(|mut children| children.remove(request_id));
        if let Some(mut child) = child {
            let _ = child.kill().await;
        }
    }

    /// Signals every tracked child to stop. Synchronous so it can run from the
    /// exit event after the async runtime stops being polled.
    pub fn terminate_all(&self) -> usize {
        let Ok(mut children) = self.0.lock() else {
            return 0;
        };
        let count = children.len();
        for (_, mut child) in children.drain() {
            let _ = child.start_kill();
        }
        count
    }
}

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
    let child = tokio::process::Command::new(&executable)
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
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "LOCAL_RUNTIME_UNAVAILABLE: Juniper's bundled local runtime is not available on this build.".to_owned())?;
    let processes = &state.local_runtimes;
    processes.insert(&request.request_id, child)?;
    let endpoint = format!("http://127.0.0.1:{port}");
    let health = wait_for_health(&endpoint, processes, &request.request_id, &cancellation).await;
    if let Err(error) = health {
        processes.stop(&request.request_id).await;
        record_runtime_log(
            state,
            "local_runtime.failed",
            Some("LOCAL_RUNTIME_START_FAILED"),
            Some("juniper-local"),
            Some(&catalog_id),
        );
        return Err(error);
    }

    let request_id = request.request_id.clone();
    let mut normalized = request;
    normalized.provider.kind = "openai-compatible".into();
    normalized.provider.base_url = endpoint;
    providers::stream(normalized, app.clone(), cancellation.clone(), state).await;
    processes.stop(&request_id).await;
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

pub(crate) fn runtime_executable<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
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
    processes: &RuntimeProcesses,
    request_id: &str,
    cancellation: &Cancellation,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let started = std::time::Instant::now();
    loop {
        if cancellation.is_cancelled() {
            return Err("REQUEST_CANCELLED: Generation cancelled.".into());
        }
        if processes.exited(request_id)? {
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn alive(pid: u32) -> bool {
        // Signal 0 checks existence; a reaped child no longer exists.
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }

    #[test]
    fn exit_cleanup_stops_runtime_children_that_are_still_running() {
        let runtime = tokio::runtime::Runtime::new().expect("test runtime should start");
        runtime.block_on(async {
            let processes = RuntimeProcesses::default();
            let child = tokio::process::Command::new("sleep")
                .arg("60")
                .kill_on_drop(true)
                .spawn()
                .expect("fixture child should start");
            let pid = child.id().expect("running child should have a pid");
            processes
                .insert("request-1", child)
                .expect("child should be tracked");
            assert!(
                !processes
                    .exited("request-1")
                    .expect("state should be readable")
            );
            assert_eq!(processes.terminate_all(), 1);
            assert!(processes.exited("request-1").expect("untracked request"));
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while alive(pid) && std::time::Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert!(
                !alive(pid),
                "the runtime child must not outlive exit cleanup"
            );
            assert_eq!(processes.terminate_all(), 0);
        });
    }

    #[test]
    fn stopping_a_finished_generation_reaps_its_runtime_child() {
        let runtime = tokio::runtime::Runtime::new().expect("test runtime should start");
        runtime.block_on(async {
            let processes = RuntimeProcesses::default();
            let child = tokio::process::Command::new("sleep")
                .arg("60")
                .spawn()
                .expect("fixture child should start");
            let pid = child.id().expect("running child should have a pid");
            processes
                .insert("request-2", child)
                .expect("child should be tracked");
            processes.stop("request-2").await;
            assert!(!alive(pid));
            assert_eq!(processes.terminate_all(), 0);
        });
    }
}
