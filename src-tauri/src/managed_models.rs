use crate::catalog::{self, CatalogEntry, CatalogVariant};
use crate::commands::{AppState, Cancellation};
use crate::device;
use futures_util::StreamExt;
use reqwest::header::{HeaderValue, RANGE};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::time::Duration;

const STORAGE_HEADROOM_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedModel {
    pub catalog_id: String,
    pub variant_id: String,
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub verified: bool,
    pub state: String,
}

pub fn models_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("models");
    fs::create_dir_all(&directory).map_err(|error| format!("MODEL_STORAGE_ERROR: {error}"))?;
    Ok(directory)
}

pub fn list<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<ManagedModel>, String> {
    let directory = models_directory(app)?;
    let entries = catalog::entries()?;
    let inspected = entries
        .iter()
        .map(|entry| inspect_entry(&directory, entry))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(inspected.into_iter().flatten().collect())
}

fn inspect_entry(directory: &Path, entry: &CatalogEntry) -> Result<Option<ManagedModel>, String> {
    let variant = entry
        .variants
        .first()
        .ok_or_else(|| "The catalog entry has no downloadable variant.".to_owned())?;
    let path = final_path(directory, variant)?;
    let partial = partial_path(directory, variant)?;
    if is_symlink(&partial)? {
        fs::remove_file(&partial).map_err(|error| format!("MODEL_STORAGE_ERROR: {error}"))?;
    }
    if path.is_file() {
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        let verified = verify_file(&path, variant)?;
        return Ok(Some(ManagedModel {
            catalog_id: entry.id.clone(),
            variant_id: variant.id.clone(),
            file_name: variant.file_name.clone(),
            path: path.to_string_lossy().into_owned(),
            size_bytes: metadata.len(),
            sha256: variant.sha256.clone(),
            verified,
            state: if verified { "ready" } else { "corrupt" }.into(),
        }));
    }
    if partial.is_file() {
        let metadata = fs::metadata(&partial).map_err(|error| error.to_string())?;
        return Ok(Some(ManagedModel {
            catalog_id: entry.id.clone(),
            variant_id: variant.id.clone(),
            file_name: variant.file_name.clone(),
            path: partial.to_string_lossy().into_owned(),
            size_bytes: metadata.len(),
            sha256: variant.sha256.clone(),
            verified: false,
            state: "partial".into(),
        }));
    }
    Ok(None)
}

pub fn remove<R: Runtime>(app: &AppHandle<R>, catalog_id: &str) -> Result<(), String> {
    let directory = models_directory(app)?;
    let entry = catalog::find(catalog_id)?;
    let variant = entry
        .variants
        .first()
        .ok_or_else(|| "The catalog entry has no downloadable variant.".to_owned())?;
    for path in [
        final_path(&directory, variant)?,
        partial_path(&directory, variant)?,
    ] {
        if path.exists() {
            fs::remove_file(path).map_err(|error| format!("MODEL_REMOVE_ERROR: {error}"))?;
        }
    }
    Ok(())
}

pub fn path_for_catalog<R: Runtime>(
    app: &AppHandle<R>,
    catalog_id: &str,
) -> Result<PathBuf, String> {
    let directory = models_directory(app)?;
    let entry = catalog::find(catalog_id)?;
    let variant = entry
        .variants
        .first()
        .ok_or_else(|| "The catalog entry has no downloadable variant.".to_owned())?;
    let path = final_path(&directory, variant)?;
    if !path.is_file() || !verify_file(&path, variant)? {
        return Err(
            "LOCAL_MODEL_NOT_READY: Download and verify this model before using it.".into(),
        );
    }
    Ok(path)
}

pub async fn download<R: Runtime>(
    app: AppHandle<R>,
    state: &AppState,
    catalog_id: &str,
    request_id: &str,
    cancellation: Cancellation,
) -> Result<(), String> {
    let entry = catalog::find(catalog_id)?;
    let variant = entry
        .variants
        .first()
        .ok_or_else(|| "The catalog entry has no downloadable variant.".to_owned())?;
    if variant.size_bytes > MAX_DOWNLOAD_BYTES {
        return Err(
            "MODEL_TOO_LARGE: This model is larger than Juniper's safe download limit.".into(),
        );
    }
    let directory = models_directory(&app)?;
    let final_file = final_path(&directory, variant)?;
    let partial_file = partial_path(&directory, variant)?;
    if is_symlink(&partial_file)? {
        fs::remove_file(&partial_file).map_err(|error| format!("MODEL_STORAGE_ERROR: {error}"))?;
    }
    let capabilities = device::collect(&directory);
    let required = variant
        .size_bytes
        .saturating_add(STORAGE_HEADROOM_BYTES)
        .max(entry.minimum_storage_bytes);
    if capabilities
        .free_storage_bytes
        .is_some_and(|free| free < required)
    {
        return Err(format!(
            "INSUFFICIENT_STORAGE: Free {} before downloading this model.",
            format_bytes(required)
        ));
    }
    if final_file.is_file() && verify_file(&final_file, variant)? {
        emit_progress(
            &app,
            request_id,
            "ready",
            variant.size_bytes,
            variant.size_bytes,
            None,
        );
        return Ok(());
    }
    let client = reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .user_agent("Juniper/0.2 local model market")
        .build()
        .map_err(|_| {
            "MODEL_DOWNLOAD_ERROR: Juniper could not initialize its download client.".to_owned()
        })?;
    let mut offset = partial_file
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if offset > variant.size_bytes {
        fs::remove_file(&partial_file).map_err(|error| error.to_string())?;
        offset = 0;
    }
    let mut request = client.get(&variant.url);
    if offset > 0 {
        request = request.header(
            RANGE,
            HeaderValue::from_str(&format!("bytes={offset}-"))
                .map_err(|_| "MODEL_DOWNLOAD_ERROR: Invalid resume range.".to_owned())?,
        );
    }
    let response = request
        .send()
        .await
        .map_err(|_| "MODEL_DOWNLOAD_ERROR: The model source did not respond.".to_owned())?;
    let resumed = offset > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    if !response.status().is_success() {
        return Err(format!(
            "MODEL_DOWNLOAD_ERROR: The model source returned {}.",
            response.status()
        ));
    }
    if !resumed {
        offset = 0;
    }
    let mut file = if resumed {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&partial_file)
    } else {
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&partial_file)
    }
    .map_err(|error| format!("MODEL_STORAGE_ERROR: {error}"))?;
    let mut hasher = Sha256::new();
    if resumed {
        hash_existing(&partial_file, &mut hasher)?;
    }
    emit_progress(
        &app,
        request_id,
        "downloading",
        offset,
        variant.size_bytes,
        None,
    );
    let mut completed = offset;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancellation.is_cancelled() {
            emit_progress(
                &app,
                request_id,
                "paused",
                completed,
                variant.size_bytes,
                Some((
                    "MODEL_DOWNLOAD_CANCELLED",
                    "Download paused; you can resume it later.",
                )),
            );
            return Err(
                "MODEL_DOWNLOAD_CANCELLED: Download paused; you can resume it later.".into(),
            );
        }
        let chunk = chunk
            .map_err(|_| "MODEL_DOWNLOAD_ERROR: The connection was interrupted.".to_owned())?;
        completed = completed.saturating_add(chunk.len() as u64);
        if completed > variant.size_bytes {
            return Err(
                "MODEL_DOWNLOAD_ERROR: The source returned more bytes than expected.".into(),
            );
        }
        file.write_all(&chunk)
            .map_err(|error| format!("MODEL_STORAGE_ERROR: {error}"))?;
        hasher.update(&chunk);
        emit_progress(
            &app,
            request_id,
            "downloading",
            completed,
            variant.size_bytes,
            None,
        );
    }
    file.flush()
        .map_err(|error| format!("MODEL_STORAGE_ERROR: {error}"))?;
    if completed != variant.size_bytes {
        return Err(
            "MODEL_DOWNLOAD_ERROR: The download ended before the expected file size.".into(),
        );
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != variant.sha256 {
        let _ = fs::remove_file(&partial_file);
        emit_progress(
            &app,
            request_id,
            "failed",
            completed,
            variant.size_bytes,
            Some((
                "MODEL_CHECKSUM_MISMATCH",
                "The model failed integrity verification and was removed.",
            )),
        );
        return Err(
            "MODEL_CHECKSUM_MISMATCH: The model failed integrity verification and was removed."
                .into(),
        );
    }
    fs::rename(&partial_file, &final_file)
        .map_err(|error| format!("MODEL_INSTALL_ERROR: {error}"))?;
    emit_progress(
        &app,
        request_id,
        "ready",
        completed,
        variant.size_bytes,
        None,
    );
    crate::commands::record_runtime_log(
        state,
        "model.ready",
        None,
        Some("juniper-local"),
        Some(catalog_id),
    );
    Ok(())
}

fn hash_existing(path: &Path, hasher: &mut Sha256) -> Result<(), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let bytes = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if bytes == 0 {
            break;
        }
        hasher.update(&buffer[..bytes]);
    }
    Ok(())
}

fn verify_file(path: &Path, variant: &CatalogVariant) -> Result<bool, String> {
    let link_metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if link_metadata.file_type().is_symlink() || !link_metadata.file_type().is_file() {
        return Ok(false);
    }
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() != variant.size_bytes {
        return Ok(false);
    }
    let mut hasher = Sha256::new();
    hash_existing(path, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()) == variant.sha256)
}

fn is_symlink(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.file_type().is_symlink()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn final_path(directory: &Path, variant: &CatalogVariant) -> Result<PathBuf, String> {
    safe_path(directory, &format!("{}.gguf", variant.id))
}

fn partial_path(directory: &Path, variant: &CatalogVariant) -> Result<PathBuf, String> {
    safe_path(directory, &format!("{}.gguf.part", variant.id))
}

fn safe_path(directory: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || !name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
    {
        return Err("MODEL_PATH_ERROR: The model filename is unsafe.".into());
    }
    Ok(directory.join(name))
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_000_000_000 {
        format!("{:.1} GB", bytes as f64 / 1_000_000_000.0)
    } else {
        format!("{} MB", bytes / 1_000_000)
    }
}

fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    request_id: &str,
    status: &str,
    completed: u64,
    total: u64,
    error: Option<(&str, &str)>,
) {
    let _ = app.emit(
        &format!("juniper://model-download/{request_id}"),
        crate::domain::ModelPullProgress {
            request_id: request_id.into(),
            status: status.into(),
            digest: None,
            completed_bytes: Some(completed),
            total_bytes: Some(total),
            done: Some(matches!(status, "ready" | "failed")),
            error: error.map(|(code, message)| crate::domain::RuntimeError {
                code: code.into(),
                message: message.into(),
            }),
        },
    );
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn variant_for_test(size_bytes: u64, sha256: &str) -> CatalogVariant {
        CatalogVariant {
            id: "test-model-q4".into(),
            file_name: "test-model.gguf".into(),
            quantization: "Q4_K_M".into(),
            size_bytes,
            sha256: sha256.into(),
            url: "https://huggingface.co/test/model/resolve/main/test-model.gguf".into(),
            source_revision: "main".into(),
        }
    }

    #[cfg(unix)]
    #[test]
    fn verification_rejects_symlinks() {
        let root =
            std::env::temp_dir().join(format!("juniper-model-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("test directory should be created");
        let target = root.join("outside.bin");
        let link = root.join("model.gguf");
        fs::write(&target, b"model").expect("test target should be written");
        std::os::unix::fs::symlink(&target, &link).expect("test symlink should be created");
        let digest = format!("{:x}", Sha256::digest(b"model"));
        assert!(
            !verify_file(&link, &variant_for_test(5, &digest)).expect("verification should run")
        );
        fs::remove_file(&link).expect("test symlink should be removable");
        fs::remove_file(&target).expect("test target should be removable");
        fs::remove_dir(&root).expect("test directory should be removable");
    }
}
