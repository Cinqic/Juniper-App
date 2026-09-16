import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initialAppData } from '../lib/defaults'
import type { AppData, ProviderProfile } from '../types'

// Exercises the native (Tauri) startup path, which the browser-mode shell tests
// cannot reach because `runningInTauri` is fixed when the runtime module loads.
// rc.31 shipped a blank desktop window: stored state with an enabled Ollama
// provider made startup model discovery throw a ReferenceError inside a React
// state update, which unmounted the whole application.

type InvokeHandler = (command: string, args?: Record<string, unknown>) => unknown
type Invocation = { command: string; args?: Record<string, unknown> }

const ollamaProvider: ProviderProfile = {
  id: 'ollama-local',
  name: 'Ollama on this machine',
  kind: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  locality: 'local',
  transportLocation: 'on-device',
  enabled: true,
  status: 'connected',
  capabilities: initialAppData().providers[0]!.capabilities,
}

function storedStateWithOllama(): AppData {
  const data = initialAppData()
  return {
    ...data,
    settings: { ...data.settings, onboardingComplete: true },
    providers: [ollamaProvider],
    models: [],
  }
}

describe('Juniper native startup', () => {
  let container: HTMLDivElement
  let root: Root
  let commands: string[]
  let invocations: Invocation[]
  let uncaught: unknown[]

  function installTauri(handler: InvokeHandler) {
    commands = []
    invocations = []
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        transformCallback: () => 0,
        invoke: async (command: string, args?: Record<string, unknown>) => {
          commands.push(command)
          invocations.push({ command, args })
          return handler(command, args)
        },
      },
    })
  }

  async function mountApp() {
    const { default: App } = await import('./App')
    container = document.createElement('div')
    document.body.append(container)
    uncaught = []
    await act(async () => {
      root = createRoot(container, { onUncaughtError: (error) => uncaught.push(error) })
      root.render(<App />)
    })
    for (let tick = 0; tick < 10; tick += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })
    }
  }

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  })

  it('stays rendered after discovering models from a stored Ollama provider', async () => {
    installTauri((command) => {
      switch (command) {
        case 'load_app_data':
          return storedStateWithOllama()
        case 'health_check':
          return 'Ollama 0.33.2'
        case 'list_models':
          return [
            { modelId: 'qwen3:8b', displayName: 'qwen3:8b', sizeBytes: 5_225_388_164 },
            { modelId: 'qwen3:0.6b', displayName: 'qwen3:0.6b', sizeBytes: 522_653_767 },
          ]
        default:
          return null
      }
    })

    await mountApp()

    expect(uncaught).toEqual([])
    expect(commands).toContain('list_models')
    expect(container.textContent).toContain('Chats')
    const lastSave = invocations.filter((call) => call.command === 'save_app_data').at(-1)
    const savedModels = JSON.stringify(lastSave?.args ?? {})
    expect(savedModels).toContain('ollama-local:qwen3:8b')
    expect(savedModels).toContain('ollama-local:qwen3:0.6b')
  })

  it('reports frontend readiness to the native host once stored state is hydrated', async () => {
    installTauri(() => null)

    await mountApp()

    expect(uncaught).toEqual([])
    expect(commands).toContain('frontend_ready')
    expect(commands.indexOf('frontend_ready')).toBeGreaterThan(commands.indexOf('load_app_data'))
  })
})
