import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ChatRequest, ChatStreamEvent, ProviderProfile } from '../types'

export const runningInTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function streamChat(
  request: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!runningInTauri) {
    await fakeStream(request, onEvent, signal)
    return
  }
  const topic = `juniper://chat/${request.requestId}`
  const unlisten = await listen<ChatStreamEvent>(topic, (event) => onEvent(event.payload))
  try {
    await invoke('chat_stream', { request })
  } finally {
    unlisten()
  }
}

async function fakeStream(
  request: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const latest = request.messages.at(-1)?.content.toLowerCase() ?? ''
  let answer =
    'I’m ready. Connect Ollama or another provider in Models to have Juniper answer with a real model.'
  if (latest.includes('who are you'))
    answer = `I’m Juniper — the assistant experience you configured, currently using ${request.model.displayName} underneath. This browser preview is local and deterministic until you connect a provider.`
  else if (latest.includes('847291') && latest.includes('19347'))
    answer = 'The host calculator result is **16,392,538,977**.'
  else if (latest.includes('current time') || latest.includes('what time'))
    answer = `The browser preview is running at ${new Date().toLocaleString()}. For an authoritative host time, connect the desktop runtime.`
  const words = answer.split(/(\s+)/)
  for (const word of words) {
    if (signal.aborted) throw new DOMException('Generation cancelled', 'AbortError')
    await new Promise((resolve) => window.setTimeout(resolve, 18))
    onEvent({ requestId: request.requestId, delta: word })
  }
  onEvent({ requestId: request.requestId, done: true, usage: { outputTokens: words.length } })
}

export async function cancelChat(requestId: string): Promise<void> {
  if (runningInTauri) await invoke('cancel_chat', { requestId })
}

export async function checkProviderConnection(provider: ProviderProfile): Promise<string> {
  if (!runningInTauri) throw new Error('Connection checks require the Tauri desktop runtime.')
  return invoke<string>('health_check', { kind: provider.kind, baseUrl: provider.baseUrl })
}

export async function listProviderModels(provider: ProviderProfile): Promise<string[]> {
  if (!runningInTauri) throw new Error('Model discovery requires the Tauri desktop runtime.')
  return invoke<string[]>('list_models', { kind: provider.kind, baseUrl: provider.baseUrl })
}

export async function saveProviderCredential(reference: string, secret: string): Promise<void> {
  if (!runningInTauri) throw new Error('Secure credentials require the Tauri desktop runtime.')
  await invoke('secure_set_credential', { reference, secret })
}

export async function getDiagnostics(): Promise<Record<string, string>> {
  if (runningInTauri) return invoke<Record<string, string>>('system_info')
  return {
    application: 'Juniper 0.1.0-rc.1',
    runtime: 'Browser preview',
    platform: navigator.platform,
    provider: 'Not connected',
  }
}
