use crate::domain::{Attachment, ChatRequest};
use crate::{providers, tools};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Notify;
use uuid::Uuid;

#[derive(Default)]
pub struct AppState {
    pub cancellations: Mutex<HashMap<String, Cancellation>>,
    pub attachments: Mutex<HashMap<String, PathBuf>>,
}

#[derive(Clone, Default)]
pub struct Cancellation {
    flag: Arc<Mutex<bool>>,
    notify: Arc<Notify>,
}

impl Cancellation {
    pub fn cancel(&self) {
        if let Ok(mut flag) = self.flag.lock() {
            *flag = true;
        }
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.lock().map(|flag| *flag).unwrap_or(true)
    }
}

#[tauri::command]
pub fn system_info() -> HashMap<String, String> {
    let mut result = HashMap::from([
        (String::from("application"), String::from("Juniper 0.1.0-rc.1")),
        (String::from("os"), std::env::consts::OS.to_owned()),
        (String::from("architecture"), std::env::consts::ARCH.to_owned()),
        (String::from("runtime"), String::from("Tauri 2 / Rust")),
        (String::from("telemetry"), String::from("Off")),
    ]);
    #[cfg(target_os = "linux")]
    if let Ok(contents) = std::fs::read_to_string("/proc/meminfo") {
        if let Some(line) = contents.lines().find(|line| line.starts_with("MemTotal:")) {
            result.insert(
                "memory".into(),
                line.replace("MemTotal:", "").trim().into(),
            );
        }
    }
    result
}

#[tauri::command]
pub fn app_data_directory(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn health_check(kind: String, base_url: String) -> Result<String, String> {
    providers::health_check(&kind, &base_url).await
}

#[tauri::command]
pub async fn list_models(kind: String, base_url: String) -> Result<Vec<String>, String> {
    providers::list_models(&kind, &base_url).await
}

#[tauri::command]
pub async fn chat_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ChatRequest,
) -> Result<(), String> {
    let cancellation = Cancellation::default();
    state
        .cancellations
        .lock()
        .map_err(|_| "Cancellation state unavailable.")?
        .insert(request.request_id.clone(), cancellation.clone());
    providers::stream(request.clone(), app, cancellation).await;
    state
        .cancellations
        .lock()
        .map_err(|_| "Cancellation state unavailable.")?
        .remove(&request.request_id);
    Ok(())
}

#[tauri::command]
pub fn cancel_chat(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    if let Some(cancellation) = state
        .cancellations
        .lock()
        .map_err(|_| "Cancellation state unavailable.")?
        .get(&request_id)
    {
        cancellation.cancel();
    }
    Ok(())
}

#[tauri::command]
pub fn register_attachment(
    state: State<'_, AppState>,
    path: String,
) -> Result<Attachment, String> {
    let path = PathBuf::from(path);
    let metadata = std::fs::metadata(&path)
        .map_err(|_| "The selected file is not available.")?;
    if !metadata.is_file() {
        return Err("Only files can be attached.".into());
    }
    if metadata.len() > 1024 * 1024 {
        return Err("The selected file is too large. Text attachments are limited to 1 MB.".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let allowed: HashSet<&str> = [
        "txt", "md", "json", "csv", "toml", "yaml", "yml", "rs", "ts", "tsx", "js",
        "jsx", "py", "css", "html",
    ]
    .into_iter()
    .collect();
    if !allowed.contains(extension.as_str()) {
        return Err("This attachment type is not supported as text in v0.1.".into());
    }
    let id = Uuid::new_v4().to_string();
    state
        .attachments
        .lock()
        .map_err(|_| "Attachment state unavailable.")?
        .insert(id.clone(), path.clone());
    Ok(Attachment {
        id,
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("attachment")
            .into(),
        size_bytes: metadata.len(),
        content_type: "text/plain".into(),
    })
}

#[tauri::command]
pub fn read_attachment(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<String, String> {
    let path = state
        .attachments
        .lock()
        .map_err(|_| "Attachment state unavailable.")?
        .get(&attachment_id)
        .cloned()
        .ok_or_else(|| "This attachment is no longer granted.".to_owned())?;
    let contents = std::fs::read_to_string(path)
        .map_err(|_| "The selected file could not be decoded as UTF-8 text.".to_owned())?;
    if contents.len() > 1024 * 1024 {
        return Err("The selected file is too large.".into());
    }
    Ok(contents)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn credential_entry(reference: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.cinqic.juniper", reference)
        .map_err(|_| "The system credential store rejected this reference.".into())
}

#[tauri::command]
pub fn secure_set_credential(reference: String, secret: String) -> Result<(), String> {
    if reference.is_empty() || reference.len() > 160 || secret.len() > 8192 {
        return Err("Credential reference or value is outside the allowed limit.".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        return credential_entry(&reference)?
            .set_password(&secret)
            .map_err(|_| "Could not save the credential to the system keychain.".into());
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = secret;
        Err("Secure provider credentials on mobile require a platform vault integration.".into())
    }
}

#[tauri::command]
pub fn secure_has_credential(reference: String) -> Result<bool, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        return match credential_entry(&reference)?.get_password() {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        };
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = reference;
        Ok(false)
    }
}

#[tauri::command]
pub fn secure_delete_credential(reference: String) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        return credential_entry(&reference)?
            .delete_credential()
            .map_err(|_| "Could not remove the credential from the system keychain.".into());
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = reference;
        Ok(())
    }
}

#[tauri::command]
pub fn tool_evaluate(expression: String) -> Result<serde_json::Value, String> {
    tools::evaluate(&expression)
        .map(|value| json!({ "value": value }))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tool_convert(
    value: f64,
    from: String,
    to: String,
) -> Result<serde_json::Value, String> {
    tools::convert(value, &from, &to)
        .map(|result| json!({ "value": result, "from": from, "to": to }))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tool_execute(
    call_id: String,
    name: String,
    arguments: Value,
    round: u32,
    calls_this_round: u32,
) -> Value {
    tools::execute_call(&call_id, &name, &arguments, round, calls_this_round)
}
