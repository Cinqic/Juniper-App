import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { buildContext } from '../lib/context'
import { defaultAssistant, builtinTools, initialAppData, qwenModel } from '../lib/defaults'
import { parseAssistant, serializeAssistant } from '../lib/assistant'
import {
  checkProviderConnection,
  getDiagnostics,
  listProviderModels,
  saveProviderCredential,
  streamChat,
} from '../lib/runtime'
import { loadAppData, saveAppData } from '../lib/storage'
import { Markdown } from '../lib/markdown'
import type {
  AppData,
  Assistant,
  ChatMessage,
  ChatStreamEvent,
  Conversation,
  MessagePart,
  ModelProfile,
  Page,
  ProviderProfile,
} from '../types'

const navItems: Array<{ id: Page; label: string; icon: string }> = [
  { id: 'chats', label: 'Chats', icon: '✦' },
  { id: 'assistants', label: 'Assistants', icon: '◌' },
  { id: 'models', label: 'Models', icon: '◈' },
  { id: 'tools', label: 'Tools', icon: '⌘' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

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
  return { ...message, parts }
}

export default function App() {
  const [data, setData] = useState<AppData>(loadAppData)
  const [page, setPage] = useState<Page>(data.settings.onboardingComplete ? 'chats' : 'chats')
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    data.conversations[0]?.id ?? null,
  )
  const [activeAssistantId, setActiveAssistantId] = useState(
    data.assistants[0]?.id ?? defaultAssistant.id,
  )
  const [onboardingOpen, setOnboardingOpen] = useState(!data.settings.onboardingComplete)

  useEffect(() => {
    saveAppData(data)
    document.documentElement.dataset.theme = data.settings.theme
    document.documentElement.style.setProperty('--accent', data.settings.accent)
    document.documentElement.style.setProperty('--font-scale', String(data.settings.fontScale))
    document.documentElement.dataset.reducedMotion = String(data.settings.reducedMotion)
  }, [data])

  const update = (change: (current: AppData) => AppData) => setData((current) => change(current))
  const activeAssistant =
    data.assistants.find((assistant) => assistant.id === activeAssistantId) ??
    data.assistants[0] ??
    defaultAssistant
  const activeModel =
    data.models.find((model) => model.id === activeAssistant.modelProfileId) ??
    data.models[0] ??
    qwenModel
  const activeProvider =
    data.providers.find((provider) => provider.id === activeModel.providerId) ?? data.providers[0]

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
            <span className={`status-pill ${activeProvider?.locality ?? 'unknown'}`}>
              <i />
              {activeProvider?.locality === 'remote' ? 'REMOTE' : 'LOCAL'}
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
              activeProvider={activeProvider}
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
          {page === 'privacy' && <PrivacyPage data={data} update={update} />}
          {page === 'diagnostics' && <DiagnosticsPage data={data} />}
        </div>
      </main>
      {onboardingOpen && <Onboarding onDone={completeOnboarding} />}
    </div>
  )
}

function Sidebar({
  page,
  setPage,
  onNewChat,
}: {
  page: Page
  setPage: (page: Page) => void
  onNewChat: () => void
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="leaf-mark">J</span>
        <div>
          <strong>Juniper</strong>
          <small>your AI, your machine</small>
        </div>
      </div>
      <button className="new-chat" onClick={onNewChat}>
        <span>＋</span> New chat
      </button>
      <nav aria-label="Primary navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-footer">
        <button
          className={`nav-item ${page === 'privacy' ? 'active' : ''}`}
          onClick={() => setPage('privacy')}
        >
          <span className="nav-icon">◒</span>Privacy center
        </button>
        <button
          className={`nav-item ${page === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setPage('diagnostics')}
        >
          <span className="nav-icon">⌁</span>Diagnostics
        </button>
        <div className="privacy-note">
          <span className="shield">✓</span>
          <div>
            <strong>Private by default</strong>
            <small>No telemetry is active</small>
          </div>
        </div>
      </div>
    </aside>
  )
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
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
  activeProvider,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
  selectedChatId: string | null
  setSelectedChatId: (id: string) => void
  createChat: (privateChat?: boolean) => Conversation
  activeAssistant: Assistant
  activeModel: ModelProfile
  activeProvider?: ProviderProfile
}) {
  const [query, setQuery] = useState('')
  const [privateMode, setPrivateMode] = useState(false)
  const conversation =
    data.conversations.find((chat) => chat.id === selectedChatId) ?? data.conversations[0]
  const filtered = data.conversations.filter((chat) =>
    chat.title.toLowerCase().includes(query.toLowerCase()),
  )
  function choose(chat: Conversation) {
    setSelectedChatId(chat.id)
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
                    {chat.messages.length ? `${chat.messages.length} messages` : 'Just now'}
                  </small>
                </span>
                <span className="chevron">›</span>
              </button>
            ))
          )}
        </div>
        <button
          className="private-toggle"
          onClick={() => {
            if (!privateMode) createChat(true)
            setPrivateMode((value) => !value)
          }}
        >
          <span className="lock">{privateMode ? '●' : '○'}</span>
          {privateMode ? 'Private chat on' : 'Start private chat'}
        </button>
      </section>
      <section className="chat-main">
        {conversation ? (
          <ConversationView
            data={data}
            update={update}
            conversation={conversation}
            activeAssistant={activeAssistant}
            activeModel={activeModel}
            activeProvider={activeProvider}
            privateMode={privateMode}
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
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
  conversation: Conversation
  activeAssistant: Assistant
  activeModel: ModelProfile
  activeProvider?: ProviderProfile
  privateMode: boolean
}) {
  const [draft, setDraft] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
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
      modelId: activeModel.id,
      providerId: activeProvider?.id,
      isStreaming: true,
    }
    const nextMessages = [...messages, user, assistantMessage]
    const enabledTools =
      activeAssistant.toolPolicy !== 'disabled' && activeModel.capabilities.tools === 'supported'
        ? builtinTools.filter((tool) => tool.enabled && tool.risk === 'automatic-safe')
        : []
    const context = buildContext(
      activeAssistant,
      data.memories,
      nextMessages,
      enabledTools,
      activeModel.contextLength,
    )
    setDraft('')
    setIsGenerating(true)
    controller.current = new AbortController()
    updateConversation((chat) => ({
      ...chat,
      title: chat.title === 'New conversation' ? content.slice(0, 38) : chat.title,
      updatedAt: now(),
      messages: nextMessages,
    }))
    try {
      await streamChat(
        {
          requestId: uid('request'),
          provider: activeProvider ?? data.providers[0]!,
          model: activeModel,
          messages: [
            { role: 'system', content: context.system },
            ...context.conversation.map((item) => {
              const split = item.indexOf(': ')
              return {
                role: (split > 0 ? item.slice(0, split) : 'user') as 'user' | 'assistant',
                content: split > 0 ? item.slice(split + 2) : item,
              }
            }),
            { role: 'user', content },
          ],
          tools: enabledTools,
          generation: activeAssistant.generation,
        },
        (streamEvent) => {
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
      controller.current = null
      composer.current?.focus()
    }
  }
  function stop() {
    controller.current?.abort()
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
              {activeModel.displayName} ·{' '}
              <span className="local-text">
                {activeProvider?.locality === 'remote' ? 'Remote' : 'Local'}
              </span>
            </span>
          </div>
        </div>
        <div className="conversation-actions">
          <button className="text-button" onClick={exportMarkdown}>
            Export
          </button>
          <button className="icon-button" aria-label="Conversation details">
            ···
          </button>
        </div>
      </div>
      <div className="message-scroll">
        {messages.length === 0 ? (
          <div className="conversation-welcome">
            <div className="welcome-orb small">J</div>
            <h2>{activeAssistant.welcomeMessage}</h2>
            <p>Choose a prompt below or write whatever is on your mind.</p>
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
          <label className="composer-icon" aria-label="Attach a file">
            ＋
            <input
              type="file"
              hidden
              accept=".txt,.md,.json,.csv,.toml,.yaml,.yml,.rs,.ts,.tsx,.js,.jsx,.py,.css,.html,text/plain,application/json,text/markdown"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file && file.size <= 1024 * 1024)
                  setDraft(
                    (current) => `${current}${current ? '\n\n' : ''}[Attached: ${file.name}]`,
                  )
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
                disabled={!draft.trim()}
                aria-label="Send message"
              >
                ↑
              </button>
            )}
          </div>
        </div>
        <div className="composer-meta">
          <span>
            {privateMode
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
    </div>
  )
}

function MessageBubble({ message, assistant }: { message: ChatMessage; assistant: Assistant }) {
  const user = message.role === 'user'
  const content = textPart(message)
  const reasoning = message.parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text ?? '')
    .join('')
  const toolCalls = message.parts.filter((part) => part.type === 'tool-call')
  const toolResults = message.parts.filter((part) => part.type === 'tool-result')
  const error = message.parts.find((part) => part.type === 'error')?.text
  return (
    <article className={`message-row ${user ? 'user' : 'assistant'}`}>
      <div className="message-label">
        {user ? (
          'You'
        ) : (
          <>
            <span className="mini-avatar" style={{ background: assistant.accent }}>
              {assistant.avatar}
            </span>
            {assistant.name}
          </>
        )}
      </div>
      <div className={`${error ? 'message-card message-error' : 'message-card'}`}>
        {reasoning && (
          <details className="reasoning-details">
            <summary>Reasoning</summary>
            <p>{reasoning}</p>
          </details>
        )}
        {toolCalls.map((part) => (
          <div className="tool-call-card" key={part.id}>
            <span>Tool requested</span>
            <strong>{part.name}</strong>
            <small>
              {part.status === 'unavailable' ? 'Waiting for host runtime' : part.status}
            </small>
          </div>
        ))}
        {toolResults.map((part) => (
          <div className="tool-result-card" key={part.id}>
            <span>Host result</span>
            <strong>{part.name}</strong>
            <small className={part.status === 'success' ? 'result-success' : 'result-error'}>
              {part.status}
            </small>
            <p>{part.text}</p>
          </div>
        ))}
        {error ? <p>{error}</p> : content ? <Markdown content={content} /> : null}
      </div>
      {!user && (
        <div className="message-tools">
          <button onClick={() => void navigator.clipboard?.writeText(content)}>Copy</button>
          <button>Good response</button>
        </div>
      )}
    </article>
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
                value={assistant.modelProfileId}
                onChange={(event) => set('modelProfileId', event.target.value)}
              >
                {models.map((model) => (
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
  const [providerName, setProviderName] = useState('Local llama.cpp server')
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8080/v1')
  const [apiKey, setApiKey] = useState('')
  const [checkingProvider, setCheckingProvider] = useState<string | null>(null)
  const [refreshingModels, setRefreshingModels] = useState(false)
  async function addProvider() {
    const providerId = uid('provider')
    const apiKeyRef = apiKey.trim() ? uid('credential') : undefined
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
    const provider: ProviderProfile = {
      id: providerId,
      name: providerName,
      kind: baseUrl.includes('11434') ? 'ollama' : 'openai-compatible',
      baseUrl,
      locality: baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost') ? 'local' : 'remote',
      apiKeyRef,
      enabled: true,
      status: 'unknown',
      capabilities: {
        ...(data.providers[0]?.capabilities ?? {
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
    update((current) => ({ ...current, providers: [...current.providers, provider] }))
    setApiKey('')
    setShowProvider(false)
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
  async function refreshModels() {
    setRefreshingModels(true)
    const discovered: Array<{ provider: ProviderProfile; modelIds: string[] }> = []
    for (const provider of data.providers.filter((item) => item.enabled)) {
      try {
        discovered.push({ provider, modelIds: await listProviderModels(provider) })
      } catch {
        // A provider can be offline while another provider remains usable.
      }
    }
    if (discovered.length) {
      update((current) => {
        const models = [...current.models]
        for (const { provider, modelIds } of discovered) {
          for (const modelId of modelIds) {
            const existing = models.find(
              (model) => model.providerId === provider.id && model.modelId === modelId,
            )
            if (existing) {
              existing.status = 'ready'
              continue
            }
            models.push({
              ...qwenModel,
              id: `${provider.id}:${modelId}`,
              providerId: provider.id,
              modelId,
              displayName: modelId,
              locality: provider.locality,
              status: 'ready',
              capabilities: {
                ...qwenModel.capabilities,
                tools: 'unknown',
                parallelTools: 'unknown',
                thinking: 'unknown',
              },
              description: `Discovered from ${provider.name}. Verify capabilities before relying on them.`,
            })
          }
        }
        return { ...current, models }
      })
    }
    setRefreshingModels(false)
  }
  return (
    <>
      <PageHeading
        eyebrow="Infrastructure"
        title="Models"
        description="Models provide inference. Juniper provides the environment around them."
        action={
          <button className="secondary-button" onClick={() => setShowProvider((value) => !value)}>
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
          <button className="primary-button" onClick={() => void addProvider()}>
            Save provider
          </button>
        </div>
      )}
      <div className="provider-stack">
        {data.providers.map((provider) => (
          <div className="provider-card" key={provider.id}>
            <div className="provider-icon">{provider.kind === 'ollama' ? '◉' : '↗'}</div>
            <div className="provider-body">
              <div className="provider-title">
                <h3>{provider.name}</h3>
                <span className={`status-pill ${provider.locality}`}>
                  <i />
                  {provider.locality === 'remote' ? 'REMOTE' : 'LOCAL'}
                </span>
              </div>
              <p>{provider.baseUrl}</p>
              <div className="provider-footer">
                <span>
                  {provider.status === 'connected' ? 'Connected' : 'Connection not checked'}
                </span>
                <button
                  className="text-button"
                  onClick={() => void testProvider(provider)}
                  disabled={checkingProvider === provider.id}
                >
                  {checkingProvider === provider.id ? 'Checking…' : 'Test connection →'}
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
        {data.models.map((model) => (
          <div className="model-row" key={model.id}>
            <div className="model-symbol">✦</div>
            <div className="model-main">
              <div className="model-title">
                <h3>{model.displayName}</h3>
                <span className={`status-pill ${model.locality}`}>
                  <i />
                  {model.locality === 'remote' ? 'REMOTE' : 'LOCAL'}
                </span>
              </div>
              <p>{model.description}</p>
              <div className="model-tags">
                <span>Tools {labelCapability(model.capabilities.tools)}</span>
                <span>Thinking {labelCapability(model.capabilities.thinking)}</span>
                <span>{model.contextLength?.toLocaleString() ?? '—'} context</span>
              </div>
            </div>
            <div className="model-right">
              <strong>{model.status === 'ready' ? 'Ready' : 'Not checked'}</strong>
              <small>
                {
                  data.assistants.filter((assistant) => assistant.modelProfileId === model.id)
                    .length
                }{' '}
                assistants
              </small>
            </div>
          </div>
        ))}
        <div className="model-dropzone">
          <span>⌁</span>
          <div>
            <strong>Bring a local GGUF model</strong>
            <small>Desktop runtime manager · validate, scope, and launch llama-server</small>
          </div>
          <button
            className="secondary-button"
            onClick={() =>
              window.alert(
                'The desktop file picker will be available when running the Tauri shell.',
              )
            }
          >
            Choose .gguf
          </button>
        </div>
      </div>
    </>
  )
}
function labelCapability(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function ToolsPage({
  data,
  update,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <>
      <PageHeading
        eyebrow="Host capabilities"
        title="Tools"
        description="Models can request tools. Only Juniper’s host runtime can execute them and author real results."
        action={<span className="protocol-badge">juniper-tool-protocol-v1</span>}
      />
      <div className="trust-banner">
        <span className="shield">✓</span>
        <div>
          <strong>Permission boundary is active</strong>
          <p>
            Attached files, model output, MCP results, and imported assistants are untrusted data.
            They cannot grant permissions.
          </p>
        </div>
      </div>
      <div className="tool-grid">
        {builtinTools.map((tool) => (
          <div className={`tool-card ${selected === tool.name ? 'expanded' : ''}`} key={tool.name}>
            <div className="tool-card-top">
              <div className="tool-icon">
                {tool.risk === 'automatic-safe' ? '✓' : tool.risk === 'filesystem-read' ? '□' : '◌'}
              </div>
              <span className="risk-label">{tool.risk.replace('-', ' ')}</span>
            </div>
            <h3>{tool.displayName}</h3>
            <p>{tool.description}</p>
            <div className="tool-card-bottom">
              <span className="tool-name">{tool.name}</span>
              <button
                className="tool-toggle"
                aria-label={`Toggle ${tool.displayName}`}
                onClick={() => setSelected(selected === tool.name ? null : tool.name)}
              >
                {selected === tool.name ? 'On' : 'Details'}
              </button>
            </div>
            {selected === tool.name && (
              <pre className="schema-preview">{JSON.stringify(tool.schema, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>
      <div className="tool-policy-row">
        <div>
          <span className="eyebrow">Assistant default</span>
          <h3>{data.assistants[0]?.name ?? 'Juniper'} asks before user-data changes</h3>
          <p>
            Safe deterministic tools may run automatically; memory, chat, and file tools require a
            clear policy.
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() =>
            update((current) => ({
              ...current,
              assistants: current.assistants.map((assistant, index) =>
                index === 0
                  ? {
                      ...assistant,
                      toolPolicy: assistant.toolPolicy === 'ask' ? 'safe-automatic' : 'ask',
                    }
                  : assistant,
              ),
            }))
          }
        >
          Change policy
        </button>
      </div>
    </>
  )
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
            <button>
              Runtime and process limits <span>→</span>
            </button>
            <button>
              MCP servers <span>→</span>
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
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
}) {
  const provider = data.providers[0]
  function clearChats() {
    if (window.confirm('Clear all saved chats?'))
      update((current) => ({ ...current, conversations: [] }))
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
              Juniper v0.1 has no analytics, advertising, crash reporting, or automatic conversation
              uploads.
            </p>
          </div>
        </section>
        <section className="privacy-card">
          <span className="eyebrow">Current route</span>
          <div className="privacy-stat">
            <strong>{provider?.name ?? 'No provider'}</strong>
            <span className={`status-pill ${provider?.locality ?? 'unknown'}`}>
              <i />
              {provider?.locality === 'remote' ? 'REMOTE' : 'LOCAL'}
            </span>
          </div>
          <p>
            {provider?.locality === 'remote'
              ? 'Prompts sent to this provider leave the device. This is explicit and visible.'
              : 'Prompts remain on this machine while using this local provider.'}
          </p>
        </section>
        <section className="privacy-card">
          <span className="eyebrow">Persistence</span>
          <div className="privacy-stat">
            <strong>{data.conversations.length} saved chats</strong>
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
                    version: 1,
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
            database: 'SQLite schema v1',
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
              <span className={`status-pill ${provider.locality}`}>
                <i />
                {provider.locality}
              </span>
            </div>
          ))}
          <div className="diagnostic-note">
            Qwen3 8B is the reference qualification profile. Real-model qualification is pending a
            local Ollama installation.
          </div>
        </section>
      </div>
    </>
  )
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
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
      copy: 'Juniper ships with an Ollama profile and a Qwen3 8B reference profile. You can add providers later in Models.',
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
