use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ChatRequest {
    pub request_id: String,
    pub assistant_id: String,
    pub conversation_id: String,
    #[serde(default)]
    pub private_chat: bool,
    pub provider: ProviderProfile,
    pub model: ModelProfile,
    pub messages: Vec<ChatMessage>,
    pub tools: Vec<ToolDefinition>,
    pub generation: GenerationOverrides,
    #[serde(default)]
    pub permission_grants: Vec<PermissionGrant>,
    #[serde(default)]
    pub host_context: HostToolContext,
    #[serde(default)]
    pub attachments: Vec<AttachmentContext>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_url: String,
    pub locality: String,
    #[serde(default = "default_execution_location")]
    pub transport_location: String,
    pub api_key_ref: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ModelProfile {
    pub id: String,
    pub provider_id: String,
    pub model_id: String,
    pub display_name: String,
    #[serde(default)]
    pub catalog_id: Option<String>,
    #[serde(default)]
    pub managed_variant_id: Option<String>,
    #[serde(default = "default_execution_location")]
    pub execution_location: String,
    #[serde(default)]
    pub capabilities: ModelCapabilities,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    #[serde(default)]
    pub generation_parameters: Vec<String>,
    #[serde(default = "default_support_level")]
    pub tools: String,
    #[serde(default = "default_support_level")]
    pub thinking: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GenerationOverrides {
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub top_k: Option<u32>,
    pub min_p: Option<f32>,
    pub repetition_penalty: Option<f32>,
    pub max_output: Option<u32>,
    pub thinking: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub risk: String,
    pub enabled: bool,
    pub schema: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamEvent {
    pub request_id: String,
    pub delta: Option<String>,
    pub reasoning: Option<String>,
    pub tool_calls: Option<Vec<NormalizedToolCall>>,
    pub tool_results: Option<Vec<Value>>,
    pub done: Option<bool>,
    pub usage: Option<Usage>,
    pub error: Option<RuntimeError>,
    pub permission_request: Option<PermissionRequest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GgufSelection {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentContext {
    pub id: String,
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostToolContext {
    #[serde(default)]
    pub memories: Vec<Value>,
    #[serde(default)]
    pub conversations: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PermissionGrant {
    pub id: String,
    pub tool_name: String,
    pub scope: String,
    pub assistant_id: String,
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub request_id: String,
    pub call_id: String,
    pub tool_name: String,
    pub display_name: String,
    pub risk: String,
    pub assistant_id: String,
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub model_id: String,
    pub display_name: String,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInspection {
    pub model_id: String,
    pub display_name: String,
    pub family: Option<String>,
    pub architecture: Option<String>,
    pub parameter_size: Option<String>,
    pub file_size_bytes: Option<u64>,
    pub quantization: Option<String>,
    pub format: Option<String>,
    pub context_length: Option<u64>,
    pub license: Option<String>,
    pub template: Option<String>,
    pub capabilities: Vec<String>,
    pub metadata_source: String,
    pub raw_capabilities: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPullProgress {
    pub request_id: String,
    pub status: String,
    pub digest: Option<String>,
    pub completed_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub done: Option<bool>,
    pub error: Option<RuntimeError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogEntry {
    pub timestamp: String,
    pub event: String,
    pub code: Option<String>,
    pub provider_kind: Option<String>,
    pub model_id: Option<String>,
}

fn default_execution_location() -> String {
    "unknown".into()
}

fn default_support_level() -> String {
    "unknown".into()
}
