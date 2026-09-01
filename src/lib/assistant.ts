import type { Assistant } from '../types'

export const assistantSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['format', 'version', 'assistant'],
  properties: {
    format: { const: 'juniper-assistant' },
    version: { enum: [1, 2] },
    assistant: { type: 'object' },
  },
} as const

export function validateAssistant(
  value: unknown,
): value is { format: 'juniper-assistant'; version: 1 | 2; assistant: Partial<Assistant> } {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  const assistant = input.assistant as Record<string, unknown> | undefined
  const requiredStrings = [
    'id',
    'name',
    'description',
    'avatar',
    'accent',
    'systemPrompt',
    'welcomeMessage',
  ]
  const personality = assistant?.personality as Record<string, unknown> | undefined
  const generation = assistant?.generation as Record<string, unknown> | undefined
  const personalityKeys = [
    'warmth',
    'directness',
    'playfulness',
    'detail',
    'creativity',
    'formality',
  ]
  const validPolicies =
    assistant?.responseLength === 'concise' ||
    assistant?.responseLength === 'balanced' ||
    assistant?.responseLength === 'detailed'
  const validToolPolicy =
    assistant?.toolPolicy === 'safe-automatic' ||
    assistant?.toolPolicy === 'ask' ||
    assistant?.toolPolicy === 'disabled'
  const validMemoryPolicy =
    assistant?.memoryPolicy === 'off' || assistant?.memoryPolicy === 'curated'
  const validThinking =
    generation?.thinking === undefined ||
    typeof generation.thinking === 'boolean' ||
    ['auto', 'off', 'on', 'low', 'medium', 'high'].includes(String(generation.thinking))
  return (
    input.format === 'juniper-assistant' &&
    (input.version === 1 || input.version === 2) &&
    !!assistant &&
    (assistant.schemaVersion === 1 || assistant.schemaVersion === 2) &&
    (assistant.modelProfileId === null || typeof assistant.modelProfileId === 'string') &&
    requiredStrings.every((key) => typeof assistant[key] === 'string') &&
    ['createdAt', 'updatedAt'].every((key) => typeof assistant[key] === 'string') &&
    !!generation &&
    validThinking &&
    Array.isArray(assistant.suggestedPrompts) &&
    assistant.suggestedPrompts.every((prompt) => typeof prompt === 'string') &&
    !!personality &&
    personalityKeys.every(
      (key) =>
        typeof personality[key] === 'number' &&
        Number.isFinite(personality[key]) &&
        personality[key] >= 0 &&
        personality[key] <= 100,
    ) &&
    validPolicies &&
    validToolPolicy &&
    validMemoryPolicy
  )
}

export function serializeAssistant(assistant: Assistant): string {
  return JSON.stringify({ format: 'juniper-assistant', version: 2, assistant }, null, 2)
}

function migrateAssistant(value: {
  version: 1 | 2
  assistant: Partial<Assistant> & {
    modelProfileId?: string | null
    generation?: { thinking?: boolean | Assistant['generation']['thinking'] }
  }
}): Assistant {
  const assistant = value.assistant
  return {
    ...(assistant as Assistant),
    schemaVersion: 2,
    modelProfileId: assistant.modelProfileId ?? null,
    generation: {
      ...assistant.generation,
      thinking:
        typeof assistant.generation?.thinking === 'boolean'
          ? assistant.generation.thinking
            ? 'on'
            : 'off'
          : (assistant.generation?.thinking ?? 'auto'),
    },
  }
}

export function parseAssistant(text: string): Assistant {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!validateAssistant(value)) throw new Error('This is not a compatible Juniper assistant file.')
  return migrateAssistant(value)
}
