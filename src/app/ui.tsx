import type { ReactNode } from 'react'
import type { Page } from '../types'
import { JuniperMark } from './branding'

const navItems: Array<{ id: Page; label: string; icon: string }> = [
  { id: 'chats', label: 'Chats', icon: '✦' },
  { id: 'assistants', label: 'Assistants', icon: '◌' },
  { id: 'models', label: 'Models', icon: '◈' },
  { id: 'tools', label: 'Tools', icon: '⌘' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

export function Sidebar({
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
        <JuniperMark className="brand-mark" alt="" aria-hidden="true" />
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

export function PageHeading({
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
