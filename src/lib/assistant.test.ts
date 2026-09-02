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

  it('migrates the v1 thinking flag to the v2 enum', () => {
    const legacy = JSON.parse(serializeAssistant(defaultAssistant))
    legacy.version = 1
    legacy.assistant.schemaVersion = 1
    legacy.assistant.modelProfileId = 'legacy-model'
    legacy.assistant.generation.thinking = true
    const migrated = parseAssistant(JSON.stringify(legacy))
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.generation.thinking).toBe('on')
  })
})
