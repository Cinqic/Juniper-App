import type { AppSettings } from '../types'

export const JUNIPER_ACCENT = '#32CD32'

/** The legacy rc.1-era sage accent, migrated to the current Juniper green. */
const LEGACY_SAGE_ACCENT = '#6f8f72'

export const MIN_FONT_SCALE = 0.85
export const MAX_FONT_SCALE = 1.3

export const defaultSettings: AppSettings = {
  theme: 'system',
  contrast: 'system',
  accentMode: 'color',
  accent: JUNIPER_ACCENT,
  fontFamily: 'juniper',
  fontScale: 1,
  chatTextSize: 'medium',
  lineSpacing: 'standard',
  density: 'comfortable',
  conversationWidth: 'balanced',
  sidebar: 'auto',
  messageStyle: 'bubbles',
  showTimestamps: false,
  showMessageDetails: false,
  motion: 'system',
  defaultAssistantId: null,
  developerMode: false,
  telemetry: 'off',
  onboardingComplete: false,
}

/** Curated accents. Text and focus variants are still contrast-corrected. */
export const ACCENT_PALETTE: ReadonlyArray<{ name: string; value: string }> = [
  { name: 'Juniper', value: JUNIPER_ACCENT },
  { name: 'Lagoon', value: '#1FA2A6' },
  { name: 'Sky', value: '#3B82F6' },
  { name: 'Iris', value: '#7C6CF0' },
  { name: 'Orchid', value: '#C45BD6' },
  { name: 'Coral', value: '#F2665A' },
  { name: 'Amber', value: '#E8A317' },
]

/** Every enumerated setting and the values Juniper accepts for it. */
export const SETTING_CHOICES = {
  theme: ['system', 'light', 'dark'],
  contrast: ['system', 'standard', 'high'],
  accentMode: ['color', 'neutral'],
  fontFamily: ['juniper', 'system', 'legible', 'dyslexic'],
  chatTextSize: ['small', 'medium', 'large'],
  lineSpacing: ['compact', 'standard', 'relaxed'],
  density: ['compact', 'comfortable', 'spacious'],
  conversationWidth: ['narrow', 'balanced', 'wide'],
  sidebar: ['expanded', 'collapsed', 'auto'],
  messageStyle: ['bubbles', 'minimal'],
  motion: ['system', 'reduced', 'full'],
} as const satisfies { [K in keyof AppSettings]?: ReadonlyArray<AppSettings[K]> }

type ChoiceKey = keyof typeof SETTING_CHOICES

/** Settings that the Appearance and Accessibility reset controls restore. */
export const APPEARANCE_KEYS = [
  'theme',
  'accentMode',
  'accent',
  'fontFamily',
  'chatTextSize',
  'lineSpacing',
  'density',
  'conversationWidth',
  'sidebar',
  'messageStyle',
  'showTimestamps',
  'showMessageDetails',
] as const satisfies ReadonlyArray<keyof AppSettings>

export const ACCESSIBILITY_KEYS = [
  'contrast',
  'fontScale',
  'motion',
] as const satisfies ReadonlyArray<keyof AppSettings>

/**
 * Returns a `#RRGGBB` string for a 3- or 6-digit hex colour, or `null`.
 *
 * Accent values are written into CSS custom properties, so anything that is
 * not strictly a hex colour is rejected rather than sanitised.
 */
export function parseHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed)
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase()
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : null
}

function choice<K extends ChoiceKey>(key: K, value: unknown): AppSettings[K] {
  const allowed = SETTING_CHOICES[key] as ReadonlyArray<unknown>
  return (allowed.includes(value) ? value : defaultSettings[key]) as AppSettings[K]
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function clampFontScale(value: unknown): number {
  const number = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(number)) return defaultSettings.fontScale
  const clamped = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, number))
  return Math.round(clamped * 20) / 20
}

/**
 * Normalises stored settings field by field.
 *
 * A malformed or unknown value falls back to that field's default only, so one
 * bad field never discards the user's other preferences. rc.32 and earlier
 * stored `reducedMotion: boolean` and a two-value `density`; both still load.
 */
export function normalizeSettings(value: unknown): AppSettings {
  const raw: Record<string, unknown> =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const parsedAccent = parseHexColor(raw.accent)
  const accent =
    parsedAccent === null || parsedAccent === LEGACY_SAGE_ACCENT.toUpperCase()
      ? JUNIPER_ACCENT
      : parsedAccent
  const motion =
    raw.motion === undefined && raw.reducedMotion === true
      ? 'reduced'
      : choice('motion', raw.motion)
  return {
    theme: choice('theme', raw.theme),
    contrast: choice('contrast', raw.contrast),
    accentMode: choice('accentMode', raw.accentMode),
    accent,
    fontFamily: choice('fontFamily', raw.fontFamily),
    fontScale: clampFontScale(raw.fontScale),
    chatTextSize: choice('chatTextSize', raw.chatTextSize),
    lineSpacing: choice('lineSpacing', raw.lineSpacing),
    density: choice('density', raw.density),
    conversationWidth: choice('conversationWidth', raw.conversationWidth),
    sidebar: choice('sidebar', raw.sidebar),
    messageStyle: choice('messageStyle', raw.messageStyle),
    showTimestamps: bool(raw.showTimestamps, defaultSettings.showTimestamps),
    showMessageDetails: bool(raw.showMessageDetails, defaultSettings.showMessageDetails),
    motion,
    defaultAssistantId:
      typeof raw.defaultAssistantId === 'string' && raw.defaultAssistantId
        ? raw.defaultAssistantId
        : null,
    developerMode: bool(raw.developerMode, defaultSettings.developerMode),
    telemetry: 'off',
    onboardingComplete: bool(raw.onboardingComplete, defaultSettings.onboardingComplete),
  }
}

export function resetSettings(
  settings: AppSettings,
  keys: ReadonlyArray<keyof AppSettings>,
): AppSettings {
  const next = { ...settings } as Record<keyof AppSettings, unknown>
  for (const key of keys) next[key] = defaultSettings[key]
  return next as unknown as AppSettings
}
