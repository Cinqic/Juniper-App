use crate::domain::{Attachment, ChatRequest, DiscoveredModel, GgufSelection, ModelInspection};
use crate::{providers, tools};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::{Notify, oneshot};
use uuid::Uuid;

#[derive(Default)]
pub struct AppState {
    pub cancellations: Mutex<HashMap<String, Cancellation>>,
    pub attachments: Mutex<HashMap<String, PathBuf>>,
    pub gguf_files: Mutex<HashMap<String, PathBuf>>,
    pub permission_waiters: Mutex<HashMap<String, oneshot::Sender<String>>>,
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

    pub async fn wait(&self) {
        self.notify.notified().await;
    }
}

#[tauri::command]
pub fn system_info() -> HashMap<String, String> {
    let mut result = HashMap::from([
        (
            String::from("application"),
            String::from("Juniper 0.2.0-rc.1"),
        ),
        (String::from("os"), std::env::consts::OS.to_owned()),
        (
            String::from("architecture"),
            std::env::consts::ARCH.to_owned(),
        ),
        (String::from("runtime"), String::from("Tauri 2 / Rust")),
        (String::from("telemetry"), String::from("Off")),
    ]);
    #[cfg(target_os = "linux")]
    if let Ok(contents) = std::fs::read_to_string("/proc/meminfo")
        && let Some(line) = contents.lines().find(|line| line.starts_with("MemTotal:"))
    {
        result.insert("memory".into(), line.replace("MemTotal:", "").trim().into());
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
pub fn load_app_data(app: AppHandle) -> Result<Option<Value>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("juniper.db");
    crate::storage::load_app_data(&path).map_err(|error| format!("DATABASE_ERROR: {error}"))
}

#[tauri::command]
pub fn save_app_data(app: AppHandle, data: Value) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("juniper.db");
    crate::storage::save_app_data(&path, &data).map_err(|error| format!("DATABASE_ERROR: {error}"))
}

#[tauri::command]
pub async fn health_check(
    kind: String,
    base_url: String,
    api_key_ref: Option<String>,
) -> Result<String, String> {
    providers::health_check(&kind, &base_url, api_key_ref.as_deref()).await
}

#[tauri::command]
pub async fn list_models(
    kind: String,
    base_url: String,
    api_key_ref: Option<String>,
) -> Result<Vec<DiscoveredModel>, String> {
    providers::list_models(&kind, &base_url, api_key_ref.as_deref()).await
}

#[tauri::command]
pub async fn inspect_model(
    kind: String,
    base_url: String,
    model_id: String,
    api_key_ref: Option<String>,
) -> Result<ModelInspection, String> {
    providers::inspect_model(&kind, &base_url, &model_id, api_key_ref.as_deref()).await
}

#[tauri::command]
pub async fn pull_model(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
    base_url: String,
    model_reference: String,
    request_id: String,
    api_key_ref: Option<String>,
) -> Result<(), String> {
    let cancellation = Cancellation::default();
    state
        .cancellations
        .lock()
        .map_err(|_| "Cancellation state unavailable.")?
        .insert(request_id.clone(), cancellation.clone());
    let result = providers::pull_model(
        app,
        &kind,
        &base_url,
        &model_reference,
        &request_id,
        api_key_ref.as_deref(),
        cancellation,
    )
    .await;
    state
        .cancellations
        .lock()
        .map_err(|_| "Cancellation state unavailable.")?
        .remove(&request_id);
    result
}

#[tauri::command]
pub fn cancel_model_pull(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    cancel_chat(state, request_id)
}

#[tauri::command]
pub async fn import_gguf(
    app: AppHandle,
    state: State<'_, AppState>,
    selection_id: String,
    model_name: String,
    request_id: String,
) -> Result<(), String> {
    let model_name = model_name.trim();
    if !valid_model_reference(model_name) {
        return Err("Enter a model name using letters, numbers, '/', ':', '.', '_' or '-'.".into());
    }
    let path = state
        .gguf_files
        .lock()
        .map_err(|_| "GGUF selection state unavailable.")?
        .get(&selection_id)
        .cloned()
        .ok_or_else(|| "This GGUF selection is no longer available.".to_owned())?;
    let path_text = path
        .to_str()
        .filter(|value| !value.chars().any(char::is_control))
        .ok_or_else(|| "The selected GGUF path cannot be represented safely.".to_owned())?;
    let metadata = std::fs::metadata(&path).map_err(|_| "The selected GGUF is unavailable.")?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("The selected GGUF file is no longer a readable regular file.".into());
    }
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("gguf-imports");
    std::fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    let modelfile = cache_dir.join(format!("juniper-{}.Modelfile", Uuid::new_v4()));
    std::fs::write(&modelfile, format!("FROM {path_text}\n"))
        .map_err(|error| format!("Could not prepare the Ollama import: {error}"))?;

    let cancellation = Cancellation::default();
    state
        .cancellations
        .lock()
        .map_err(|_| "Cancellation state unavailable.")?
        .insert(request_id.clone(), cancellation.clone());
    let topic = format!("juniper://gguf-import/{request_id}");
    let result = async {
        let modelfile_text = modelfile
            .to_str()
            .ok_or_else(|| "The temporary Modelfile path is invalid.".to_owned())?;
        let mut child = tokio::process::Command::new("ollama")
            .args(["create", model_name, "-f", modelfile_text])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Ollama could not be started for GGUF import.".to_owned())?;
        let status = tokio::select! {
            status = child.wait() => status.map_err(|error| format!("Ollama import failed: {error}")),
            _ = cancellation.wait() => {
                let _ = child.kill().await;
                emit_gguf_progress(&app, &topic, &request_id, "cancelled", Some("MODEL_IMPORT_CANCELLED"), "GGUF import cancelled.");
                return Err("GGUF import cancelled.".into());
            }
        }?;
        if !status.success() {
            emit_gguf_progress(&app, &topic, &request_id, "error", Some("MODEL_IMPORT_FAILED"), "Ollama could not import the GGUF file.");
            return Err("Ollama could not import the GGUF file.".into());
        }
        emit_gguf_progress(&app, &topic, &request_id, "complete", None, "GGUF import complete.");
        Ok(())
    }
    .await;
    state
        .cancellations
        .lock()
        .map_err(|_| "Cancellation state unavailable.")?
        .remove(&request_id);
    let _ = std::fs::remove_file(modelfile);
    result
}

#[tauri::command]
pub fn cancel_gguf_import(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    cancel_chat(state, request_id)
}

fn valid_model_reference(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | ':' | '.' | '_' | '-')
        })
}

fn emit_gguf_progress(
    app: &AppHandle,
    topic: &str,
    request_id: &str,
    status: &str,
    code: Option<&str>,
    message: &str,
) {
    let _ = app.emit(
        topic,
        crate::domain::ModelPullProgress {
            request_id: request_id.into(),
            status: status.into(),
            digest: None,
            completed_bytes: None,
            total_bytes: None,
            done: Some(true),
            error: code.map(|code| crate::domain::RuntimeError {
                code: code.into(),
                message: message.into(),
            }),
        },
    );
}

#[tauri::command]
pub async fn delete_model(
    kind: String,
    base_url: String,
    model_id: String,
    api_key_ref: Option<String>,
) -> Result<(), String> {
    providers::delete_model(&kind, &base_url, &model_id, api_key_ref.as_deref()).await
}

#[tauri::command]
pub async fn running_models(
    kind: String,
    base_url: String,
    api_key_ref: Option<String>,
) -> Result<Vec<Value>, String> {
    providers::running_models(&kind, &base_url, api_key_ref.as_deref()).await
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
    providers::stream(request.clone(), app, cancellation, state.inner()).await;
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
pub fn resolve_permission(
    state: State<'_, AppState>,
    request_id: String,
    call_id: String,
    decision: String,
) -> Result<(), String> {
    if !matches!(
        decision.as_str(),
        "allow-once" | "allow-chat" | "allow-assistant" | "deny"
    ) {
        return Err("Unknown permission decision.".into());
    }
    let key = format!("{request_id}:{call_id}");
    let sender = state
        .permission_waiters
        .lock()
        .map_err(|_| "Permission state unavailable.")?
        .remove(&key)
        .ok_or_else(|| "This permission request is no longer pending.".to_owned())?;
    sender
        .send(decision)
        .map_err(|_| "The permission request is no longer active.".into())
}

fn register_attachment_path(state: &AppState, path: PathBuf) -> Result<Attachment, String> {
    let metadata = std::fs::metadata(&path).map_err(|_| "The selected file is not available.")?;
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
        "txt", "md", "json", "csv", "toml", "yaml", "yml", "rs", "ts", "tsx", "js", "jsx", "py",
        "css", "html",
    ]
    .into_iter()
    .collect();
    if !allowed.contains(extension.as_str()) {
        return Err("This attachment type is not supported as text in v0.2.".into());
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
pub fn pick_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Attachment>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter(
            "Text files",
            &[
                "txt", "md", "json", "csv", "toml", "yaml", "yml", "rs", "ts", "tsx", "js", "jsx",
                "py", "css", "html",
            ],
        )
        .blocking_pick_file();
    let Some(file) = selected else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| "The selected file path is not available.")?;
    register_attachment_path(state.inner(), path).map(Some)
}

fn register_gguf(state: &AppState, path: PathBuf) -> Result<GgufSelection, String> {
    let metadata = std::fs::metadata(&path).map_err(|_| "The selected file is not available.")?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Only non-empty regular GGUF files can be selected.".into());
    }
    if metadata.len() > 2 * 1024 * 1024 * 1024 * 1024u64 {
        return Err("The selected GGUF file is larger than the supported limit.".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("gguf") {
        return Err("Select a file with the .gguf extension.".into());
    }
    let mut file =
        std::fs::File::open(&path).map_err(|_| "The selected GGUF file is not readable.")?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)
        .map_err(|_| "The selected GGUF file is too short or not readable.")?;
    if &magic != b"GGUF" {
        return Err("The selected file does not have a valid GGUF header.".into());
    }
    let id = Uuid::new_v4().to_string();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("model.gguf")
        .to_owned();
    state
        .gguf_files
        .lock()
        .map_err(|_| "GGUF selection state unavailable.")?
        .insert(id.clone(), path);
    Ok(GgufSelection {
        id,
        name,
        size_bytes: metadata.len(),
    })
}

#[tauri::command]
pub fn pick_gguf(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<GgufSelection>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("GGUF models", &["gguf"])
        .blocking_pick_file();
    let Some(file) = selected else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| "The selected GGUF path is not available.")?;
    register_gguf(state.inner(), path).map(Some)
}

#[tauri::command]
pub fn read_attachment(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<String, String> {
    read_attachment_grant(state.inner(), &attachment_id)
}

fn read_attachment_grant(state: &AppState, attachment_id: &str) -> Result<String, String> {
    let path = state
        .attachments
        .lock()
        .map_err(|_| "Attachment state unavailable.")?
        .get(attachment_id)
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
        credential_entry(&reference)?
            .set_password(&secret)
            .map_err(|_| "Could not save the credential to the system keychain.".into())
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
        match credential_entry(&reference)?.get_password() {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
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
        credential_entry(&reference)?
            .delete_credential()
            .map_err(|_| "Could not remove the credential from the system keychain.".into())
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
pub fn tool_convert(value: f64, from: String, to: String) -> Result<serde_json::Value, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_path(extension: &str) -> PathBuf {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is before the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("juniper-command-test-{suffix}.{extension}"))
    }

    #[test]
    fn attachment_picker_grant_is_opaque_and_reads_only_granted_text() {
        let path = temporary_path("txt");
        std::fs::write(&path, "approved attachment content").expect("fixture should write");
        let state = AppState::default();
        let attachment = register_attachment_path(&state, path.clone()).expect("grant should work");
        assert_eq!(attachment.name, path.file_name().unwrap().to_string_lossy());
        assert_eq!(
            read_attachment_grant(&state, &attachment.id).expect("granted content should read"),
            "approved attachment content"
        );
        assert!(read_attachment_grant(&state, "not-granted").is_err());
        std::fs::remove_file(path).expect("temporary attachment should be removable");
    }

    #[test]
    fn attachment_grant_rejects_unsupported_types_and_oversized_files() {
        let unsupported = temporary_path("bin");
        std::fs::write(&unsupported, b"not text").expect("fixture should write");
        let state = AppState::default();
        let error = register_attachment_path(&state, unsupported.clone())
            .expect_err("unsupported attachment should be rejected");
        assert!(error.contains("not supported"));
        std::fs::remove_file(unsupported).expect("temporary attachment should be removable");

        let oversized = temporary_path("txt");
        std::fs::write(&oversized, vec![b'x'; 1024 * 1024 + 1]).expect("fixture should write");
        let error = register_attachment_path(&state, oversized.clone())
            .expect_err("oversized attachment should be rejected");
        assert!(error.contains("too large"));
        std::fs::remove_file(oversized).expect("temporary attachment should be removable");
    }

    #[test]
    fn gguf_picker_requires_extension_and_magic_header() {
        let invalid = temporary_path("gguf");
        std::fs::write(&invalid, b"NOPE").expect("fixture should write");
        let state = AppState::default();
        let error = register_gguf(&state, invalid.clone()).expect_err("invalid GGUF should fail");
        assert!(error.contains("valid GGUF header"));
        std::fs::remove_file(invalid).expect("temporary GGUF should be removable");

        let valid = temporary_path("gguf");
        std::fs::write(&valid, b"GGUFfixture").expect("fixture should write");
        let selection = register_gguf(&state, valid.clone()).expect("valid GGUF should pass");
        assert_eq!(selection.name, valid.file_name().unwrap().to_string_lossy());
        assert!(state.gguf_files.lock().unwrap().contains_key(&selection.id));
        std::fs::remove_file(valid).expect("temporary GGUF should be removable");
    }

    #[test]
    fn imported_model_reference_is_not_a_shell_fragment() {
        assert!(valid_model_reference("future-model:7b"));
        assert!(!valid_model_reference("library/model@sha256:abc"));
        assert!(!valid_model_reference("model; rm -rf /"));
        assert!(!valid_model_reference("model name"));
        assert!(!valid_model_reference(""));
    }
}
