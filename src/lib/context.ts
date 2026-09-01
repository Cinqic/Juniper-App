import type { Assistant, ChatMessage, Memory, ToolDefinition } from '../types'

export interface ContextSummary {
  system: string
  memory: string[]
  conversation: string[]
  tools: string[]
  estimatedTokens: number
  truncated: boolean
}

export function buildContext(
  assistant: Assistant,
  memories: Memory[],
  messages: ChatMessage[],
  tools: ToolDefinition[],
  limit = 32768,
): ContextSummary {
  const enabledMemories = memories.filter(
    (memory) => memory.enabled && (!memory.assistantId || memory.assistantId === assistant.id),
  )
  const conversation = messages.flatMap((message) =>
    message.parts
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => `${message.role}: ${part.text ?? ''}`),
  )
  const toolNames = tools
    .filter((tool) => tool.enabled)
    .map((tool) => `${tool.name}: ${tool.description}`)
  const system = `${assistant.systemPrompt}\n\nResponse length: ${assistant.responseLength}. The host runtime, not the model, controls permissions and authors real tool results.`
  const estimate = (value: string) => Math.ceil(value.length / 4)
  const budget = Math.max(
    256,
    limit -
      estimate(system) -
      enabledMemories.reduce((sum, memory) => sum + estimate(memory.content), 0) -
      toolNames.reduce((sum, tool) => sum + estimate(tool), 0),
  )
  let used = 0
  const kept: string[] = []
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const item = conversation[index]
    if (!item) continue
    const size = estimate(item)
    if (used + size > budget) break
    kept.unshift(item)
    used += size
  }
  return {
    system,
    memory: enabledMemories.map((memory) => memory.content),
    conversation: kept,
    tools: toolNames,
    estimatedTokens:
      estimate(system) +
      enabledMemories.reduce((sum, memory) => sum + estimate(memory.content), 0) +
      toolNames.reduce((sum, tool) => sum + estimate(tool), 0) +
      used,
    truncated: kept.length < conversation.length,
  }
}
