import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { buildContext, type ContextSummary } from '../lib/context'
import {
  defaultAssistant,
  defaultProvider,
  builtinTools,
  initialAppData,
  modelProfileFromDiscovery,
} from '../lib/defaults'
import { parseAssistant, serializeAssistant } from '../lib/assistant'
import {
  checkProviderConnection,
  cancelChat,
  deleteProviderCredential,
  deleteProviderModel,
  getDiagnostics,
  importGguf,
  inspectProviderModel,
  loadNativeAppData,
  modelFromInspection,
  pickGguf,
  pickAttachment,
  pullProviderModel,
  readAttachment,
  resolvePermission,
  runningInTauri,
  runningProviderModels,
  saveNativeAppData,
  listProviderModels,
  saveProviderCredential,
  streamChat,
} from '../lib/runtime'
import { loadAppData, saveAppData } from '../lib/storage'
import { MessageBubble } from './MessageBubble'
import { ToolsPage } from './ToolsPage'
import { PageHeading, Sidebar } from './ui'
import type {
  AppData,
  Assistant,
  ChatMessage,
  ChatStreamEvent,
  Conversation,
  GgufSelection,
  HostToolResult,
  MessagePart,
  ModelProfile,
  Page,
  PermissionDecision,
  PermissionRequest,
  ProviderProfile,
} from '../types'

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}
function now(): string {
  return new Date().toISOString()
}
function textPart(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
}

function applyStreamEvent(message: ChatMessage, event: ChatStreamEvent): ChatMessage {
  const parts = [...message.parts]
  if (event.delta) {
    const textIndex = parts.findIndex((part) => part.type === 'text')
    const text: MessagePart = {
      id: textIndex >= 0 ? parts[textIndex]!.id : uid('part'),
      type: 'text',
      text: `${textIndex >= 0 ? (parts[textIndex]!.text ?? '') : ''}${event.delta}`,
    }
    if (textIndex >= 0) parts[textIndex] = text
    else parts.unshift(text)
  }
  if (event.reasoning) {
    const reasoningIndex = parts.findIndex((part) => part.type === 'reasoning')
    const reasoning: MessagePart = {
      id: reasoningIndex >= 0 ? parts[reasoningIndex]!.id : uid('part'),
      type: 'reasoning',
      text: `${reasoningIndex >= 0 ? (parts[reasoningIndex]!.text ?? '') : ''}${event.reasoning}`,
    }
    if (reasoningIndex >= 0) parts[reasoningIndex] = reasoning
    else parts.push(reasoning)
  }
  for (const call of event.toolCalls ?? []) {
    const existingIndex = parts.findIndex(
      (part) => part.type === 'tool-call' && part.metadata?.callId === call.id,
    )
    if (existingIndex >= 0) {
      const existing = parts[existingIndex]!
      parts[existingIndex] = {
        ...existing,
        metadata: { ...existing.metadata, arguments: JSON.stringify(call.arguments) },
      }
      continue
    }
    parts.push({
      id: uid('part'),
      type: 'tool-call',
      name: call.name,
      text: `Requested ${call.name}`,
      status: 'unavailable',
      metadata: { callId: call.id, arguments: JSON.stringify(call.arguments) },
    })
  }
  for (const result of event.toolResults ?? []) {
    if (
      parts.some((part) => part.type === 'tool-result' && part.metadata?.callId === result.callId)
    )
      continue
    parts.push({
      id: uid('part'),
      type: 'tool-result',
      name: result.name,
      text: result.error?.message ?? JSON.stringify(result.result ?? {}),
      status: result.status,
      metadata: { callId: result.callId },
    })
  }
  return {
    ...message,
    parts,
    usage: event.usage ? { ...message.usage, ...event.usage } : message.usage,
  }
}

function applyHostToolResult(data: AppData, result: HostToolResult): AppData {
  if (result.status !== 'success' || !result.result) return data
  const payload = result.result
  if (result.name === 'memory.save' && payload.memory && typeof payload.memory === 'object') {
    const memory = payload.memory as AppData['memories'][number]
    if (!memory.id || typeof memory.content !== 'string') return data
    return {
      ...data,
      memories: [...data.memories.filter((item) => item.id !== memory.id), memory],
    }
  }
  if (result.name === 'memory.delete' && typeof payload.deletedId === 'string') {
    return {
      ...data,
      memories: data.memories.filter((memory) => memory.id !== payload.deletedId),
    }
  }
  return data
}

export default function App() {
  const [data, setData] = useState<AppData>(() =>
    runningInTauri ? initialAppData() : loadAppData(),
  )
  const [hydrated, setHydrated] = useState(!runningInTauri)
  const [page, setPage] = useState<Page>(data.settings.onboardingComplete ? 'chats' : 'chats')
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    data.conversations[0]?.id ?? null,
  )
  const [activeAssistantId, setActiveAssistantId] = useState(
    data.assistants[0]?.id ?? defaultAssistant.id,
  )
  const [onboardingOpen, setOnboardingOpen] = useState(!data.settings.onboardingComplete)

  useEffect(() => {
    if (!hydrated) return
    if (runningInTauri) void saveNativeAppData(data)
    else saveAppData(data)
    document.documentElement.dataset.theme = data.settings.theme
    document.documentElement.style.setProperty('--accent', data.settings.accent)
    document.documentElement.style.setProperty('--font-scale', String(data.settings.fontScale))
    document.documentElement.dataset.reducedMotion = String(data.settings.reducedMotion)
  }, [data, hydrated])

  useEffect(() => {
    if (!runningInTauri) return
    void loadNativeAppData()
      .then((stored) => {
        if (stored) setData(stored)
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : 'Could not load the SQLite state.')
      })
      .finally(() => setHydrated(true))
  }, [])

  useEffect(() => {
    if (!hydrated) return
    setActiveAssistantId((current) =>
      data.assistants.some((assistant) => assistant.id === current)
        ? current
        : (data.assistants[0]?.id ?? defaultAssistant.id),
    )
    setSelectedChatId((current) =>
      current && data.conversations.some((chat) => chat.id === current)
        ? current
        : (data.conversations[0]?.id ?? null),
    )
    setOnboardingOpen(!data.settings.onboardingComplete)
  }, [data.assistants, data.conversations, data.settings.onboardingComplete, hydrated])

  useEffect(() => {
    if (!runningInTauri || !hydrated) return
    const provider = data.providers.find((item) => item.enabled && item.kind === 'ollama')
    if (!provider) return
    void checkProviderConnection(provider)
      .then(() => {
        if (provider.status !== 'connected') {
          update((current) => ({
            ...current,
            providers: current.providers.map((item) =>
              item.id === provider.id ? { ...item, status: 'connected' } : item,
            ),
          }))
        }
        return listProviderModels(provider)
      })
      .then((models) => {
        if (!models) return
        update((current) => {
          const next = [...current.models]
          for (const discovered of models) {
            const existing = next.find(
              (model) => model.providerId === provider.id && model.modelId === discovered.modelId,
            )
            if (existing) {
              existing.status = 'ready'
              continue
            }
            next.push(
              modelProfileFromDiscovery(provider, discovered.modelId, {
                displayName: discovered.displayName,
                fileSizeBytes: discovered.sizeBytes,
              }),
            )
          }
          return { ...current, models: next }
        })
      })
      .catch(() => undefined)
  }, [data.providers, hydrated])

  const update = (change: (current: AppData) => AppData) => setData((current) => change(current))
  const activeAssistant =
    data.assistants.find((assistant) => assistant.id === activeAssistantId) ??
    data.assistants[0] ??
    defaultAssistant
  const activeModel = data.models.find(
    (model) => model.id === activeAssistant.modelProfileId && isChatSelectable(model),
  )
  const activeProvider = activeModel
    ? data.providers.find((provider) => provider.id === activeModel.providerId)
    : undefined

  function createChat(privateChat = false): Conversation {
    const conversation: Conversation = {
      id: uid('chat'),
      title: 'New conversation',
      assistantId: activeAssistant.id,
      createdAt: now(),
      updatedAt: now(),
      privateChat,
      messages: [],
    }
    update((current) => ({ ...current, conversations: [conversation, ...current.conversations] }))
    setSelectedChatId(conversation.id)
    setPage('chats')
    return conversation
  }

  function completeOnboarding() {
    update((current) => ({
      ...current,
      settings: { ...current.settings, onboardingComplete: true },
    }))
    setOnboardingOpen(false)
  }

  return (
    <div className="app-frame">
      <Sidebar page={page} setPage={setPage} onNewChat={() => createChat()} />
      <main className="main-pane">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="leaf-mark">J</span>
            <span>Juniper</span>
          </div>
          <div className="topbar-context">
            <span className="eyebrow">{page === 'chats' ? 'Personal space' : page}</span>
            <span className={`status-pill ${activeModel?.executionLocation ?? 'unknown'}`}>
              <i />
              {labelExecutionLocation(activeModel?.executionLocation ?? 'unknown')}
            </span>
          </div>
          <button
            className="avatar-button"
            aria-label="Open settings"
            onClick={() => setPage('settings')}
          >
            {activeAssistant.avatar}
          </button>
        </header>
        <div className="page-content">
          {page === 'chats' && (
            <ChatPage
              data={data}
              update={update}
              selectedChatId={selectedChatId}
              setSelectedChatId={setSelectedChatId}
              createChat={createChat}
              activeAssistant={activeAssistant}
              activeModel={activeModel}
            />
          )}
          {page === 'assistants' && (
            <AssistantsPage
              data={data}
              update={update}
              activeAssistantId={activeAssistant.id}
              onSelectAssistant={setActiveAssistantId}
            />
          )}
          {page === 'models' && <ModelsPage data={data} update={update} />}
          {page === 'tools' && <ToolsPage data={data} update={update} />}
          {page === 'settings' && <SettingsPage data={data} update={update} />}
          {page === 'privacy' && (
            <PrivacyPage
              data={data}
              update={update}
              activeModel={activeModel}
              activeProvider={activeProvider}
            />
          )}
          {page === 'diagnostics' && <DiagnosticsPage data={data} />}
        </div>
      </main>
      {onboardingOpen && <Onboarding onDone={completeOnboarding} />}
    </div>
  )
}

function ChatPage({
  data,
  update,
  selectedChatId,
  setSelectedChatId,
  createChat,
  activeAssistant,
  activeModel,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
  selectedChatId: string | null
  setSelectedChatId: (id: string | null) => void
  createChat: (privateChat?: boolean) => Conversation
  activeAssistant: Assistant
  activeModel?: ModelProfile
}) {
  const [query, setQuery] = useState('')
  const conversation =
    data.conversations.find((chat) => chat.id === selectedChatId) ?? data.conversations[0]
  const conversationModel = conversation?.modelProfileId
    ? data.models.find((model) => model.id === conversation.modelProfileId)
    : undefined
  const effectiveModel = conversation?.modelProfileId
    ? conversationModel && isChatSelectable(conversationModel)
      ? conversationModel
      : undefined
    : activeModel
  const modelUnavailable = Boolean(conversation?.modelProfileId && !effectiveModel)
  const effectiveProvider = effectiveModel
    ? data.providers.find((provider) => provider.id === effectiveModel.providerId)
    : undefined
  const filtered = data.conversations.filter((chat) =>
    [chat.title, ...chat.messages.map(textPart)]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  function choose(chat: Conversation) {
    setSelectedChatId(chat.id)
  }
  function renameConversation() {
    if (!conversation) return
    const title = window.prompt('Conversation name', conversation.title)?.trim()
    if (!title) return
    update((current) => ({
      ...current,
      conversations: current.conversations.map((chat) =>
        chat.id === conversation.id ? { ...chat, title, updatedAt: now() } : chat,
      ),
    }))
  }
  function deleteConversation() {
    if (!conversation || !window.confirm(`Delete “${conversation.title}”?`)) return
    update((current) => ({
      ...current,
      conversations: current.conversations.filter((chat) => chat.id !== conversation.id),
      permissions: current.permissions.filter(
        (grant) => grant.scope !== 'chat' || grant.conversationId !== conversation.id,
      ),
    }))
    setSelectedChatId(null)
  }
  return (
    <div className="chat-layout">
      <section className="chat-list-panel">
        <div className="list-heading">
          <div>
            <span className="eyebrow">Your space</span>
            <h2>Chats</h2>
          </div>
          <button className="icon-button" aria-label="New chat" onClick={() => createChat()}>
            <span>＋</span>
          </button>
        </div>
        <label className="search-field">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
        </label>
        <div className="chat-list">
          {filtered.length === 0 ? (
            <div className="empty-small">
              No saved chats yet.
              <br />
              Start a fresh conversation.
            </div>
          ) : (
            filtered.map((chat) => (
              <button
                key={chat.id}
                className={`chat-list-item ${conversation?.id === chat.id ? 'selected' : ''}`}
                onClick={() => choose(chat)}
              >
                <span className="chat-list-avatar">{activeAssistant.avatar}</span>
                <span>
                  <strong>{chat.title}</strong>
                  <small>
                    {chat.privateChat
                      ? 'Private · session only'
                      : chat.messages.length
                        ? `${chat.messages.length} messages`
                        : 'Just now'}
                  </small>
                </span>
                <span className="chevron">›</span>
              </button>
            ))
          )}
        </div>
        <button className="private-toggle" onClick={() => createChat(true)}>
          <span className="lock">●</span>
          Start private chat
        </button>
      </section>
      <section className="chat-main">
        {conversation ? (
          <ConversationView
            data={data}
            update={update}
            conversation={conversation}
            activeAssistant={activeAssistant}
            activeModel={effectiveModel}
            activeProvider={effectiveProvider}
            privateMode={conversation.privateChat === true}
            modelUnavailable={modelUnavailable}
            onRename={renameConversation}
            onDelete={deleteConversation}
            onSelectModel={(modelId) =>
              update((current) => ({
                ...current,
                conversations: current.conversations.map((chat) =>
                  chat.id === conversation.id ? { ...chat, modelProfileId: modelId } : chat,
                ),
              }))
            }
          />
        ) : (
          <EmptyChat onCreate={() => createChat()} />
        )}
      </section>
    </div>
  )
}

function EmptyChat({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-chat">
      <div className="welcome-orb">J</div>
      <span className="eyebrow">A calmer place to think</span>
      <h1>What are we figuring out today?</h1>
      <p>Juniper brings personality, context, memory, and tools around the model you choose.</p>
      <button className="primary-button" onClick={onCreate}>
        Start a conversation <span>→</span>
      </button>
    </div>
  )
}

function ConversationView({
  data,
  update,
  conversation,
  activeAssistant,
  activeModel,
  activeProvider,
  privateMode,
  modelUnavailable,
  onRename,
  onDelete,
  onSelectModel,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
  conversation: Conversation
  activeAssistant: Assistant
  activeModel?: ModelProfile
  activeProvider?: ProviderProfile
  privateMode: boolean
  modelUnavailable: boolean
  onRename: () => void
  onDelete: () => void
  onSelectModel: (modelId: string | null) => void
}) {
  const [draft, setDraft] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)
  const [lastContext, setLastContext] = useState<ContextSummary | null>(null)
  const controller = useRef<AbortController | null>(null)
  const requestId = useRef<string | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const [attachments, setAttachments] = useState<
    Array<{
      id: string
      name: string
      content: string
      sizeBytes?: number
      contentType?: string
    }>
  >([])
  const messages = conversation.messages
  function updateConversation(change: (chat: Conversation) => Conversation) {
    update((current) => ({
      ...current,
      conversations: current.conversations.map((chat) =>
        chat.id === conversation.id ? change(chat) : chat,
      ),
    }))
  }
  async function send(event?: FormEvent) {
    event?.preventDefault()
    const content = draft.trim()
    if (!content || isGenerating) return
    if (!activeModel || !activeProvider) return
    const user: ChatMessage = {
      id: uid('message'),
      conversationId: conversation.id,
      role: 'user',
      parts: [{ id: uid('part'), type: 'text', text: content }],
      createdAt: now(),
    }
    const assistantMessage: ChatMessage = {
      id: uid('message'),
      conversationId: conversation.id,
      role: 'assistant',
      parts: [{ id: uid('part'), type: 'text', text: '' }],
      createdAt: now(),
      modelId: activeModel.modelId,
      providerId: activeProvider?.id,
      isStreaming: true,
    }
    const nextMessages = [...messages, user, assistantMessage]
    const enabledTools =
      activeAssistant.toolPolicy !== 'disabled' && activeModel.capabilities.tools === 'supported'
        ? builtinTools.filter(
            (tool) =>
              tool.enabled &&
              (tool.risk === 'automatic-safe' || activeAssistant.toolPolicy === 'ask'),
          )
        : []
    const context = buildContext(
      activeAssistant,
      data.memories,
      nextMessages,
      enabledTools,
      activeModel.contextLength,
      content,
      attachments,
    )
    setLastContext(context)
    setDraft('')
    const requestAttachments = attachments
    setAttachments([])
    setIsGenerating(true)
    controller.current = new AbortController()
    updateConversation((chat) => ({
      ...chat,
      title: chat.title === 'New conversation' ? content.slice(0, 38) : chat.title,
      updatedAt: now(),
      messages: nextMessages,
    }))
    const currentRequestId = uid('request')
    requestId.current = currentRequestId
    try {
      await streamChat(
        {
          requestId: currentRequestId,
          assistantId: activeAssistant.id,
          conversationId: conversation.id,
          privateChat: privateMode,
          provider: activeProvider,
          model: activeModel,
          messages: [
            { role: 'system', content: context.system },
            ...context.conversation,
            { role: 'user', content: context.currentUserMessage },
          ],
          tools: enabledTools,
          generation: activeAssistant.generation,
          permissionGrants: data.permissions,
          hostContext: {
            memories: data.memories,
            conversations: data.conversations.filter((chat) => !chat.privateChat),
          },
          attachments: requestAttachments,
        },
        (streamEvent) => {
          if (streamEvent.permissionRequest) {
            setPermissionRequest(streamEvent.permissionRequest)
          }
          if (
            streamEvent.delta ||
            streamEvent.reasoning ||
            streamEvent.toolCalls?.length ||
            streamEvent.toolResults?.length
          )
            updateConversation((chat) => ({
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === assistantMessage.id
                  ? applyStreamEvent(message, streamEvent)
                  : message,
              ),
            }))
          for (const result of streamEvent.toolResults ?? []) {
            update((current) => applyHostToolResult(current, result))
          }
          if (streamEvent.error)
            updateConversation((chat) => ({
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === assistantMessage.id
                  ? {
                      ...message,
                      isStreaming: false,
                      parts: [{ id: uid('part'), type: 'error', text: streamEvent.error?.message }],
                    }
                  : message,
              ),
            }))
          if (streamEvent.done)
            updateConversation((chat) => ({
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === assistantMessage.id ? { ...message, isStreaming: false } : message,
              ),
            }))
        },
        controller.current.signal,
      )
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Generation cancelled.'
          : error instanceof Error
            ? error.message
            : 'The provider stopped responding.'
      updateConversation((chat) => ({
        ...chat,
        messages: chat.messages.map((item) =>
          item.id === assistantMessage.id
            ? {
                ...item,
                isStreaming: false,
                parts: [{ id: uid('part'), type: 'error', text: message }],
              }
            : item,
        ),
      }))
    } finally {
      setIsGenerating(false)
      setPermissionRequest(null)
      controller.current = null
      requestId.current = null
      composer.current?.focus()
    }
  }
  function stop() {
    if (requestId.current) void cancelChat(requestId.current)
    controller.current?.abort()
  }
  async function attachFromHost() {
    try {
      const attachment = await pickAttachment()
      if (!attachment) return
      const content = await readAttachment(attachment.id)
      setAttachments((current) => [
        ...current,
        {
          id: attachment.id,
          name: attachment.name,
          content,
          sizeBytes: attachment.sizeBytes,
          contentType: attachment.contentType,
        },
      ])
      setDraft((current) => `${current}${current ? '\n\n' : ''}[Attached: ${attachment.name}]`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not attach that file.')
    }
  }
  async function decidePermission(decision: PermissionDecision) {
    const pending = permissionRequest
    if (!pending) return
    try {
      await resolvePermission(pending.requestId, pending.callId, decision)
      if (decision === 'allow-chat' || decision === 'allow-assistant') {
        const timestamp = now()
        update((current) => ({
          ...current,
          permissions: [
            ...current.permissions.filter(
              (grant) =>
                !(
                  grant.toolName === pending.toolName &&
                  grant.assistantId === pending.assistantId &&
                  grant.scope === (decision === 'allow-chat' ? 'chat' : 'assistant') &&
                  (decision === 'allow-assistant' ||
                    grant.conversationId === pending.conversationId)
                ),
            ),
            {
              id: uid('permission'),
              toolName: pending.toolName,
              scope: decision === 'allow-chat' ? 'chat' : 'assistant',
              assistantId: pending.assistantId,
              ...(decision === 'allow-chat' ? { conversationId: pending.conversationId } : {}),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        }))
      }
      setPermissionRequest(null)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not record that permission.')
    }
  }
  function regenerate() {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (lastUser) {
      setDraft(textPart(lastUser))
      composer.current?.focus()
    }
  }
  function exportMarkdown() {
    const body = messages
      .map(
        (message) =>
          `## ${message.role === 'user' ? 'You' : activeAssistant.name}\n\n${textPart(message)}`,
      )
      .join('\n\n')
    download(`${conversation.title}.md`, body, 'text/markdown')
  }
  return (
    <div className="conversation">
      <div className="conversation-header">
        <div className="assistant-identity">
          <div className="assistant-avatar" style={{ background: activeAssistant.accent }}>
            {activeAssistant.avatar}
          </div>
          <div>
            <strong>{activeAssistant.name}</strong>
            <span>
              {modelUnavailable
                ? 'Model unavailable'
                : (activeModel?.displayName ?? 'Model not selected')}{' '}
              ·{' '}
              <span className="local-text">
                {labelExecutionLocation(activeModel?.executionLocation ?? 'unknown')}
              </span>
            </span>
          </div>
        </div>
        <div className="conversation-actions">
          <label className="model-select-label">
            <span>Model</span>
            <select
              value={conversation.modelProfileId ?? activeModel?.id ?? ''}
              onChange={(event) => onSelectModel(event.target.value || null)}
              aria-label="Conversation model"
            >
              <option value="">Assistant default</option>
              {modelUnavailable && conversation.modelProfileId && (
                <option value={conversation.modelProfileId} disabled>
                  Model unavailable
                </option>
              )}
              {data.models.filter(isChatSelectable).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
          <button className="text-button" onClick={exportMarkdown}>
            Export
          </button>
          <button className="text-button" onClick={onRename}>
            Rename
          </button>
          <button className="text-button" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {data.settings.developerMode && lastContext && (
        <details className="context-inspector">
          <summary>Context inspector</summary>
          <div className="context-inspector-meta">
            <span>
              Estimated {lastContext.estimatedTokens.toLocaleString()} /{' '}
              {lastContext.contextLimit.toLocaleString()} tokens
            </span>
            <span>
              {lastContext.contextLimitAssumed ? 'Context limit assumed' : 'Runtime limit'}
            </span>
            <span>{lastContext.truncated ? 'Older history truncated' : 'No truncation'}</span>
          </div>
          <div className="context-inspector-grid">
            <pre>{`[Juniper system]\n${lastContext.system}`}</pre>
            <pre>{`[Conversation]\n${lastContext.conversation.map((item) => `${item.role}: ${item.content}`).join('\n\n')}`}</pre>
            <pre>{`[Files]\n${lastContext.attachments.join('\n') || 'None'}\n\n[Current user]\n${lastContext.currentUserMessage}`}</pre>
          </div>
        </details>
      )}
      <div className="message-scroll">
        {messages.length === 0 ? (
          <div className="conversation-welcome">
            <div className="welcome-orb small">J</div>
            <h2>{activeAssistant.welcomeMessage}</h2>
            <p>
              {modelUnavailable
                ? 'This chat’s model is unavailable. Choose another model or edit the assistant.'
                : activeModel
                  ? 'Choose a prompt below or write whatever is on your mind.'
                  : 'No model selected. Choose or download one in Models to begin chatting.'}
            </p>
            <div className="suggestions">
              {activeAssistant.suggestedPrompts.map((prompt) => (
                <button key={prompt} onClick={() => setDraft(prompt)}>
                  {prompt}
                  <span>↗</span>
                </button>
              ))}
            </div>
            <div className="feature-strip">
              <span>✦ Local-first</span>
              <span>◌ Curated memory</span>
              <span>⌘ Host tools</span>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} assistant={activeAssistant} />
          ))
        )}
        {isGenerating && (
          <div className="typing-line">
            <span className="typing-dot" />
            <span>Juniper is thinking</span>
          </div>
        )}
      </div>
      <form className="composer-wrap" onSubmit={send}>
        <div className="composer">
          <label
            className="composer-icon"
            aria-label="Attach a file"
            onClick={(event) => {
              if (runningInTauri) {
                event.preventDefault()
                void attachFromHost()
              }
            }}
          >
            ＋
            <input
              type="file"
              hidden
              accept=".txt,.md,.json,.csv,.toml,.yaml,.yml,.rs,.ts,.tsx,.js,.jsx,.py,.css,.html,text/plain,application/json,text/markdown"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file || file.size > 1024 * 1024) return
                void file.text().then((content) => {
                  const attachment = { id: uid('attachment'), name: file.name, content }
                  setAttachments((current) => [...current, attachment])
                  setDraft(
                    (current) => `${current}${current ? '\n\n' : ''}[Attached: ${file.name}]`,
                  )
                })
              }}
            />
          </label>
          <textarea
            ref={composer}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder={`Message ${activeAssistant.name}…`}
            rows={1}
            aria-label="Message Juniper"
          />
          <div className="composer-end">
            {isGenerating ? (
              <button
                type="button"
                className="stop-button"
                onClick={stop}
                aria-label="Stop generation"
              >
                ■
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                disabled={!draft.trim() || !activeModel || !activeProvider}
                aria-label="Send message"
              >
                ↑
              </button>
            )}
          </div>
        </div>
        <div className="composer-meta">
          <span>
            {modelUnavailable
              ? 'Model unavailable · choose another model or edit the assistant'
              : !activeModel
                ? 'No model selected · choose one in Models'
                : privateMode
                  ? 'Private chat · not saved after this session'
                  : 'Shift + Enter for a new line'}
          </span>
          <button
            type="button"
            onClick={regenerate}
            disabled={!messages.some((message) => message.role === 'user')}
          >
            Regenerate last
          </button>
        </div>
      </form>
      {permissionRequest && (
        <div className="permission-backdrop" role="presentation">
          <div
            className="permission-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="permission-title"
          >
            <span className="eyebrow">Juniper permission</span>
            <h2 id="permission-title">Allow {permissionRequest.toolName}?</h2>
            <p>
              The model requested a host capability. Juniper will not allow it unless you choose a
              scope below.
            </p>
            <div className="permission-actions">
              <button
                className="primary-button"
                onClick={() => void decidePermission('allow-once')}
              >
                Allow once
              </button>
              <button
                className="secondary-button"
                onClick={() => void decidePermission('allow-chat')}
              >
                Allow for this chat
              </button>
              <button
                className="secondary-button"
                onClick={() => void decidePermission('allow-assistant')}
              >
                Always allow for this assistant
              </button>
              <button className="text-button" onClick={() => void decidePermission('deny')}>
                Deny
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AssistantsPage({
  data,
  update,
  activeAssistantId,
  onSelectAssistant,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
  activeAssistantId: string
  onSelectAssistant: (id: string) => void
}) {
  const [editing, setEditing] = useState<Assistant | null>(null)
  function save(assistant: Assistant) {
    update((current) => ({
      ...current,
      assistants: current.assistants.some((item) => item.id === assistant.id)
        ? current.assistants.map((item) =>
            item.id === assistant.id ? { ...assistant, updatedAt: now() } : item,
          )
        : [...current.assistants, assistant],
    }))
    onSelectAssistant(assistant.id)
    setEditing(null)
  }
  function newAssistant() {
    setEditing({
      ...defaultAssistant,
      id: uid('assistant'),
      name: 'New assistant',
      description: 'A custom Juniper assistant.',
      systemPrompt: defaultAssistant.systemPrompt,
      createdAt: now(),
      updatedAt: now(),
    })
  }
  return (
    <>
      {editing ? (
        <AssistantBuilder
          assistant={editing}
          models={data.models}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <PageHeading
            eyebrow="Make it yours"
            title="Assistants"
            description="Behavior is separate from inference. Create a different Juniper for every kind of day."
            action={
              <button className="primary-button" onClick={newAssistant}>
                ＋ New assistant
              </button>
            }
          />
          <div className="assistant-grid">
            {data.assistants.map((assistant) => (
              <button
                className={`assistant-card ${activeAssistantId === assistant.id ? 'selected' : ''}`}
                key={assistant.id}
                onClick={() => {
                  onSelectAssistant(assistant.id)
                  setEditing(assistant)
                }}
              >
                <div className="card-top">
                  <div className="assistant-avatar large" style={{ background: assistant.accent }}>
                    {assistant.avatar}
                  </div>
                  <span className="card-more">···</span>
                </div>
                <h3>{assistant.name}</h3>
                <p>{assistant.description}</p>
                <div className="card-meta">
                  <span>
                    {data.models.find((model) => model.id === assistant.modelProfileId)
                      ?.displayName ?? 'Model not selected'}
                  </span>
                  <span>›</span>
                </div>
              </button>
            ))}
            <button className="assistant-card add-card" onClick={newAssistant}>
              <span>＋</span>
              <strong>Build a new assistant</strong>
              <small>Start from Juniper’s template</small>
            </button>
          </div>
        </>
      )}
    </>
  )
}

function AssistantBuilder({
  assistant: initial,
  models,
  onSave,
  onCancel,
}: {
  assistant: Assistant
  models: ModelProfile[]
  onSave: (assistant: Assistant) => void
  onCancel: () => void
}) {
  const [assistant, setAssistant] = useState(initial)
  const set = <K extends keyof Assistant>(key: K, value: Assistant[K]) =>
    setAssistant((current) => ({ ...current, [key]: value }))
  function updatePersonality(key: keyof Assistant['personality'], value: number) {
    set('personality', { ...assistant.personality, [key]: value })
  }
  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    void file.text().then((text) => {
      try {
        setAssistant(parseAssistant(text))
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Could not import assistant.')
      }
    })
  }
  function exportFile() {
    download(
      `${assistant.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.juniper`,
      serializeAssistant(assistant),
      'application/json',
    )
  }
  return (
    <div>
      <div className="builder-header">
        <button className="back-link" onClick={onCancel}>
          ← Assistants
        </button>
        <div>
          <span className="eyebrow">Assistant builder</span>
          <h1>{assistant.name}</h1>
        </div>
        <div className="builder-actions">
          <label className="secondary-button">
            Import
            <input
              type="file"
              accept=".juniper,.json,application/json"
              onChange={importFile}
              hidden
            />
          </label>
          <button className="secondary-button" onClick={exportFile}>
            Export
          </button>
          <button className="primary-button" onClick={() => onSave(assistant)}>
            Save assistant
          </button>
        </div>
      </div>
      <div className="builder-grid">
        <section className="builder-card">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div>
              <h2>Identity</h2>
              <p>Give this assistant a clear role.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Name
              <input value={assistant.name} onChange={(event) => set('name', event.target.value)} />
            </label>
            <label>
              Avatar
              <input
                value={assistant.avatar}
                maxLength={2}
                onChange={(event) => set('avatar', event.target.value)}
              />
            </label>
            <label className="wide">
              Description
              <input
                value={assistant.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </label>
            <label className="wide">
              What should it help with?
              <textarea
                value={assistant.systemPrompt}
                onChange={(event) => set('systemPrompt', event.target.value)}
                rows={7}
              />
            </label>
          </div>
        </section>
        <section className="builder-card">
          <div className="section-heading">
            <span className="section-number">02</span>
            <div>
              <h2>Personality</h2>
              <p>Use human labels as a starting point; the prompt stays editable.</p>
            </div>
          </div>
          <div className="personality-grid">
            {(Object.keys(assistant.personality) as Array<keyof Assistant['personality']>).map(
              (key) => (
                <label key={key}>
                  <span>
                    {key[0]?.toUpperCase()}
                    {key.slice(1)}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={assistant.personality[key]}
                    onChange={(event) => updatePersonality(key, Number(event.target.value))}
                  />
                  <small>
                    {assistant.personality[key] > 66
                      ? 'High'
                      : assistant.personality[key] < 34
                        ? 'Low'
                        : 'Balanced'}
                  </small>
                </label>
              ),
            )}
          </div>
          <div className="choice-row">
            <label>
              Response style
              <select
                value={assistant.responseLength}
                onChange={(event) =>
                  set('responseLength', event.target.value as Assistant['responseLength'])
                }
              >
                <option value="concise">Concise</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
            <label>
              Model
              <select
                value={assistant.modelProfileId ?? ''}
                onChange={(event) => set('modelProfileId', event.target.value || null)}
              >
                <option value="">Not selected</option>
                {models.filter(isChatSelectable).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section className="builder-card compact-card">
          <div className="section-heading">
            <span className="section-number">03</span>
            <div>
              <h2>Boundaries</h2>
              <p>The host runtime enforces these choices.</p>
            </div>
          </div>
          <div className="choice-row">
            <label>
              Tool policy
              <select
                value={assistant.toolPolicy}
                onChange={(event) =>
                  set('toolPolicy', event.target.value as Assistant['toolPolicy'])
                }
              >
                <option value="ask">Ask before user-data tools</option>
                <option value="safe-automatic">Safe automatic tools</option>
                <option value="disabled">Tools disabled</option>
              </select>
            </label>
            <label>
              Memory
              <select
                value={assistant.memoryPolicy}
                onChange={(event) =>
                  set('memoryPolicy', event.target.value as Assistant['memoryPolicy'])
                }
              >
                <option value="curated">Curated memories</option>
                <option value="off">Off</option>
              </select>
            </label>
          </div>
        </section>
        <details className="builder-card compact-card">
          <summary className="section-heading">
            <span className="section-number">04</span>
            <div>
              <h2>Advanced generation</h2>
              <p>Only supported controls are sent to the selected runtime.</p>
            </div>
          </summary>
          <div className="choice-row advanced-generation-grid">
            <label>
              Temperature
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={assistant.generation.temperature ?? ''}
                onChange={(event) =>
                  set('generation', {
                    ...assistant.generation,
                    temperature: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </label>
            <label>
              Top P
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={assistant.generation.topP ?? ''}
                onChange={(event) =>
                  set('generation', {
                    ...assistant.generation,
                    topP: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </label>
            <label>
              Max output tokens
              <input
                type="number"
                min="1"
                max="32768"
                step="1"
                value={assistant.generation.maxOutput ?? ''}
                onChange={(event) =>
                  set('generation', {
                    ...assistant.generation,
                    maxOutput: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </label>
            <label>
              Thinking
              <select
                value={assistant.generation.thinking ?? 'auto'}
                onChange={(event) =>
                  set('generation', {
                    ...assistant.generation,
                    thinking: event.target.value as Assistant['generation']['thinking'],
                  })
                }
              >
                <option value="auto">Auto</option>
                <option value="off">Off</option>
                <option value="on">On</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
        </details>
      </div>
    </div>
  )
}

function ModelsPage({
  data,
  update,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
}) {
  const [showProvider, setShowProvider] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderProfile | null>(null)
  const [providerName, setProviderName] = useState('Local llama.cpp server')
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8080/v1')
  const [providerKind, setProviderKind] = useState<ProviderProfile['kind']>('openai-compatible')
  const [apiKey, setApiKey] = useState('')
  const [checkingProvider, setCheckingProvider] = useState<string | null>(null)
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [modelReference, setModelReference] = useState('')
  const [pullStatus, setPullStatus] = useState<string | null>(null)
  const [pullProgress, setPullProgress] = useState<{ completed?: number; total?: number }>({})
  const pullController = useRef<AbortController | null>(null)
  const [ggufSelection, setGgufSelection] = useState<GgufSelection | null>(null)
  const [ggufModelName, setGgufModelName] = useState('local-gguf')
  const [ggufImportStatus, setGgufImportStatus] = useState<string | null>(null)
  const ggufImportController = useRef<AbortController | null>(null)
  const [runningModelIds, setRunningModelIds] = useState<Record<string, string[]>>({})
  const [hostMemory, setHostMemory] = useState<string | null>(null)

  useEffect(() => {
    if (!runningInTauri) return
    let active = true
    void Promise.all(
      data.providers
        .filter((provider) => provider.enabled)
        .map(async (provider) => {
          try {
            const models = await runningProviderModels(provider)
            return [
              provider.id,
              models.flatMap((model) => {
                const name = model.name ?? model.model
                return typeof name === 'string' ? [name] : []
              }),
            ] as const
          } catch {
            return [provider.id, []] as const
          }
        }),
    ).then((entries) => {
      if (active) setRunningModelIds(Object.fromEntries(entries))
    })
    void getDiagnostics().then((info) => {
      if (active) setHostMemory(info.memory ?? null)
    })
    return () => {
      active = false
    }
  }, [data.providers])

  function startProviderForm(provider?: ProviderProfile) {
    setEditingProvider(provider ?? null)
    setProviderName(provider?.name ?? 'Local llama.cpp server')
    setBaseUrl(provider?.baseUrl ?? 'http://127.0.0.1:8080/v1')
    setProviderKind(provider?.kind ?? 'openai-compatible')
    setApiKey('')
    setShowProvider(true)
  }

  async function saveProvider() {
    const name = providerName.trim()
    const url = baseUrl.trim()
    if (!name || !url) return
    const providerId = editingProvider?.id ?? uid('provider')
    const apiKeyRef = apiKey.trim()
      ? (editingProvider?.apiKeyRef ?? uid('credential'))
      : editingProvider?.apiKeyRef
    if (apiKeyRef) {
      try {
        await saveProviderCredential(apiKeyRef, apiKey.trim())
      } catch (error) {
        window.alert(
          error instanceof Error ? error.message : 'Could not save the API key securely.',
        )
        return
      }
    }
    const location = locationForUrl(url)
    const provider: ProviderProfile = {
      ...(editingProvider ?? {}),
      id: providerId,
      name,
      kind: providerKind,
      baseUrl: url,
      locality: location === 'remote' ? 'remote' : location === 'unknown' ? 'unknown' : 'local',
      transportLocation: location,
      apiKeyRef,
      enabled: editingProvider?.enabled ?? true,
      status: 'unknown',
      capabilities: {
        ...(editingProvider?.capabilities ??
          data.providers[0]?.capabilities ?? {
            chat: 'supported',
            text: 'supported',
            streaming: 'supported',
            systemPrompt: 'supported',
            tools: 'unknown',
            parallelTools: 'unknown',
            thinking: 'unknown',
            structuredOutput: 'unknown',
            images: 'unknown',
            embeddings: 'unknown',
            generationParameters: ['temperature'],
          }),
      },
    }
    update((current) => ({
      ...current,
      providers: current.providers.some((item) => item.id === provider.id)
        ? current.providers.map((item) => (item.id === provider.id ? provider : item))
        : [...current.providers, provider],
    }))
    setApiKey('')
    setShowProvider(false)
    setEditingProvider(null)
  }
  async function testProvider(provider: ProviderProfile) {
    setCheckingProvider(provider.id)
    try {
      await checkProviderConnection(provider)
      update((current) => ({
        ...current,
        providers: current.providers.map((item) =>
          item.id === provider.id ? { ...item, status: 'connected' } : item,
        ),
      }))
    } catch (error) {
      update((current) => ({
        ...current,
        providers: current.providers.map((item) =>
          item.id === provider.id ? { ...item, status: 'offline' } : item,
        ),
      }))
      window.alert(error instanceof Error ? error.message : 'Provider connection failed.')
    } finally {
      setCheckingProvider(null)
    }
  }
  function toggleProvider(provider: ProviderProfile) {
    update((current) => ({
      ...current,
      providers: current.providers.map((item) =>
        item.id === provider.id ? { ...item, enabled: !item.enabled } : item,
      ),
    }))
  }
  async function removeProvider(provider: ProviderProfile) {
    const dependentModels = data.models.filter((model) => model.providerId === provider.id)
    if (
      !window.confirm(
        `Remove ${provider.name}? ${dependentModels.length} model profile(s) will remain unavailable.`,
      )
    )
      return
    if (provider.apiKeyRef && runningInTauri) {
      try {
        await deleteProviderCredential(provider.apiKeyRef)
      } catch (error) {
        window.alert(
          error instanceof Error ? error.message : 'Could not remove the provider credential.',
        )
        return
      }
    }
    update((current) => ({
      ...current,
      providers: current.providers.filter((item) => item.id !== provider.id),
      models: current.models.map((model) =>
        model.providerId === provider.id ? { ...model, status: 'not-found' } : model,
      ),
    }))
  }
  async function refreshModels() {
    setRefreshingModels(true)
    const discovered: Array<{
      provider: ProviderProfile
      modelIds: Awaited<ReturnType<typeof listProviderModels>>
    }> = []
    for (const provider of data.providers.filter((item) => item.enabled)) {
      try {
        discovered.push({ provider, modelIds: await listProviderModels(provider) })
      } catch {
        // A provider can be offline while another provider remains usable.
      }
    }
    const normalized: ModelProfile[] = []
    for (const { provider, modelIds } of discovered) {
      for (const discoveredModel of modelIds) {
        const existing = data.models.find(
          (model) => model.providerId === provider.id && model.modelId === discoveredModel.modelId,
        )
        try {
          const inspection = await inspectProviderModel(provider, discoveredModel.modelId)
          normalized.push(modelFromInspection(provider, inspection, existing))
        } catch {
          normalized.push(
            modelProfileFromDiscovery(provider, discoveredModel.modelId, {
              ...existing,
              displayName: discoveredModel.displayName,
              fileSizeBytes: discoveredModel.sizeBytes,
            }),
          )
        }
      }
    }
    const refreshedProviderIds = new Set(discovered.map(({ provider }) => provider.id))
    const discoveredModelIds = new Set(normalized.map((model) => model.id))
    if (refreshedProviderIds.size) {
      update((current) => ({
        ...current,
        providers: current.providers.map((provider) =>
          refreshedProviderIds.has(provider.id) ? { ...provider, status: 'connected' } : provider,
        ),
        models: [
          ...current.models
            .filter((model) => !normalized.some((item) => item.id === model.id))
            .map((model) =>
              refreshedProviderIds.has(model.providerId) && !discoveredModelIds.has(model.id)
                ? { ...model, status: 'not-found' as const }
                : model,
            ),
          ...normalized,
        ],
      }))
    }
    setRefreshingModels(false)
  }
  async function downloadModel() {
    const reference = modelReference.trim()
    const provider = data.providers.find((item) => item.kind === 'ollama' && item.enabled)
    if (!provider || !reference) return
    pullController.current?.abort()
    const controller = new AbortController()
    pullController.current = controller
    setPullStatus('Resolving')
    setPullProgress({})
    try {
      await pullProviderModel(
        provider,
        reference,
        (progress) => {
          setPullStatus(progress.status)
          setPullProgress({ completed: progress.completedBytes, total: progress.totalBytes })
        },
        controller.signal,
      )
      setPullStatus('Complete')
      setModelReference('')
      await refreshModels()
    } catch (error) {
      setPullStatus(
        controller.signal.aborted
          ? 'Cancelled'
          : error instanceof Error
            ? error.message
            : 'Download failed',
      )
    } finally {
      pullController.current = null
    }
  }
  function cancelDownload() {
    pullController.current?.abort()
  }
  async function chooseGguf() {
    try {
      const selection = await pickGguf()
      if (selection) {
        setGgufSelection(selection)
        setGgufModelName(selection.name.replace(/\.gguf$/i, '').replace(/[^a-z0-9._/-]+/gi, '-'))
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not select that GGUF file.')
    }
  }
  async function importSelectedGguf() {
    if (!ggufSelection || !ggufModelName.trim()) return
    ggufImportController.current?.abort()
    const controller = new AbortController()
    ggufImportController.current = controller
    setGgufImportStatus('Preparing import')
    try {
      await importGguf(
        ggufSelection.id,
        ggufModelName.trim(),
        (progress) => setGgufImportStatus(progress.status),
        controller.signal,
      )
      setGgufImportStatus('Complete')
      await refreshModels()
    } catch (error) {
      setGgufImportStatus(
        controller.signal.aborted
          ? 'Cancelled'
          : error instanceof Error
            ? error.message
            : 'Import failed',
      )
    } finally {
      ggufImportController.current = null
    }
  }
  function cancelGguf() {
    ggufImportController.current?.abort()
  }
  async function deleteModel(model: ModelProfile) {
    const provider = data.providers.find((item) => item.id === model.providerId)
    if (!provider || !window.confirm(`Delete ${model.modelId} from ${provider.name}?`)) return
    try {
      await deleteProviderModel(provider, model.modelId)
      update((current) => ({
        ...current,
        models: current.models.filter((item) => item.id !== model.id),
        assistants: current.assistants.map((assistant) =>
          assistant.modelProfileId === model.id
            ? { ...assistant, modelProfileId: null }
            : assistant,
        ),
        conversations: current.conversations.map((chat) =>
          chat.modelProfileId === model.id ? { ...chat, modelProfileId: null } : chat,
        ),
      }))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not delete the model.')
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Infrastructure"
        title="Models"
        description="Models provide inference. Juniper provides the environment around them."
        action={
          <button
            className="secondary-button"
            onClick={() => (showProvider ? setShowProvider(false) : startProviderForm())}
          >
            ＋ Add provider
          </button>
        }
      />
      {showProvider && (
        <div className="inline-form">
          <label>
            Provider name
            <input value={providerName} onChange={(event) => setProviderName(event.target.value)} />
          </label>
          <label>
            Provider type
            <select
              value={providerKind}
              onChange={(event) => setProviderKind(event.target.value as ProviderProfile['kind'])}
            >
              <option value="ollama">Ollama</option>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="llama-cpp">llama.cpp-compatible</option>
            </select>
          </label>
          <label>
            Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label>
            API key <small>Saved to OS keychain</small>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <div className="inline-form-actions">
            <button className="primary-button" onClick={() => void saveProvider()}>
              {editingProvider ? 'Update provider' : 'Save provider'}
            </button>
            <button className="text-button" onClick={() => setShowProvider(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="provider-stack">
        {data.providers.map((provider) => (
          <div className="provider-card" key={provider.id}>
            <div className="provider-icon">{provider.kind === 'ollama' ? '◉' : '↗'}</div>
            <div className="provider-body">
              <div className="provider-title">
                <h3>{provider.name}</h3>
                <span className={`status-pill ${provider.transportLocation}`}>
                  <i />
                  {labelExecutionLocation(provider.transportLocation)}
                </span>
              </div>
              <p>{provider.baseUrl}</p>
              <div className="provider-footer">
                <span>
                  {provider.enabled
                    ? provider.status === 'connected'
                      ? 'Connected'
                      : 'Connection not checked'
                    : 'Disabled'}
                </span>
                <button
                  className="text-button"
                  onClick={() => void testProvider(provider)}
                  disabled={checkingProvider === provider.id}
                >
                  {checkingProvider === provider.id ? 'Checking…' : 'Test connection →'}
                </button>
                <button className="text-button" onClick={() => startProviderForm(provider)}>
                  Edit
                </button>
                <button className="text-button" onClick={() => toggleProvider(provider)}>
                  {provider.enabled ? 'Disable' : 'Enable'}
                </button>
                <button className="text-button" onClick={() => void removeProvider(provider)}>
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="models-section">
        <div className="subheading">
          <div>
            <span className="eyebrow">Available models</span>
            <h2>Model library</h2>
          </div>
          <button
            className="text-button"
            onClick={() => void refreshModels()}
            disabled={refreshingModels}
          >
            {refreshingModels ? 'Refreshing…' : 'Refresh list ↻'}
          </button>
        </div>
        <div className="model-download-card">
          <div>
            <span className="eyebrow">Ollama model downloader</span>
            <h3>Download a model</h3>
            <p>Enter any compatible Ollama model reference. Juniper sends it directly to Ollama.</p>
          </div>
          <div className="model-download-form">
            <input
              value={modelReference}
              onChange={(event) => setModelReference(event.target.value)}
              placeholder="model-name-or-reference"
              aria-label="Ollama model reference"
              maxLength={256}
              disabled={pullController.current !== null}
            />
            {pullController.current ? (
              <button className="secondary-button" onClick={cancelDownload}>
                Cancel
              </button>
            ) : (
              <button
                className="primary-button"
                onClick={() => void downloadModel()}
                disabled={!modelReference.trim()}
              >
                Download
              </button>
            )}
          </div>
          {pullStatus && (
            <div className="pull-progress" role="status">
              <span>{pullStatus}</span>
              {pullProgress.total ? (
                <span>
                  {Math.round(((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%
                </span>
              ) : null}
            </div>
          )}
        </div>
        {data.models.length === 0 && (
          <div className="empty-small">
            No models installed yet. Download or add a compatible model to get started.
          </div>
        )}
        {data.models.map((model) => (
          <div className="model-row" key={model.id}>
            <div className="model-symbol">✦</div>
            <div className="model-main">
              <div className="model-title">
                <h3>{model.displayName}</h3>
                <span className={`status-pill ${model.executionLocation}`}>
                  <i />
                  {labelExecutionLocation(model.executionLocation)}
                </span>
                {runningModelIds[model.providerId]?.includes(model.modelId) && (
                  <span className="status-pill on-device">
                    <i />
                    Loaded in runtime
                  </span>
                )}
              </div>
              <p>{model.description}</p>
              <div className="model-tags">
                <span>Tools {labelCapability(model.capabilities.tools)}</span>
                <span>Thinking {labelCapability(model.capabilities.thinking)}</span>
                <span>{model.contextLength?.toLocaleString() ?? '—'} context</span>
                <span>
                  {model.compatibilityStatus === 'not-chat-compatible'
                    ? 'Not chat-compatible'
                    : 'Chat status unknown or ready'}
                </span>
              </div>
              {data.settings.developerMode && (
                <details className="model-details">
                  <summary>Developer details</summary>
                  <small>
                    {[model.family, model.architecture, model.parameterSize, model.quantization]
                      .filter(Boolean)
                      .join(' · ') || 'No additional runtime metadata'}
                    {model.template ? ` · template: ${model.template}` : ''}
                    {model.rawCapabilities?.length
                      ? ` · capabilities: ${model.rawCapabilities.join(', ')}`
                      : ''}
                  </small>
                </details>
              )}
            </div>
            <div className="model-right">
              <strong>
                {runningModelIds[model.providerId]?.includes(model.modelId)
                  ? 'Running'
                  : modelStatusLabel(model)}
              </strong>
              <small>
                {
                  data.assistants.filter((assistant) => assistant.modelProfileId === model.id)
                    .length
                }{' '}
                assistants
              </small>
              {data.providers.find((provider) => provider.id === model.providerId)?.kind ===
                'ollama' && (
                <button className="text-button" onClick={() => void deleteModel(model)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        <div className="model-dropzone">
          <span>⌁</span>
          <div>
            <strong>Bring a local GGUF model</strong>
            <small>
              {ggufSelection
                ? `${ggufSelection.name} · ${(ggufSelection.sizeBytes / 1_000_000).toFixed(1)} MB selected`
                : 'Desktop picker validates and scopes the selected file'}
            </small>
          </div>
          <div>
            <button className="secondary-button" onClick={() => void chooseGguf()}>
              {ggufSelection ? 'Choose another .gguf' : 'Choose .gguf'}
            </button>
            {ggufSelection && (
              <div className="gguf-import-form">
                <label>
                  Ollama model name
                  <input
                    value={ggufModelName}
                    onChange={(event) => setGgufModelName(event.target.value)}
                    maxLength={128}
                  />
                </label>
                {ggufImportController.current ? (
                  <button className="secondary-button" onClick={cancelGguf}>
                    Cancel import
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    onClick={() => void importSelectedGguf()}
                    disabled={!ggufModelName.trim()}
                  >
                    Import into Ollama
                  </button>
                )}
                {ggufImportStatus && <small role="status">{ggufImportStatus}</small>}
              </div>
            )}
          </div>
        </div>
        <div className="hardware-note">
          <strong>Fit guidance</strong>
          <span>
            {hostMemory
              ? `Detected host memory: ${hostMemory}. Model fit still depends on quantization and runtime overhead.`
              : 'Host memory is unavailable here. Juniper will not guess whether a model fits.'}
          </span>
          <small>
            GPU acceleration and throughput remain unknown unless the provider reports them.
          </small>
        </div>
      </div>
    </>
  )
}
function labelCapability(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isChatSelectable(model: ModelProfile): boolean {
  return model.status === 'ready' && model.compatibilityStatus !== 'not-chat-compatible'
}

function modelStatusLabel(model: ModelProfile): string {
  if (model.status === 'not-found') return 'Unavailable'
  if (model.compatibilityStatus === 'not-chat-compatible') return 'Not chat-compatible'
  if (model.compatibilityStatus === 'unknown') return 'Compatibility unknown'
  return 'Ready'
}

function labelExecutionLocation(value: string): string {
  if (value === 'on-device') return 'ON DEVICE'
  if (value === 'local-network') return 'LOCAL NETWORK'
  if (value === 'remote') return 'REMOTE'
  return 'UNKNOWN'
}

function locationForUrl(value: string): 'on-device' | 'local-network' | 'remote' | 'unknown' {
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'on-device'
    if (host.endsWith('.local') || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      return 'local-network'
    }
    return 'remote'
  } catch {
    return 'unknown'
  }
}

function SettingsPage({
  data,
  update,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
}) {
  const settings = data.settings
  const [memoryDraft, setMemoryDraft] = useState('')
  function addMemory(event: FormEvent) {
    event.preventDefault()
    const content = memoryDraft.trim()
    if (!content) return
    const timestamp = now()
    update((current) => ({
      ...current,
      memories: [
        ...current.memories,
        {
          id: uid('memory'),
          content,
          source: 'user',
          enabled: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }))
    setMemoryDraft('')
  }
  return (
    <>
      <PageHeading
        eyebrow="Make Juniper yours"
        title="Settings"
        description="Simple defaults on the surface, deeper controls when you want them."
      />
      <div className="settings-grid">
        <section className="settings-card">
          <span className="eyebrow">Appearance</span>
          <h2>A space that feels like yours</h2>
          <div className="setting-row">
            <div>
              <strong>Theme</strong>
              <small>Choose how Juniper looks</small>
            </div>
            <select
              value={settings.theme}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    theme: event.target.value as AppData['settings']['theme'],
                  },
                }))
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>Accent color</strong>
              <small>Used for focus and assistant identity</small>
            </div>
            <input
              className="color-input"
              type="color"
              value={settings.accent}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, accent: event.target.value },
                }))
              }
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Reduce motion</strong>
              <small>Respect a calmer interface</small>
            </div>
            <button
              className={`switch ${settings.reducedMotion ? 'on' : ''}`}
              onClick={() =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, reducedMotion: !current.settings.reducedMotion },
                }))
              }
              aria-label="Toggle reduced motion"
            >
              <span />
            </button>
          </div>
        </section>
        <section className="settings-card">
          <span className="eyebrow">Experience</span>
          <h2>How Juniper behaves</h2>
          <div className="setting-row">
            <div>
              <strong>Chat density</strong>
              <small>Give messages more breathing room</small>
            </div>
            <select
              value={settings.density}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    density: event.target.value as AppData['settings']['density'],
                  },
                }))
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>Font scale</strong>
              <small>Scales the whole interface</small>
            </div>
            <input
              type="range"
              min="0.9"
              max="1.2"
              step="0.05"
              value={settings.fontScale}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, fontScale: Number(event.target.value) },
                }))
              }
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Developer mode</strong>
              <small>Context inspector and provider details</small>
            </div>
            <button
              className={`switch ${settings.developerMode ? 'on' : ''}`}
              onClick={() =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, developerMode: !current.settings.developerMode },
                }))
              }
              aria-label="Toggle developer mode"
            >
              <span />
            </button>
          </div>
        </section>
        <section className="settings-card full">
          <span className="eyebrow">Advanced</span>
          <h2>Power-user controls</h2>
          <p>
            Provider-specific generation controls are capability-detected and stay out of the normal
            chat screen. No unsupported parameter is sent to a provider.
          </p>
          <div className="advanced-links">
            <button
              onClick={() =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, developerMode: true },
                }))
              }
            >
              Open developer mode <span>→</span>
            </button>
            <button disabled title="Runtime limits are managed by the provider in this release">
              Runtime and process limits <small>Unavailable</small>
            </button>
            <button
              disabled
              title="MCP is an explicitly unavailable advanced feature in this release"
            >
              MCP servers <small>Unavailable</small>
            </button>
          </div>
        </section>
        <section className="settings-card full">
          <span className="eyebrow">Memory</span>
          <h2>Small, visible, and yours</h2>
          <p>
            Juniper only uses memories you can see here. Nothing is silently added to this list.
          </p>
          <form className="memory-form" onSubmit={addMemory}>
            <input
              value={memoryDraft}
              onChange={(event) => setMemoryDraft(event.target.value)}
              placeholder="Add a preference or helpful fact…"
              aria-label="New memory"
              maxLength={1000}
            />
            <button className="primary-button" type="submit">
              Save memory
            </button>
          </form>
          <div className="memory-list">
            {data.memories.length === 0 ? (
              <span className="empty-small">No curated memories yet.</span>
            ) : (
              data.memories.map((memory) => (
                <div className="memory-item" key={memory.id}>
                  <button
                    className={`switch ${memory.enabled ? 'on' : ''}`}
                    onClick={() =>
                      update((current) => ({
                        ...current,
                        memories: current.memories.map((item) =>
                          item.id === memory.id ? { ...item, enabled: !item.enabled } : item,
                        ),
                      }))
                    }
                    aria-label={`Toggle memory ${memory.content}`}
                  >
                    <span />
                  </button>
                  <span>{memory.content}</span>
                  <button
                    className="text-button"
                    onClick={() =>
                      update((current) => ({
                        ...current,
                        memories: current.memories.filter((item) => item.id !== memory.id),
                      }))
                    }
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  )
}

function PrivacyPage({
  data,
  update,
  activeModel,
  activeProvider,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
  activeModel?: ModelProfile
  activeProvider?: ProviderProfile
}) {
  const model = activeModel
  const provider = activeProvider
  function clearChats() {
    if (window.confirm('Clear all saved chats?'))
      update((current) => ({
        ...current,
        conversations: [],
        permissions: current.permissions.filter((grant) => grant.scope !== 'chat'),
      }))
  }
  function clearMemory() {
    if (window.confirm('Clear all curated memories?'))
      update((current) => ({ ...current, memories: [] }))
  }
  return (
    <>
      <PageHeading
        eyebrow="Your data"
        title="Privacy center"
        description="See what stays on this machine and what would leave it."
      />
      <div className="privacy-grid">
        <section className="privacy-card privacy-hero">
          <div className="privacy-orb">✓</div>
          <div>
            <span className="eyebrow">Telemetry</span>
            <h2>Off</h2>
            <p>
              Juniper v0.2 has no analytics, advertising, crash reporting, or automatic conversation
              uploads.
            </p>
          </div>
        </section>
        <section className="privacy-card">
          <span className="eyebrow">Current route</span>
          <div className="privacy-stat">
            <strong>{model?.displayName ?? 'No model selected'}</strong>
            <span className={`status-pill ${model?.executionLocation ?? 'unknown'}`}>
              <i />
              {labelExecutionLocation(model?.executionLocation ?? 'unknown')}
            </span>
          </div>
          <p>
            {model?.executionLocation === 'remote'
              ? `Prompts sent to ${provider?.name ?? 'this provider'} leave the device. This is explicit and visible.`
              : model?.executionLocation === 'on-device'
                ? 'Prompts remain on this device while using this model.'
                : model?.executionLocation === 'local-network'
                  ? 'Prompts are sent to another device on your local network.'
                  : 'Execution location is UNKNOWN until the provider reports enough information.'}
          </p>
        </section>
        <section className="privacy-card">
          <span className="eyebrow">Persistence</span>
          <div className="privacy-stat">
            <strong>
              {data.conversations.filter((chat) => !chat.privateChat).length} saved chats
            </strong>
            <span>{data.memories.filter((memory) => memory.enabled).length} memories on</span>
          </div>
          <p>Private chats are not written to the persistent data store after this session.</p>
        </section>
      </div>
      <div className="privacy-actions">
        <div>
          <span className="eyebrow">You are in control</span>
          <h2>Data actions</h2>
          <p>Exports never include provider API keys.</p>
        </div>
        <div className="action-buttons">
          <button
            className="secondary-button"
            onClick={() =>
              download(
                'juniper-export.json',
                JSON.stringify(
                  {
                    format: 'juniper-export',
                    version: 2,
                    ...data,
                    providers: data.providers.map(redactProvider),
                  },
                  null,
                  2,
                ),
                'application/json',
              )
            }
          >
            Export data
          </button>
          <button className="secondary-button" onClick={clearChats}>
            Clear chats
          </button>
          <button className="secondary-button" onClick={clearMemory}>
            Clear memory
          </button>
        </div>
      </div>
    </>
  )
}

function DiagnosticsPage({ data }: { data: AppData }) {
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({})
  useEffect(() => {
    void getDiagnostics().then(setDiagnostics)
  }, [])
  return (
    <>
      <PageHeading
        eyebrow="Advanced"
        title="Diagnostics"
        description="Truthful runtime details for troubleshooting — never API secrets."
      />
      <div className="diagnostics-grid">
        <section className="diagnostics-card">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div>
              <h2>Runtime</h2>
              <p>Application and host information</p>
            </div>
          </div>
          {Object.entries({
            ...diagnostics,
            database: 'SQLite schema v3',
            telemetry: 'Off',
            models: `${data.models.length} profile(s)`,
          }).map(([key, value]) => (
            <div className="diagnostic-row" key={key}>
              <span>{key.replaceAll('_', ' ')}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
        <section className="diagnostics-card">
          <div className="section-heading">
            <span className="section-number">02</span>
            <div>
              <h2>Provider capabilities</h2>
              <p>Unknown is not treated as supported.</p>
            </div>
          </div>
          {data.providers.map((provider) => (
            <div className="diagnostic-provider" key={provider.id}>
              <div>
                <strong>{provider.name}</strong>
                <small>{provider.baseUrl}</small>
              </div>
              <span className={`status-pill ${provider.transportLocation}`}>
                <i />
                {labelExecutionLocation(provider.transportLocation)}
              </span>
            </div>
          ))}
          <div className="diagnostic-note">
            Model qualification is capability-aware. Real generation qualification is pending until
            the owner chooses an installed model.
          </div>
        </section>
      </div>
    </>
  )
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [runtimeStatus, setRuntimeStatus] = useState('Checking for supported local runtimes…')
  useEffect(() => {
    if (!runningInTauri) {
      setRuntimeStatus('Browser development preview')
      return
    }
    void checkProviderConnection(defaultProvider)
      .then(() => listProviderModels(defaultProvider))
      .then((models) =>
        setRuntimeStatus(
          `Ollama detected · ${models.length} installed model${models.length === 1 ? '' : 's'}`,
        ),
      )
      .catch(() => setRuntimeStatus('Ollama not detected · add a provider in Models'))
  }, [])
  const steps = [
    {
      eyebrow: 'Welcome to Juniper',
      title: 'Your AI. Your models. Your machine.',
      copy: 'A local-first environment that turns compatible models into personal Juniper assistants.',
      art: 'J',
    },
    {
      eyebrow: 'Private by default',
      title: 'Nothing leaves unless you choose it.',
      copy: 'No account required. Local chats stay local. Remote providers and network tools are clearly marked when you opt in.',
      art: '✓',
    },
    {
      eyebrow: 'Start with a model',
      title: 'Bring the intelligence you trust.',
      copy: `${runtimeStatus}. Juniper works with compatible models through supported runtimes; add one in Models when you are ready.`,
      art: '◈',
    },
    {
      eyebrow: 'Meet Juniper',
      title: 'A capable older sister for the things you’re figuring out.',
      copy: 'Warm, practical, direct, and honest about uncertainty. Customize the personality whenever you like.',
      art: '✦',
    },
  ]
  const current = steps[step]!
  return (
    <div className="onboarding-backdrop">
      <div className="onboarding">
        <div className="onboarding-art">
          <div className="onboarding-orb">{current.art}</div>
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <div className="onboarding-progress">
            {steps.map((_, index) => (
              <span key={index} className={index <= step ? 'active' : ''} />
            ))}
          </div>
        </div>
        <div className="onboarding-copy">
          <span className="eyebrow">{current.eyebrow}</span>
          <h1>{current.title}</h1>
          <p>{current.copy}</p>
          <div className="onboarding-actions">
            {step > 0 && (
              <button className="text-button" onClick={() => setStep((value) => value - 1)}>
                Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className="primary-button" onClick={() => setStep((value) => value + 1)}>
                Continue <span>→</span>
              </button>
            ) : (
              <button className="primary-button" onClick={onDone}>
                Enter Juniper <span>→</span>
              </button>
            )}
          </div>
          <small className="onboarding-footnote">
            No account. No telemetry. You can revisit setup in Settings.
          </small>
        </div>
      </div>
    </div>
  )
}

function redactProvider(provider: ProviderProfile): ProviderProfile {
  const safe = { ...provider }
  delete safe.apiKeyRef
  return safe
}
function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export { initialAppData }
