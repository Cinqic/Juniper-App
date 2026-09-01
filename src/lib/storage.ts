import type { AppData } from '../types'
import { initialAppData } from './defaults'

const STORAGE_KEY = 'juniper.app-data.v1'

export function loadAppData(): AppData {
  if (typeof localStorage === 'undefined') return initialAppData()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialAppData()
    const parsed = JSON.parse(raw) as Partial<AppData>
    const defaults = initialAppData()
    const parsedSettings =
      parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
    return {
      ...defaults,
      assistants: Array.isArray(parsed.assistants) ? parsed.assistants : defaults.assistants,
      models: Array.isArray(parsed.models) ? parsed.models : defaults.models,
      providers: Array.isArray(parsed.providers) ? parsed.providers : defaults.providers,
      conversations: Array.isArray(parsed.conversations)
        ? parsed.conversations
        : defaults.conversations,
      memories: Array.isArray(parsed.memories) ? parsed.memories : defaults.memories,
      settings: { ...defaults.settings, ...parsedSettings },
    }
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

export function clearAppData(): void {
  localStorage.removeItem(STORAGE_KEY)
}
