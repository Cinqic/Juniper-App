export type Locality = 'local' | 'remote' | 'unknown'
export type ExecutionLocation = 'on-device' | 'local-network' | 'remote' | 'unknown'
export type SupportLevel = 'supported' | 'unsupported' | 'unknown'
export type PermissionDecision = 'allow-once' | 'allow-chat' | 'allow-assistant' | 'deny'
export type PermissionGrantScope = 'chat' | 'assistant'
export type Page =
  | 'chats'
  | 'assistants'
  | 'models'
  | 'tools'
  | 'settings'
  | 'privacy'
  | 'diagnostics'

export type ProviderKind = 'juniper-local' | 'ollama' | 'openai-compatible' | 'llama-cpp'

export interface ProviderCapabilities {
  chat: SupportLevel
  text: SupportLevel
  streaming: SupportLevel
  systemPrompt: SupportLevel
  tools: SupportLevel
  parallelTools: SupportLevel
  thinking: SupportLevel
  structuredOutput: SupportLevel
  images: SupportLevel
  embeddings: SupportLevel
  contextLength?: number
  generationParameters: string[]
}

export interface ProviderProfile {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  locality: Locality
  transportLocation: ExecutionLocation
  apiKeyRef?: string
  enabled: boolean
  status: 'connected' | 'offline' | 'unknown'
  capabilities: ProviderCapabilities
}

export interface ModelProfile {
  id: string
  providerId: string
  modelId: string
  displayName: string
  locality: Locality
  executionLocation: ExecutionLocation
  sourceReference?: string
  family?: string
  architecture?: string
  parameterSize?: string
  fileSizeBytes?: number
  quantization?: string
  format?: string
  license?: string
  template?: string
  compatibilityStatus: 'chat-compatible' | 'not-chat-compatible' | 'unknown'
  metadataSource?: string
  lastInspectedAt?: string
  rawCapabilities?: string[]
  sizeLabel?: string
  contextLength?: number
  status: 'ready' | 'not-found' | 'unknown'
  capabilities: ProviderCapabilities
  description: string
  catalogId?: string
  managedVariantId?: string
}

export interface GenerationOverrides {
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  repetitionPenalty?: number
  maxOutput?: number
  thinking?: ThinkingMode
}

export type ThinkingMode = 'auto' | 'off' | 'on' | 'low' | 'medium' | 'high'

export interface PersonalityControls {
  warmth: number
  directness: number
  playfulness: number
  detail: number
  creativity: number
  formality: number
}

export interface Assistant {
  id: string
  schemaVersion: 2
  name: string
  description: string
  avatar: string
  accent: string
  modelProfileId: string | null
  systemPrompt: string
  personality: PersonalityControls
  responseLength: 'concise' | 'balanced' | 'detailed'
  generation: GenerationOverrides
  toolPolicy: 'safe-automatic' | 'ask' | 'disabled'
  memoryPolicy: 'off' | 'curated'
  welcomeMessage: string
  suggestedPrompts: string[]
  createdAt: string
  updatedAt: string
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'
export type MessagePartType =
  | 'text'
  | 'reasoning'
  | 'attachment'
  | 'tool-call'
  | 'tool-result'
  | 'error'

export interface MessagePart {
  id: string
  type: MessagePartType
  text?: string
  name?: string
  status?: 'success' | 'error' | 'denied' | 'unavailable' | 'unsupported' | 'cancelled'
  metadata?: Record<string, string | number | boolean>
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: MessageRole
  parts: MessagePart[]
  createdAt: string
  modelId?: string
  providerId?: string
  isStreaming?: boolean
  usage?: GenerationUsage
}

export interface Conversation {
  id: string
  title: string
  assistantId: string
  createdAt: string
  updatedAt: string
  privateChat?: boolean
  modelProfileId?: string | null
  messages: ChatMessage[]
}

export interface Memory {
  id: string
  assistantId?: string
  content: string
  source: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface Attachment {
  id: string
  name: string
  sizeBytes: number
  contentType: string
}

export interface AttachmentRecord extends Attachment {
  conversationId: string
}

export interface PermissionGrant {
  id: string
  toolName: string
  scope: PermissionGrantScope
  assistantId: string
  conversationId?: string
  createdAt: string
  updatedAt: string
}

export interface PermissionRequest {
  requestId: string
  callId: string
  toolName: string
  displayName: string
  risk: ToolDefinition['risk']
  assistantId: string
  conversationId: string
}

export interface HostToolContext {
  memories: Memory[]
  conversations: Conversation[]
}

export interface GgufSelection {
  id: string
  name: string
  sizeBytes: number
}

export interface ToolDefinition {
  name: string
  displayName: string
  description: string
  risk:
    | 'automatic-safe'
    | 'user-data-read'
    | 'user-data-write'
    | 'filesystem-read'
    | 'network'
    | 'external-process'
    | 'sensitive'
  enabled: boolean
  schema: Record<string, unknown>
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  accent: string
  fontScale: number
  density: 'comfortable' | 'compact'
  reducedMotion: boolean
  developerMode: boolean
  telemetry: 'off'
  onboardingComplete: boolean
}

export interface AppData {
  assistants: Assistant[]
  models: ModelProfile[]
  providers: ProviderProfile[]
  conversations: Conversation[]
  memories: Memory[]
  attachments: AttachmentRecord[]
  permissions: PermissionGrant[]
  settings: AppSettings
}

export interface ChatRequest {
  requestId: string
  assistantId: string
  conversationId: string
  privateChat: boolean
  provider: ProviderProfile
  model: ModelProfile
  messages: Array<{ role: MessageRole; content: string }>
  tools: ToolDefinition[]
  generation: GenerationOverrides
  permissionGrants: PermissionGrant[]
  hostContext: HostToolContext
  attachments?: Array<{
    id: string
    name: string
    content: string
    sizeBytes?: number
    contentType?: string
  }>
}

export interface DiscoveredModel {
  modelId: string
  displayName: string
  sizeBytes?: number
  modifiedAt?: string
}

export interface ModelInspection {
  modelId: string
  displayName: string
  family?: string
  architecture?: string
  parameterSize?: string
  fileSizeBytes?: number
  quantization?: string
  format?: string
  contextLength?: number
  license?: string
  template?: string
  capabilities: string[]
  metadataSource: string
  rawCapabilities?: string[]
}

export interface ModelPullProgress {
  requestId: string
  status: string
  digest?: string
  completedBytes?: number
  totalBytes?: number
  done?: boolean
  error?: { code: string; message: string }
}

export interface RuntimeLogEntry {
  timestamp: string
  event: string
  code?: string
  providerKind?: string
  modelId?: string
}

export interface ManagedModel {
  catalogId: string
  variantId: string
  fileName: string
  path: string
  sizeBytes: number
  sha256: string
  verified: boolean
  state: 'ready' | 'partial' | 'corrupt'
}

export interface NormalizedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface HostToolResult {
  protocolVersion: 'juniper-tool-protocol-v1'
  callId: string
  name: string
  status: 'success' | 'error' | 'denied' | 'unavailable' | 'unsupported' | 'cancelled'
  result: Record<string, unknown> | null
  error: { code: string; message: string } | null
}

export interface GenerationUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  durationMs?: number
}

export interface ChatStreamEvent {
  requestId: string
  delta?: string
  reasoning?: string
  toolCalls?: NormalizedToolCall[]
  toolResults?: HostToolResult[]
  permissionRequest?: PermissionRequest
  usage?: GenerationUsage
  done?: boolean
  error?: { code: string; message: string }
}
