import { describe, expect, it } from 'vitest'
import { defaultAssistant } from './defaults'
import { parseAssistant, serializeAssistant, validateAssistant } from './assistant'

describe('assistant format', () => {
  it('round-trips the portable versioned format', () => {
    const parsed = parseAssistant(serializeAssistant(defaultAssistant))
    expect(parsed.id).toBe(defaultAssistant.id)
    expect(parsed.systemPrompt).toContain('You are Juniper')
  })

  it('rejects executable-looking or malformed imports', () => {
    expect(
      validateAssistant({ format: 'juniper-assistant', version: 1, assistant: { id: 'x' } }),
    ).toBe(false)
    expect(() => parseAssistant('{"format":"juniper-assistant","version":1}')).toThrow()
  })
})
