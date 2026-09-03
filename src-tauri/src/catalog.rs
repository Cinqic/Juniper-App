use serde::{Deserialize, Serialize};

const CATALOG_JSON: &str = include_str!("../../config/models/catalog.json");

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogVariant {
    pub id: String,
    pub file_name: String,
    pub quantization: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub url: String,
    pub source_revision: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub display_name: String,
    pub organization: String,
    pub family: String,
    pub parameter_count: u64,
    pub description: String,
    pub use_cases: Vec<String>,
    pub instruction_tuned: bool,
    pub architecture: String,
    pub format: String,
    pub source_repository: String,
    pub source_revision: String,
    pub original_model: Option<String>,
    pub license: String,
    pub license_url: String,
    pub attribution: String,
    pub chat_template: String,
    pub context_length: u64,
    pub minimum_recommended_ram_bytes: u64,
    pub recommended_ram_bytes: u64,
    pub minimum_storage_bytes: u64,
    pub supported_architectures: Vec<String>,
    pub backend_compatibility: Vec<String>,
    pub tags: Vec<String>,
    pub release_status: String,
    pub variants: Vec<CatalogVariant>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogDocument {
    version: u32,
    minimum_app_version: String,
    models: Vec<CatalogEntry>,
}

pub fn entries() -> Result<Vec<CatalogEntry>, String> {
    let document: CatalogDocument = serde_json::from_str(CATALOG_JSON)
        .map_err(|_| "The bundled model catalog is malformed.".to_owned())?;
    if document.version != 1 || document.minimum_app_version.is_empty() {
        return Err("The bundled model catalog version is unsupported.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for entry in &document.models {
        if entry.id.is_empty()
            || !ids.insert(entry.id.clone())
            || entry.parameter_count == 0
            || entry.variants.is_empty()
            || entry.variants.iter().any(|variant| {
                variant.id.is_empty()
                    || variant.file_name.is_empty()
                    || variant.size_bytes == 0
                    || variant.sha256.len() != 64
                    || !variant.url.starts_with("https://")
                    || !variant.url.contains("huggingface.co/")
                    || variant.file_name.contains('/')
                    || variant.file_name.contains('\\')
            })
        {
            return Err("The bundled model catalog contains invalid metadata.".into());
        }
    }
    Ok(document.models)
}

pub fn find(id: &str) -> Result<CatalogEntry, String> {
    entries()?
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "That model is not in Juniper's trusted catalog.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_catalog_is_small_and_integrity_pinned() {
        let entries = entries().expect("catalog should parse");
        assert_eq!(entries.len(), 4);
        assert!(
            entries
                .iter()
                .all(|entry| entry.parameter_count < 1_000_000_000)
        );
        assert!(
            entries
                .iter()
                .flat_map(|entry| entry.variants.iter())
                .all(|variant| variant
                    .sha256
                    .chars()
                    .all(|character| character.is_ascii_hexdigit()))
        );
    }
}
