import type { AppData, Assistant, Conversation, ModelProfile, ProviderProfile } from '../types'
import { defaultAssistant } from '../lib/defaults'

export function isChatSelectable(model: ModelProfile): boolean {
  return model.status === 'ready' && model.compatibilityStatus !== 'not-chat-compatible'
}

export function labelCapability(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function parseMemoryBytes(value: string | null): number | undefined {
  if (!value) return undefined
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(kb|mb|gb|tb)$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = match[2]?.toLowerCase()
  const multiplier =
    unit === 'kb'
      ? 1024
      : unit === 'mb'
        ? 1024 ** 2
        : unit === 'gb'
          ? 1024 ** 3
          : unit === 'tb'
            ? 1024 ** 4
            : undefined
  return multiplier && Number.isFinite(amount) ? amount * multiplier : undefined
}

export function modelFitLabel(model: ModelProfile, hostMemory: string | null): string {
  const hostBytes = parseMemoryBytes(hostMemory)
  if (!hostBytes || !model.fileSizeBytes || model.fileSizeBytes <= 0) return 'Unknown'
  const estimatedBytes = model.fileSizeBytes * 1.35
  const ratio = estimatedBytes / hostBytes
  if (ratio <= 0.35) return 'Excellent'
  if (ratio <= 0.6) return 'Good'
  if (ratio <= 0.85) return 'May use system RAM'
  if (ratio <= 1) return 'Memory constrained'
  return 'Not recommended'
}

export function modelStatusLabel(model: ModelProfile): string {
  if (model.status === 'not-found') return 'Unavailable'
  if (model.compatibilityStatus === 'not-chat-compatible') return 'Not chat-compatible'
  if (model.compatibilityStatus === 'unknown') return 'Compatibility unknown'
  if (model.catalogId) return 'Downloaded · loads on first chat'
  return 'Ready'
}

export function assistantFor(data: AppData, assistantId: string | undefined): Assistant {
  return (
    data.assistants.find((assistant) => assistant.id === assistantId) ??
    data.assistants[0] ??
    defaultAssistant
  )
}

/** The assistant new chats start with: the saved default, else the first one. */
export function defaultAssistantFor(data: AppData): Assistant {
  return assistantFor(data, data.settings.defaultAssistantId ?? undefined)
}

export interface ConversationRoute {
  assistant: Assistant
  /** The model the next message would use, if it can be used. */
  model?: ModelProfile
  provider?: ProviderProfile
  /** The chat pins a model that is no longer selectable. */
  modelUnavailable: boolean
  /** A model id is referenced (by the chat or assistant) but not selectable. */
  pinnedModel?: ModelProfile
}

/**
 * Resolves which assistant, model, and provider a chat routes to.
 *
 * A chat-level model wins; otherwise the chat's own assistant default is used.
 * `pendingModelId` is the model picked in a new chat before it is saved.
 */
export function resolveRoute(
  data: AppData,
  conversation: Conversation | undefined,
  fallbackAssistant: Assistant,
  pendingModelId?: string | null,
): ConversationRoute {
  const assistant = conversation ? assistantFor(data, conversation.assistantId) : fallbackAssistant
  const chosenId = conversation ? conversation.modelProfileId : pendingModelId
  if (chosenId) {
    const pinned = data.models.find((model) => model.id === chosenId)
    const usable = pinned && isChatSelectable(pinned) ? pinned : undefined
    return {
      assistant,
      model: usable,
      provider: usable
        ? data.providers.find((provider) => provider.id === usable.providerId)
        : undefined,
      modelUnavailable: !usable,
      pinnedModel: pinned,
    }
  }
  const model = data.models.find(
    (item) => item.id === assistant.modelProfileId && isChatSelectable(item),
  )
  return {
    assistant,
    model,
    provider: model
      ? data.providers.find((provider) => provider.id === model.providerId)
      : undefined,
    modelUnavailable: false,
  }
}
