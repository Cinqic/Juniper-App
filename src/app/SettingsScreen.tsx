import { useEffect, useRef } from 'react'
import type { AppData, SettingsSection } from '../types'
import { AssistantsSettings } from './AssistantsSettings'
import { historyDepth } from './history'
import { ConnectionsSettings, ModelsRuntimeSettings } from './ConnectionsSettings'
import { Icon } from './icons'
import type { IconName } from './icons'
import type { ConversationRoute } from './model-labels'
import {
  AboutSettings,
  AccessibilitySettings,
  AdvancedSettings,
  AppearanceSettings,
  DiagnosticsSettings,
  GeneralSettings,
  MemorySettings,
  PrivacySettings,
  ToolsSettings,
} from './SettingsSections'
import { PageHeader } from './ui'

type Update = (change: (current: AppData) => AppData) => void

interface SectionInfo {
  id: SettingsSection
  label: string
  icon: IconName
  description: string
}

export const SETTINGS_GROUPS: Array<{ label?: string; sections: SectionInfo[] }> = [
  {
    sections: [
      { id: 'general', label: 'General', icon: 'settings', description: 'New chats and shortcuts' },
      {
        id: 'appearance',
        label: 'Appearance',
        icon: 'palette',
        description: 'Theme, color, text, layout',
      },
      {
        id: 'accessibility',
        label: 'Accessibility',
        icon: 'accessibility',
        description: 'Contrast, size, motion',
      },
    ],
  },
  {
    label: 'Assistants & models',
    sections: [
      {
        id: 'assistants',
        label: 'Assistants',
        icon: 'person',
        description: 'Personalities and defaults',
      },
      {
        id: 'models-runtime',
        label: 'Models & runtime',
        icon: 'runtime',
        description: 'Local engine and imports',
      },
      {
        id: 'connections',
        label: 'Connections',
        icon: 'link',
        description: 'Providers and Device Link',
      },
    ],
  },
  {
    label: 'Privacy & safety',
    sections: [
      {
        id: 'tools',
        label: 'Tools & permissions',
        icon: 'tool',
        description: 'What assistants may do',
      },
      { id: 'memory', label: 'Memory', icon: 'memory', description: 'What Juniper remembers' },
      {
        id: 'privacy',
        label: 'Privacy & data',
        icon: 'shield',
        description: 'Route, export, and clearing',
      },
    ],
  },
  {
    label: 'More',
    sections: [
      {
        id: 'advanced',
        label: 'Advanced',
        icon: 'code',
        description: 'Developer mode and diagnostics',
      },
      { id: 'about', label: 'About', icon: 'about', description: 'Version and licenses' },
    ],
  },
]

const DIAGNOSTICS: SectionInfo = {
  id: 'diagnostics',
  label: 'Diagnostics',
  icon: 'pulse',
  description: 'Runtime details',
}

export function sectionInfo(id: SettingsSection): SectionInfo {
  return (
    SETTINGS_GROUPS.flatMap((group) => group.sections).find((section) => section.id === id) ??
    DIAGNOSTICS
  )
}

export function SettingsScreen({
  data,
  update,
  section,
  openSection,
  twoPane,
  route,
  currentConversation,
  onReplayWelcome,
}: {
  data: AppData
  update: Update
  /** `null` shows the section list on narrow screens. */
  section: SettingsSection | null
  openSection: (section: SettingsSection | null, options?: { replace?: boolean }) => void
  twoPane: boolean
  route: ConversationRoute
  currentConversation?: AppData['conversations'][number]
  onReplayWelcome: () => void
}) {
  const active = section ?? (twoPane ? 'general' : null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (section) heading.current?.focus({ preventScroll: true })
  }, [section])

  const nav = (
    <nav className="settings-nav" aria-label="Settings sections">
      {SETTINGS_GROUPS.map((group, index) => (
        <div className="settings-nav-group" key={group.label ?? index}>
          {group.label && <h2>{group.label}</h2>}
          <ul>
            {group.sections.map((item) => {
              const current =
                active === item.id || (item.id === 'advanced' && active === 'diagnostics')
              return (
                <li key={item.id}>
                  <button
                    className={`settings-nav-item ${current ? 'active' : ''}`}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => openSection(item.id)}
                  >
                    <Icon name={item.icon} size={20} />
                    <span className="settings-nav-text">
                      <span>{item.label}</span>
                      {!twoPane && <small>{item.description}</small>}
                    </span>
                    {!twoPane && <Icon name="chevronRight" size={18} />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )

  if (!active) {
    return (
      <div className="page settings-page">
        <PageHeader title="Settings" />
        {nav}
      </div>
    )
  }

  const info = sectionInfo(active)
  // Go back through history when possible, so the back arrow and Android back
  // agree; replacing the entry would leave the previous screen on the stack twice.
  const back =
    active === 'diagnostics' || !twoPane
      ? () => {
          if (historyDepth() > 0) window.history.back()
          else openSection(active === 'diagnostics' ? 'advanced' : null, { replace: true })
        }
      : undefined

  return (
    <div className={`page settings-page ${twoPane ? 'two-pane' : ''}`}>
      {twoPane && (
        <aside className="settings-sidebar">
          <PageHeader title="Settings" />
          {nav}
        </aside>
      )}
      <div className="settings-content">
        <header className="page-header">
          {back && (
            <button
              className="icon-button page-back"
              onClick={back}
              aria-label={active === 'diagnostics' ? 'Back to Advanced' : 'Back to Settings'}
            >
              <Icon name="back" />
            </button>
          )}
          <div className="page-header-text">
            <h1 ref={heading} tabIndex={-1}>
              {info.label}
            </h1>
          </div>
        </header>
        {active === 'general' && (
          <GeneralSettings data={data} update={update} onReplayWelcome={onReplayWelcome} />
        )}
        {active === 'appearance' && <AppearanceSettings data={data} update={update} />}
        {active === 'accessibility' && (
          <AccessibilitySettings data={data} update={update} openSection={openSection} />
        )}
        {active === 'assistants' && <AssistantsSettings data={data} update={update} />}
        {active === 'models-runtime' && <ModelsRuntimeSettings data={data} update={update} />}
        {active === 'connections' && <ConnectionsSettings data={data} update={update} />}
        {active === 'tools' && <ToolsSettings data={data} update={update} />}
        {active === 'memory' && <MemorySettings data={data} update={update} />}
        {active === 'privacy' && (
          <PrivacySettings
            data={data}
            update={update}
            route={route}
            currentConversation={currentConversation}
          />
        )}
        {active === 'advanced' && (
          <AdvancedSettings data={data} update={update} openSection={openSection} />
        )}
        {active === 'diagnostics' && <DiagnosticsSettings data={data} />}
        {active === 'about' && <AboutSettings data={data} />}
      </div>
    </div>
  )
}
