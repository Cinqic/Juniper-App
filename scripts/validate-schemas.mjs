import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv/dist/2020.js'

const root = new globalThis.URL('../schemas/', import.meta.url)
const rootPath = fileURLToPath(root)
const dirs = await readdir(root, { withFileTypes: true })
let checked = 0
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false })
const validators = new Map()
for (const dir of dirs) {
  if (!dir.isDirectory()) continue
  const files = await readdir(new globalThis.URL(`${dir.name}/`, root))
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const raw = await readFile(join(rootPath, dir.name, file), 'utf8')
    const schema = JSON.parse(raw)
    validators.set(file, ajv.compile(schema))
    checked += 1
  }
}

const assistant = {
  id: 'assistant-juniper',
  schemaVersion: 2,
  name: 'Juniper',
  description: 'Test assistant',
  avatar: 'J',
  accent: '#6f8f72',
  modelProfileId: null,
  systemPrompt: 'You are Juniper.',
  personality: {
    warmth: 78,
    directness: 72,
    playfulness: 32,
    detail: 52,
    creativity: 48,
    formality: 34,
  },
  responseLength: 'balanced',
  generation: { thinking: 'auto' },
  toolPolicy: 'ask',
  memoryPolicy: 'curated',
  welcomeMessage: 'Hello',
  suggestedPrompts: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}
const fixtures = new Map([
  ['juniper-assistant.v2.schema.json', { format: 'juniper-assistant', version: 2, assistant }],
  [
    'provider-profile.v1.schema.json',
    {
      id: 'ollama-local',
      name: 'Ollama',
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      locality: 'local',
      enabled: true,
    },
  ],
  [
    'juniper-tool-call.v1.schema.json',
    {
      protocolVersion: 'juniper-tool-protocol-v1',
      id: 'call-1',
      name: 'calculator.evaluate',
      arguments: { expression: '2+2' },
    },
  ],
  [
    'juniper-tool-result.v1.schema.json',
    {
      protocolVersion: 'juniper-tool-protocol-v1',
      callId: 'call-1',
      name: 'calculator.evaluate',
      status: 'success',
      result: { value: 4 },
      error: null,
    },
  ],
  [
    'juniper-export.v1.schema.json',
    {
      format: 'juniper-export',
      version: 1,
      assistants: [],
      conversations: [],
      memories: [],
      models: [],
      providers: [],
    },
  ],
  [
    'juniper-export.v2.schema.json',
    {
      format: 'juniper-export',
      version: 2,
      assistants: [],
      conversations: [],
      memories: [],
      models: [],
      providers: [],
      settings: {},
    },
  ],
])
for (const [file, fixture] of fixtures) {
  const validator = validators.get(file)
  if (validator && !validator(fixture))
    throw new Error(`${file} fixture is invalid: ${ajv.errorsText(validator.errors)}`)
}
const toolCall = validators.get('juniper-tool-call.v1.schema.json')
if (
  toolCall?.({
    protocolVersion: 'juniper-tool-protocol-v1',
    id: 'bad',
    name: 'unknown',
    arguments: [],
  })
)
  throw new Error('Invalid tool fixture unexpectedly passed schema validation.')
globalThis.console.log(
  `Validated ${checked} JSON schemas and representative fixtures with JSON Schema.`,
)
