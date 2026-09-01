import type { AppData } from '../types'
import { initialAppData } from './defaults'

const STORAGE_KEY = 'juniper.app-data.v1'

export function loadAppData(): AppData {
  if (typeof localStorage === 'undefined') return initialAppData()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialAppData()
    return normalizeAppData(JSON.parse(raw))
  } catch {
    return initialAppData()
  }
}

export function saveAppData(data: AppData): void {
  if (typeof localStorage === 'undefined') return
  const persistent = {
    ...data,
    conversations: data.conversations.filter((chat) => !chat.privateChat),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistent))
}

export function normalizeAppData(value: unknown): AppData {
  const defaults = initialAppData()
  if (!value || typeof value !== 'object') return defaults
  const parsed = value as Partial<AppData>
  const parsedSettings =
    parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
  const providers = (Array.isArray(parsed.providers) ? parsed.providers : defaults.providers).map(
    (provider) => ({
      ...provider,
      transportLocation:
        provider.transportLocation ?? inferTransportLocation(provider.baseUrl, provider.locality),
      capabilities: {
        ...defaults.providers[0]!.capabilities,
        ...provider.capabilities,
        chat: provider.capabilities?.chat ?? provider.capabilities?.text ?? 'unknown',
      },
    }),
  )
  const models = (Array.isArray(parsed.models) ? parsed.models : defaults.models).map((model) => {
    const provider = providers.find((item) => item.id === model.providerId)
    const executionLocation =
      model.executionLocation ??
      provider?.transportLocation ??
      inferTransportLocation('', model.locality)
    return {
      ...model,
      executionLocation,
      compatibilityStatus:
        model.compatibilityStatus ??
        (model.capabilities?.chat === 'unsupported' ? 'not-chat-compatible' : 'unknown'),
      capabilities: {
        ...defaults.providers[0]!.capabilities,
        ...model.capabilities,
        chat: model.capabilities?.chat ?? model.capabilities?.text ?? 'unknown',
      },
    }
  })
  return {
    ...defaults,
    assistants: (Array.isArray(parsed.assistants) ? parsed.assistants : defaults.assistants).map(
      (assistant) => ({
        ...assistant,
        schemaVersion: 2,
        modelProfileId: assistant.modelProfileId ?? null,
        generation: {
          ...assistant.generation,
          thinking:
            typeof assistant.generation?.thinking === 'boolean'
              ? assistant.generation.thinking
                ? 'on'
                : 'off'
              : (assistant.generation?.thinking ?? 'auto'),
        },
      }),
    ),
    models,
    providers,
    conversations: Array.isArray(parsed.conversations)
      ? parsed.conversations
      : defaults.conversations,
    memories: Array.isArray(parsed.memories) ? parsed.memories : defaults.memories,
    settings: { ...defaults.settings, ...parsedSettings },
  }
}

function inferTransportLocation(baseUrl: string | undefined, locality: string | undefined) {
  if (locality === 'remote') return 'remote' as const
  try {
    const host = baseUrl ? new URL(baseUrl).hostname.toLowerCase() : ''
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'on-device' as const
    if (host.endsWith('.local') || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))
      return 'local-network' as const
  } catch {
    // Fall through to unknown rather than guessing from a malformed endpoint.
  }
  if (locality === 'local') return 'unknown' as const
  return 'unknown' as const
}

export function clearAppData(): void {
  localStorage.removeItem(STORAGE_KEY)
}
