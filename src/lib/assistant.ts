import type { Assistant } from '../types'

export const assistantSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['format', 'version', 'assistant'],
  properties: {
    format: { const: 'juniper-assistant' },
    version: { const: 1 },
    assistant: { type: 'object' },
  },
} as const

export function validateAssistant(
  value: unknown,
): value is { format: 'juniper-assistant'; version: 1; assistant: Assistant } {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  const assistant = input.assistant as Record<string, unknown> | undefined
  const requiredStrings = [
    'id',
    'name',
    'description',
    'avatar',
    'accent',
    'modelProfileId',
    'systemPrompt',
    'welcomeMessage',
  ]
  const personality = assistant?.personality as Record<string, unknown> | undefined
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
  return (
    input.format === 'juniper-assistant' &&
    input.version === 1 &&
    !!assistant &&
    assistant.schemaVersion === 1 &&
    requiredStrings.every((key) => typeof assistant[key] === 'string') &&
    ['createdAt', 'updatedAt'].every((key) => typeof assistant[key] === 'string') &&
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
  return JSON.stringify({ format: 'juniper-assistant', version: 1, assistant }, null, 2)
}

export function parseAssistant(text: string): Assistant {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!validateAssistant(value)) throw new Error('This is not a compatible Juniper assistant file.')
  return value.assistant
}
