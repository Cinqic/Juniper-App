import type { Assistant, ChatMessage } from '../types'
import { Markdown } from '../lib/markdown'

function textPart(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
}

export function MessageBubble({
  message,
  assistant,
  developerMode = false,
}: {
  message: ChatMessage
  assistant: Assistant
  developerMode?: boolean
}) {
  const user = message.role === 'user'
  const content = textPart(message)
  const reasoning = message.parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text ?? '')
    .join('')
  const toolCalls = message.parts.filter((part) => part.type === 'tool-call')
  const toolResults = message.parts.filter((part) => part.type === 'tool-result')
  const errorPart = message.parts.find((part) => part.type === 'error')
  const error = errorPart?.text
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
        {error ? (
          <>
            <p>{error}</p>
            {developerMode && errorPart?.metadata?.errorCode && (
              <small>Internal code: {errorPart.metadata.errorCode}</small>
            )}
          </>
        ) : content ? (
          <Markdown content={content} />
        ) : null}
      </div>
      {!user && (
        <div className="message-tools">
          {message.modelId && <small>Model: {message.modelId}</small>}
          {message.usage && (
            <small>
              {message.usage.totalTokens
                ? `${message.usage.totalTokens.toLocaleString()} tokens`
                : 'Usage reported'}
            </small>
          )}
          <button onClick={() => void navigator.clipboard?.writeText(content)}>Copy</button>
        </div>
      )}
    </article>
  )
}
