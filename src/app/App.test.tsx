import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initialAppData, modelProfileFromDiscovery } from '../lib/defaults'
import App from './App'
import { modelFitLabel } from './pages'

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text),
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`)
  return button
}

describe('Juniper application shell', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    await act(async () => {
      root = createRoot(container)
      root.render(<App />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows zero-model onboarding and a truthful development-preview runtime', () => {
    expect(container.textContent).toContain('Your AI. Your models. Your machine.')
    expect(container.textContent).toContain('No account. No telemetry.')
    expect(container.textContent).toContain('No telemetry')
  })

  it('enters a usable no-model state without a fake production response', async () => {
    await act(async () => buttonByText(container, 'Continue').click())
    await act(async () => buttonByText(container, 'Continue').click())
    await act(async () => buttonByText(container, 'Continue').click())
    await act(async () => buttonByText(container, 'Enter Juniper').click())
    await act(async () => buttonByText(container, 'New chat').click())

    expect(container.textContent).toContain('No model selected')
    expect(container.textContent).toContain('choose one in Models')
  })

  it('keeps model, tool, privacy, and diagnostics surfaces reachable in zero-model mode', async () => {
    await act(async () => buttonByText(container, 'Continue').click())
    await act(async () => buttonByText(container, 'Continue').click())
    await act(async () => buttonByText(container, 'Continue').click())
    await act(async () => buttonByText(container, 'Enter Juniper').click())

    await act(async () => buttonByText(container, 'Models').click())
    expect(container.textContent).toContain('Model library')
    expect(container.textContent).toContain('No models installed yet')
    expect(container.textContent).toContain('UNKNOWN')

    await act(async () => buttonByText(container, 'Tools').click())
    expect(container.textContent).toContain('Permission boundary is active')
    expect(container.textContent).toContain('calculator.evaluate')

    await act(async () => buttonByText(container, 'Settings').click())
    const advancedLinks = container.querySelector('.advanced-links')
    if (!advancedLinks) throw new Error('Advanced settings links not found')
    const privacyLink = buttonByText(advancedLinks, 'Privacy center')
    await act(async () => privacyLink.click())
    expect(container.textContent).toContain('See what stays on this machine')

    await act(async () => buttonByText(container, 'Settings').click())
    const refreshedLinks = container.querySelector('.advanced-links')
    if (!refreshedLinks) throw new Error('Advanced settings links not found')
    const diagnosticsLink = buttonByText(refreshedLinks, 'Diagnostics')
    await act(async () => diagnosticsLink.click())
    expect(container.textContent).toContain('Browser preview (development only)')

    await act(async () => buttonByText(container, 'Privacy center').click())
    expect(container.textContent).toContain('Privacy center')
    expect(container.textContent).toContain('Telemetry')
    expect(container.textContent).toContain('No model selected')
    expect(container.textContent).toContain('Assistant')
    expect(container.textContent).toContain('Provider')
    expect(container.textContent).toContain('Network tools')

    await act(async () => buttonByText(container, 'Diagnostics').click())
    expect(container.textContent).toContain('Diagnostics')
    expect(container.textContent).toContain('Browser preview (development only)')
  })

  it('switches the conversation model without rewriting historical attribution', async () => {
    const data = initialAppData()
    data.settings.onboardingComplete = true
    const provider = data.providers[0]!
    const modelA = modelProfileFromDiscovery(provider, 'future-model-a:7b', {
      displayName: 'Future Model A',
      status: 'ready',
      compatibilityStatus: 'chat-compatible',
    })
    const modelB = modelProfileFromDiscovery(provider, 'future-model-b:7b', {
      displayName: 'Future Model B',
      status: 'ready',
      compatibilityStatus: 'chat-compatible',
    })
    data.models = [modelA, modelB]
    data.assistants[0] = { ...data.assistants[0]!, modelProfileId: modelA.id }
    data.conversations = [
      {
        id: 'chat-model-switch',
        title: 'Model switch',
        assistantId: data.assistants[0]!.id,
        createdAt: '',
        updatedAt: '',
        modelProfileId: modelA.id,
        messages: [
          {
            id: 'historical-assistant-message',
            conversationId: 'chat-model-switch',
            role: 'assistant',
            modelId: modelA.id,
            providerId: provider.id,
            parts: [{ id: 'historical-text', type: 'text', text: 'Answered by model A.' }],
            createdAt: '',
          },
        ],
      },
    ]
    localStorage.setItem('juniper.app-data.v1', JSON.stringify(data))
    act(() => root.unmount())
    await act(async () => {
      root = createRoot(container)
      root.render(<App />)
    })

    const selector = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Conversation model"]',
    )
    if (!selector) throw new Error('Conversation model selector not found')
    await act(async () => {
      selector.value = modelB.id
      selector.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(selector.value).toBe(modelB.id)
    const saved = JSON.parse(localStorage.getItem('juniper.app-data.v1') ?? '{}')
    expect(saved.conversations[0].modelProfileId).toBe(modelB.id)
    expect(saved.conversations[0].messages[0].modelId).toBe(modelA.id)
  })

  it('shows the selected conversation model in the privacy route', async () => {
    const data = initialAppData()
    data.settings.onboardingComplete = true
    const provider = data.providers[0]!
    const modelA = modelProfileFromDiscovery(provider, 'route-model-a', {
      displayName: 'Route Model A',
      status: 'ready',
      compatibilityStatus: 'chat-compatible',
    })
    const modelB = modelProfileFromDiscovery(provider, 'route-model-b', {
      displayName: 'Route Model B',
      status: 'ready',
      compatibilityStatus: 'chat-compatible',
    })
    data.models = [modelA, modelB]
    data.assistants[0] = { ...data.assistants[0]!, modelProfileId: modelA.id }
    data.conversations = [
      {
        id: 'chat-route',
        title: 'Route check',
        assistantId: data.assistants[0]!.id,
        createdAt: '',
        updatedAt: '',
        modelProfileId: modelB.id,
        messages: [],
      },
    ]
    localStorage.setItem('juniper.app-data.v1', JSON.stringify(data))
    act(() => root.unmount())
    await act(async () => {
      root = createRoot(container)
      root.render(<App />)
    })

    await act(async () => buttonByText(container, 'Privacy center').click())
    expect(container.textContent).toContain('Route Model B')
    expect(container.textContent).not.toContain('Route Model A')
  })

  it('does not offer Markdown export for private chats', async () => {
    const data = initialAppData()
    data.settings.onboardingComplete = true
    data.conversations = [
      {
        id: 'private-chat',
        title: 'Private chat',
        assistantId: data.assistants[0]!.id,
        createdAt: '',
        updatedAt: '',
        privateChat: true,
        messages: [],
      },
    ]
    localStorage.setItem('juniper.app-data.v1', JSON.stringify(data))
    act(() => root.unmount())
    await act(async () => {
      root = createRoot(container)
      root.render(<App />)
    })

    const exportButton = buttonByText(container, 'Export')
    expect(exportButton.disabled).toBe(true)
  })

  it('labels model fit as an estimate and stays unknown without runtime data', () => {
    const provider = initialAppData().providers[0]!
    const model = modelProfileFromDiscovery(provider, 'fit-model', { fileSizeBytes: 1024 })
    expect(modelFitLabel(model, null)).toBe('Unknown')
    expect(modelFitLabel(model, '16 GB')).toBe('Excellent')
    expect(modelFitLabel(model, '1 KB')).toBe('Not recommended')
  })
})
