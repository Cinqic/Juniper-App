import { useState } from 'react'
import { builtinTools } from '../lib/defaults'
import type { AppData } from '../types'
import { PageHeading } from './ui'

export function ToolsPage({
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
            They cannot grant permissions. Safe tools run automatically; user-data and filesystem
            tools pause for an explicit Allow once, chat, assistant, or Deny decision.
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
            host permission decision before execution.
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
      <div className="tool-policy-row permission-grants">
        <div>
          <span className="eyebrow">Saved decisions</span>
          <h3>Permission grants</h3>
          <p>Revoke assistant- or chat-scoped access at any time.</p>
        </div>
        <div className="permission-grant-list">
          {data.permissions.length === 0 ? (
            <span className="muted-note">No durable grants saved.</span>
          ) : (
            data.permissions.map((grant) => (
              <div className="permission-grant" key={grant.id}>
                <span>
                  {grant.toolName} · {grant.scope}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      permissions: current.permissions.filter((item) => item.id !== grant.id),
                    }))
                  }
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
