export type Locality = 'local' | 'remote' | 'unknown'
export type SupportLevel = 'supported' | 'unsupported' | 'unknown'
export type Page =
  | 'chats'
  | 'assistants'
  | 'models'
  | 'tools'
  | 'settings'
  | 'privacy'
  | 'diagnostics'

export type ProviderKind = 'ollama' | 'openai-compatible' | 'llama-cpp' | 'fake'

export interface ProviderCapabilities {
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
  sizeLabel?: string
  contextLength?: number
  status: 'ready' | 'not-found' | 'unknown'
  capabilities: ProviderCapabilities
  description: string
}

export interface GenerationOverrides {
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  repetitionPenalty?: number
  maxOutput?: number
  thinking?: boolean
}

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
  schemaVersion: 1
  name: string
  description: string
  avatar: string
  accent: string
  modelProfileId: string
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
}

export interface Conversation {
  id: string
  title: string
  assistantId: string
  createdAt: string
  updatedAt: string
  privateChat?: boolean
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
  settings: AppSettings
}

export interface ChatRequest {
  requestId: string
  provider: ProviderProfile
  model: ModelProfile
  messages: Array<{ role: MessageRole; content: string }>
  tools: ToolDefinition[]
  generation: GenerationOverrides
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
  usage?: GenerationUsage
  done?: boolean
  error?: { code: string; message: string }
}
