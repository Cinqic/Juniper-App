import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Markdown } from './markdown'

function renderMarkdown(content: string): HTMLDivElement {
  const container = document.createElement('div')
  act(() => createRoot(container).render(<Markdown content={content} />))
  return container
}

describe('untrusted Markdown rendering', () => {
  it.each([
    'https://example.test/path',
    '/settings',
    '#section',
    'javascript:alert(1)',
    'data:text/html,unsafe',
  ])('renders %s as inert text rather than navigation', (target) => {
    const container = renderMarkdown(`[Open](${target})`)
    expect(container.textContent).toContain(`Open (${target})`)
    expect(container.querySelector('a')).toBeNull()
  })

  it('renders HTML-looking model output only as text', () => {
    const container = renderMarkdown('<img src=x onerror="alert(1)">')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })
})
