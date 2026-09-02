import type { Assistant } from '../types'

export const MAX_ASSISTANT_IMPORT_BYTES = 128 * 1024

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

const inputKeys = ['format', 'version', 'assistant'] as const
const assistantKeys = [
  'id',
  'schemaVersion',
  'name',
  'description',
  'avatar',
  'accent',
  'modelProfileId',
  'systemPrompt',
  'personality',
  'responseLength',
  'generation',
  'toolPolicy',
  'memoryPolicy',
  'welcomeMessage',
  'suggestedPrompts',
  'createdAt',
  'updatedAt',
] as const
const personalityKeys = [
  'warmth',
  'directness',
  'playfulness',
  'detail',
  'creativity',
  'formality',
] as const
const generationKeys = [
  'temperature',
  'topP',
  'topK',
  'minP',
  'repetitionPenalty',
  'maxOutput',
  'thinking',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function boundedNumber(value: unknown, min: number, max: number, integer = false): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isInteger(value))
  )
}

function validGeneration(value: unknown, version: 1 | 2): boolean {
  if (!isRecord(value) || !hasExactKeys(value, generationKeys)) return false
  const bounds: Array<[string, number, number, boolean?]> = [
    ['temperature', 0, 2],
    ['topP', 0, 1],
    ['topK', 0, 1_000_000, true],
    ['minP', 0, 1],
    ['repetitionPenalty', 0, 10],
    ['maxOutput', 1, 1_000_000, true],
  ]
  if (
    bounds.some(
      ([key, min, max, integer]) =>
        value[key] !== undefined && !boundedNumber(value[key], min, max, integer),
    )
  ) {
    return false
  }
  if (value.thinking === undefined) return true
  return version === 1
    ? typeof value.thinking === 'boolean'
    : ['auto', 'off', 'on', 'low', 'medium', 'high'].includes(String(value.thinking))
}

function validDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

export function validateAssistant(
  value: unknown,
): value is { format: 'juniper-assistant'; version: 1 | 2; assistant: Partial<Assistant> } {
  if (!isRecord(value) || !hasExactKeys(value, inputKeys)) return false
  if (value.format !== 'juniper-assistant' || (value.version !== 1 && value.version !== 2)) {
    return false
  }
  if (!isRecord(value.assistant) || !hasExactKeys(value.assistant, assistantKeys)) return false
  const assistant = value.assistant
  if (assistant.schemaVersion !== value.version) return false
  if (
    !boundedString(assistant.id, 1, 160) ||
    !boundedString(assistant.name, 1, 80) ||
    !boundedString(assistant.description, 0, 300) ||
    typeof assistant.avatar !== 'string' ||
    Array.from(assistant.avatar).length > 2 ||
    typeof assistant.accent !== 'string' ||
    !/^#[0-9a-fA-F]{6}$/.test(assistant.accent) ||
    !boundedString(assistant.systemPrompt, 0, 20_000) ||
    !boundedString(assistant.welcomeMessage, 0, 500) ||
    !validDateTime(assistant.createdAt) ||
    !validDateTime(assistant.updatedAt)
  ) {
    return false
  }
  if (
    !(
      (value.version === 2 && assistant.modelProfileId === null) ||
      boundedString(assistant.modelProfileId, 1, 256)
    )
  ) {
    return false
  }
  if (!isRecord(assistant.personality) || !hasExactKeys(assistant.personality, personalityKeys)) {
    return false
  }
  if (!personalityKeys.every((key) => boundedNumber(assistant.personality[key], 0, 100))) {
    return false
  }
  if (!validGeneration(assistant.generation, value.version)) return false
  if (
    !['concise', 'balanced', 'detailed'].includes(String(assistant.responseLength)) ||
    !['safe-automatic', 'ask', 'disabled'].includes(String(assistant.toolPolicy)) ||
    !['off', 'curated'].includes(String(assistant.memoryPolicy))
  ) {
    return false
  }
  return (
    Array.isArray(assistant.suggestedPrompts) &&
    assistant.suggestedPrompts.length <= 8 &&
    assistant.suggestedPrompts.every((prompt) => boundedString(prompt, 0, 200))
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
  if (new TextEncoder().encode(text).byteLength > MAX_ASSISTANT_IMPORT_BYTES) {
    throw new Error('This assistant file is too large. The maximum size is 128 KiB.')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!validateAssistant(value)) throw new Error('This is not a compatible Juniper assistant file.')
  return migrateAssistant(value)
}
