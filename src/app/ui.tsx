import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { ExecutionLocation } from '../types'
import { randomUuid } from '../lib/ids'
import { Icon } from './icons'

export function PageHeader({
  title,
  description,
  action,
  onBack,
  backLabel,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  onBack?: () => void
  backLabel?: string
}) {
  return (
    <header className="page-header">
      {onBack && (
        <button className="icon-button page-back" onClick={onBack} aria-label={backLabel ?? 'Back'}>
          <Icon name="back" />
        </button>
      )}
      <div className="page-header-text">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </header>
  )
}

export function Section({
  title,
  description,
  children,
  action,
}: {
  title?: string
  description?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  const id = useId()
  return (
    <section className="settings-group" aria-labelledby={title ? id : undefined}>
      {(title || action) && (
        <div className="settings-group-header">
          <div>
            {title && <h2 id={id}>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="settings-group-body">{children}</div>
    </section>
  )
}

/**
 * A labelled setting. `control` receives ids to wire up: form controls use
 * `id` (the row renders a `<label for>`); groups such as segmented controls set
 * `group` and use `labelledBy`, because a label cannot point at a group.
 */
export function Row({
  label,
  description,
  control,
  stacked = false,
  group = false,
}: {
  label: string
  description?: ReactNode
  control: (ids: { id: string; labelledBy: string; describedBy?: string }) => ReactNode
  stacked?: boolean
  group?: boolean
}) {
  const id = useId()
  const labelId = useId()
  const descriptionId = useId()
  return (
    <div className={`setting-row ${stacked ? 'stacked' : ''}`}>
      <div className="setting-text">
        {group ? (
          <span className="label" id={labelId}>
            {label}
          </span>
        ) : (
          <label htmlFor={id} id={labelId}>
            {label}
          </label>
        )}
        {description && <small id={descriptionId}>{description}</small>}
      </div>
      <div className="setting-control">
        {control({ id, labelledBy: labelId, describedBy: description ? descriptionId : undefined })}
      </div>
    </div>
  )
}

export function Switch({
  id,
  checked,
  onChange,
  label,
  describedBy,
  disabled,
}: {
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  describedBy?: string
  disabled?: boolean
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  describedBy,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  describedBy?: string
}) {
  const name = useId()
  // The accessible name stays on the group itself so tests and assistive
  // technology can find it whether or not a visible row label exists.
  return (
    <div className="segmented" role="radiogroup" aria-label={label} aria-describedby={describedBy}>
      {options.map((option) => (
        <label key={option.value} className={value === option.value ? 'selected' : ''}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}

export function labelExecutionLocation(value: ExecutionLocation | string | undefined): string {
  if (value === 'on-device') return 'ON DEVICE'
  if (value === 'local-network') return 'LOCAL NETWORK'
  if (value === 'remote') return 'REMOTE'
  return 'UNKNOWN'
}

export function LocationBadge({ location }: { location: ExecutionLocation | undefined }) {
  const value = location ?? 'unknown'
  return (
    <span className={`location-badge ${value}`}>
      <i aria-hidden="true" />
      {labelExecutionLocation(value)}
    </span>
  )
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener?.('change', onChange)
    return () => list.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}

/** Phones and tablets without a precise pointer: Enter inserts a newline there. */
export function useTouchPrimary(): boolean {
  return useMediaQuery('(hover: none) and (pointer: coarse)')
}

export function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function uid(prefix: string): string {
  return `${prefix}-${randomUuid()}`
}

export function now(): string {
  return new Date().toISOString()
}
