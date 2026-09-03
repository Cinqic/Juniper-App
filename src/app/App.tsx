import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { buildContext, type ContextSummary } from '../lib/context'
import { defaultAssistant, builtinTools, initialAppData } from '../lib/defaults'
import {
  checkProviderConnection,
  cancelChat,
  loadNativeAppData,
  pickAttachment,
  readAttachment,
  resolvePermission,
  runningInTauri,
  saveNativeAppData,
  listProviderModels,
  streamChat,
} from '../lib/runtime'
import { loadAppData, saveAppData } from '../lib/storage'
import { MessageBubble } from './MessageBubble'
import { ToolsPage } from './ToolsPage'
import { AssistantAvatar, JuniperMark } from './branding'
import { ModelsMarket } from './ModelsMarket'
import {
  AssistantsPage,
  DiagnosticsPage,
  ModelsPage,
  Onboarding,
  PrivacyPage,
  SettingsPage,
  download,
  isChatSelectable,
  labelExecutionLocation,
} from './pages'
import { Sidebar } from './ui'
import type {
  AppData,
  Assistant,
  AttachmentRecord,
  ChatMessage,
  ChatStreamEvent,
  Conversation,
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

function errorCodeFromMessage(message: string): string | undefined {
  return message.match(/^[A-Z][A-Z0-9_]+:/)?.[0].slice(0, -1)
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
  const [page, setPage] = useState<Page>('chats')
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
        update((current) => {
          const currentProvider = current.providers.find((item) => item.id === provider.id)
          if (!currentProvider || currentProvider.status === 'connected') return current
          return {
            ...current,
            providers: current.providers.map((item) =>
              item.id === provider.id ? { ...item, status: 'connected' } : item,
            ),
          }
        })
        return listProviderModels(provider)
      })
      .then((models) => {
        if (!models) return
        update((current) => {
          const next = [...current.models]
          for (const discovered of models) {
            const existingIndex = next.findIndex(
              (model) => model.providerId === provider.id && model.modelId === discovered.modelId,
            )
            if (existingIndex >= 0) {
              next[existingIndex] = { ...next[existingIndex]!, status: 'ready' }
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
      .catch(() => {
        update((current) => {
          const currentProvider = current.providers.find((item) => item.id === provider.id)
          if (!currentProvider || currentProvider.status === 'offline') return current
          return {
            ...current,
            providers: current.providers.map((item) =>
              item.id === provider.id ? { ...item, status: 'offline' } : item,
            ),
          }
        })
      })
  }, [data.providers, hydrated])

  const update = (change: (current: AppData) => AppData) => setData((current) => change(current))
  const activeAssistant =
    data.assistants.find((assistant) => assistant.id === activeAssistantId) ??
    data.assistants[0] ??
    defaultAssistant
  const activeModel = data.models.find(
    (model) => model.id === activeAssistant.modelProfileId && isChatSelectable(model),
  )
  const selectedConversation = data.conversations.find((chat) => chat.id === selectedChatId)
  const currentModel = selectedConversation?.modelProfileId
    ? data.models.find((model) => model.id === selectedConversation.modelProfileId)
    : activeModel
  const currentProvider = currentModel
    ? data.providers.find((provider) => provider.id === currentModel.providerId)
    : undefined
  const currentAssistant = selectedConversation
    ? (data.assistants.find((assistant) => assistant.id === selectedConversation.assistantId) ??
      activeAssistant)
    : activeAssistant

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
            <JuniperMark className="brand-mark" alt="" aria-hidden="true" />
            <span>Juniper</span>
          </div>
          <div className="topbar-context">
            <span className="eyebrow">{page === 'chats' ? 'Personal space' : page}</span>
            <span className={`status-pill ${currentModel?.executionLocation ?? 'unknown'}`}>
              <i />
              {labelExecutionLocation(currentModel?.executionLocation ?? 'unknown')}
            </span>
          </div>
          <button
            className="avatar-button"
            aria-label="Open settings"
            onClick={() => setPage('settings')}
          >
            <AssistantAvatar assistant={activeAssistant} className="avatar-button-mark" />
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
          {page === 'models' && (
            <>
              <ModelsMarket data={data} update={update} />
              <ModelsPage data={data} update={update} />
            </>
          )}
          {page === 'tools' && <ToolsPage data={data} update={update} />}
          {page === 'settings' && <SettingsPage data={data} update={update} navigate={setPage} />}
          {page === 'privacy' && (
            <PrivacyPage
              data={data}
              update={update}
              activeAssistant={currentAssistant}
              activeModel={currentModel}
              activeProvider={currentProvider}
              currentConversation={selectedConversation}
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
      attachments: current.attachments.filter(
        (attachment) => attachment.conversationId !== conversation.id,
      ),
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
            // Remount per conversation so the draft, staged attachments, and
            // context inspector never carry over into a different chat.
            key={conversation.id}
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
      <JuniperMark className="welcome-orb" alt="Juniper" />
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
          permissionGrants: data.permissions.filter(
            (grant) =>
              grant.assistantId === activeAssistant.id &&
              (grant.scope === 'assistant' || grant.conversationId === conversation.id),
          ),
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
                      parts: [
                        {
                          id: uid('part'),
                          type: 'error',
                          text: streamEvent.error?.message,
                          metadata: streamEvent.error?.code
                            ? { errorCode: streamEvent.error.code }
                            : undefined,
                        },
                      ],
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
                parts: [
                  {
                    id: uid('part'),
                    type: 'error',
                    text: message,
                    metadata: errorCodeFromMessage(message)
                      ? { errorCode: errorCodeFromMessage(message)! }
                      : undefined,
                  },
                ],
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
      const metadata: AttachmentRecord = {
        id: attachment.id,
        conversationId: conversation.id,
        name: attachment.name,
        sizeBytes: attachment.sizeBytes,
        contentType: attachment.contentType,
      }
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
      update((current) => ({
        ...current,
        attachments: [...current.attachments.filter((item) => item.id !== metadata.id), metadata],
      }))
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
          <AssistantAvatar assistant={activeAssistant} />
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
            <AssistantAvatar assistant={activeAssistant} className="welcome-orb small" />
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
            <MessageBubble
              key={message.id}
              message={message}
              assistant={activeAssistant}
              developerMode={data.settings.developerMode}
            />
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
                  const metadata: AttachmentRecord = {
                    id: attachment.id,
                    conversationId: conversation.id,
                    name: file.name,
                    sizeBytes: file.size,
                    contentType: file.type || 'text/plain',
                  }
                  setAttachments((current) => [...current, attachment])
                  update((current) => ({
                    ...current,
                    attachments: [
                      ...current.attachments.filter((item) => item.id !== metadata.id),
                      metadata,
                    ],
                  }))
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
