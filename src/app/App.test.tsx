import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'

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

    await act(async () => buttonByText(container, 'Privacy center').click())
    expect(container.textContent).toContain('Privacy center')
    expect(container.textContent).toContain('Telemetry')
    expect(container.textContent).toContain('No model selected')

    await act(async () => buttonByText(container, 'Diagnostics').click())
    expect(container.textContent).toContain('Diagnostics')
    expect(container.textContent).toContain('SQLite schema v3')
  })
})
