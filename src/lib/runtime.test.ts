import { describe, expect, it } from 'vitest'
import { defaultAssistant, defaultProvider, qwenModel } from './defaults'
import { streamChat } from './runtime'

describe('deterministic fake provider', () => {
  it('streams a truthful Juniper identity response without a provider', async () => {
    const events: string[] = []
    await streamChat(
      {
        requestId: 'test',
        provider: defaultProvider,
        model: qwenModel,
        messages: [{ role: 'user', content: 'Who are you?' }],
        tools: [],
        generation: defaultAssistant.generation,
      },
      (event) => {
        if (event.delta) events.push(event.delta)
      },
      new AbortController().signal,
    )
    expect(events.join('')).toContain('I’m Juniper')
  })
})
