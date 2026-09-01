import { describe, expect, it } from 'vitest'
import { defaultAssistant, builtinTools } from './defaults'
import { buildContext } from './context'

describe('context builder', () => {
  it('keeps system instructions, tools, memories, and newest conversation in explicit order', () => {
    const result = buildContext(
      defaultAssistant,
      [
        {
          id: 'm',
          content: 'User likes concise answers.',
          source: 'user',
          enabled: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      [
        {
          id: '1',
          conversationId: 'c',
          role: 'user',
          parts: [{ id: 'p', type: 'text', text: 'old' }],
          createdAt: '',
        },
        {
          id: '2',
          conversationId: 'c',
          role: 'assistant',
          parts: [{ id: 'p2', type: 'text', text: 'new' }],
          createdAt: '',
        },
      ],
      builtinTools,
      4000,
    )
    expect(result.system).toContain('You are Juniper')
    expect(result.tools[0]).toContain('calculator.evaluate')
    expect(result.memory).toEqual(['User likes concise answers.'])
    expect(result.conversation).toEqual(['user: old', 'assistant: new'])
  })

  it('truncates expendable oldest history under a known budget', () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: String(index),
      conversationId: 'c',
      role: 'user' as const,
      parts: [
        { id: `p-${index}`, type: 'text' as const, text: `message ${index} ${'x'.repeat(80)}` },
      ],
      createdAt: '',
    }))
    const result = buildContext(defaultAssistant, [], messages, [], 300)
    expect(result.truncated).toBe(true)
    expect(result.conversation.at(-1)).toContain('message 39')
  })
})
