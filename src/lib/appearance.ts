import type { AppSettings } from '../types'
import { parseHexColor } from './settings'

export type ResolvedTheme = 'light' | 'dark'

interface Rgb {
  r: number
  g: number
  b: number
}

function toRgb(hex: string): Rgb {
  const value = parseHexColor(hex) ?? '#000000'
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  }
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = toRgb(hex)
  const linear = (value: number) => {
    const srgb = value / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG 2.x contrast ratio between two opaque colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  const [light, dark] = first > second ? [first, second] : [second, first]
  return (light + 0.05) / (dark + 0.05)
}

export function mix(a: string, b: string, amountOfB: number): string {
  const first = toRgb(a)
  const second = toRgb(b)
  const t = Math.min(1, Math.max(0, amountOfB))
  return toHex({
    r: first.r + (second.r - first.r) * t,
    g: first.g + (second.g - first.g) * t,
    b: first.b + (second.b - first.b) * t,
  })
}

/**
 * Moves `color` toward `target` in small steps until it reaches `minimum`
 * contrast against every background. The target is black or white, so the
 * loop always terminates with a passing colour.
 */
export function ensureContrast(
  color: string,
  backgrounds: string[],
  minimum: number,
  target: '#000000' | '#FFFFFF',
): string {
  for (let step = 0; step <= 50; step += 1) {
    const candidate = mix(color, target, step / 50)
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= minimum))
      return candidate
  }
  return target
}

/** Black or white, whichever reads better on `background`. Always ≥ 4.58:1. */
export function readableOn(background: string): '#000000' | '#FFFFFF' {
  return contrastRatio('#000000', background) >= contrastRatio('#FFFFFF', background)
    ? '#000000'
    : '#FFFFFF'
}

interface Palette {
  bg: string
  surface: string
  surfaceRaised: string
  surfaceSunken: string
  ink: string
  muted: string
  faint: string
  line: string
  lineStrong: string
  danger: string
  warning: string
  success: string
}

const BASE: Record<ResolvedTheme, Palette> = {
  light: {
    bg: '#FAFAF8',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#F1F2EE',
    ink: '#16181A',
    muted: '#5A5F66',
    faint: '#6B7078',
    line: '#E3E4E0',
    lineStrong: '#C9CBC5',
    danger: '#B42318',
    warning: '#8A5A00',
    success: '#1E7A1E',
  },
  dark: {
    bg: '#0F1011',
    surface: '#17181A',
    surfaceRaised: '#1E1F22',
    surfaceSunken: '#0A0B0C',
    ink: '#F2F3F5',
    muted: '#A6AAB0',
    faint: '#8E939A',
    line: '#2A2C30',
    lineStrong: '#3C3F44',
    danger: '#FF8A80',
    warning: '#E5B567',
    success: '#6DDB6D',
  },
}

const HIGH_CONTRAST: Record<ResolvedTheme, Partial<Palette>> = {
  light: {
    bg: '#FFFFFF',
    surfaceSunken: '#F0F0F0',
    ink: '#000000',
    muted: '#303236',
    faint: '#3D4046',
    line: '#6B6F76',
    lineStrong: '#202226',
    danger: '#8F1A10',
    warning: '#5C3C00',
    success: '#0E520E',
  },
  dark: {
    bg: '#000000',
    surface: '#0B0B0C',
    surfaceRaised: '#141416',
    surfaceSunken: '#000000',
    ink: '#FFFFFF',
    muted: '#D6D8DC',
    faint: '#C4C7CC',
    line: '#8A8E95',
    lineStrong: '#E0E2E6',
    danger: '#FFB3AB',
    warning: '#FFD591',
    success: '#9EF09E',
  },
}

export interface AppearanceInputs {
  settings: Pick<AppSettings, 'accent' | 'accentMode'>
  theme: ResolvedTheme
  highContrast: boolean
}

/**
 * Derives every colour token from validated settings.
 *
 * The chosen accent is used as-is only where it is a fill behind `--on-accent`
 * text (which is picked for contrast). Wherever the accent is text, an icon, or
 * a focus ring, a contrast-corrected `--accent-ink` is used instead, so no
 * palette or custom colour can produce unreadable text.
 */
export function colorTokens({ settings, theme, highContrast }: AppearanceInputs) {
  const palette: Palette = { ...BASE[theme], ...(highContrast ? HIGH_CONTRAST[theme] : {}) }
  const textMinimum = highContrast ? 7 : 4.5
  const toward = theme === 'light' ? '#000000' : '#FFFFFF'
  const surfaces = [palette.bg, palette.surface, palette.surfaceRaised, palette.surfaceSunken]
  const accent =
    settings.accentMode === 'neutral'
      ? theme === 'light'
        ? '#1F2124'
        : '#E8E9EB'
      : (parseHexColor(settings.accent) ?? '#32CD32')
  const accentInk = ensureContrast(accent, surfaces, textMinimum, toward)
  const accentSoft = mix(palette.surface, accent, theme === 'light' ? 0.12 : 0.18)
  const userBubble = mix(palette.surfaceSunken, accent, theme === 'light' ? 0.07 : 0.1)
  return {
    '--bg': palette.bg,
    '--surface': palette.surface,
    '--surface-raised': palette.surfaceRaised,
    '--surface-sunken': palette.surfaceSunken,
    '--ink': palette.ink,
    '--muted': ensureContrast(palette.muted, surfaces, textMinimum, toward),
    '--faint': ensureContrast(palette.faint, surfaces, 4.5, toward),
    '--line': palette.line,
    '--line-strong': palette.lineStrong,
    '--danger': ensureContrast(palette.danger, surfaces, textMinimum, toward),
    '--warning': ensureContrast(palette.warning, surfaces, textMinimum, toward),
    '--success': ensureContrast(palette.success, surfaces, textMinimum, toward),
    '--accent': accent,
    '--on-accent': readableOn(accent),
    '--accent-ink': accentInk,
    '--accent-soft': accentSoft,
    '--on-accent-soft': ensureContrast(palette.ink, [accentSoft], textMinimum, toward),
    '--user-bubble': userBubble,
    '--focus': accentInk,
  } as const
}

const FONT_STACKS: Record<AppSettings['fontFamily'], string> = {
  juniper: "'Inter Variable', ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif",
  system:
    "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif",
  legible:
    "'Atkinson Hyperlegible Next Variable', ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif",
  dyslexic: "'OpenDyslexic', ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif",
}

export function layoutTokens(settings: AppSettings) {
  return {
    '--font-ui': FONT_STACKS[settings.fontFamily],
    '--font-scale': String(settings.fontScale),
    '--density': { compact: '0.8', comfortable: '1', spacious: '1.2' }[settings.density],
    '--chat-font-size': { small: '0.9375rem', medium: '1rem', large: '1.125rem' }[
      settings.chatTextSize
    ],
    '--chat-line-height': { compact: '1.45', standard: '1.6', relaxed: '1.8' }[
      settings.lineSpacing
    ],
    '--conversation-width': { narrow: '40rem', balanced: '48rem', wide: '64rem' }[
      settings.conversationWidth
    ],
  } as const
}

export function systemPrefers(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
}

export function resolveTheme(settings: Pick<AppSettings, 'theme'>): ResolvedTheme {
  if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme
  return systemPrefers('(prefers-color-scheme: dark)') ? 'dark' : 'light'
}

export function resolveHighContrast(settings: Pick<AppSettings, 'contrast'>): boolean {
  if (settings.contrast === 'high') return true
  if (settings.contrast === 'standard') return false
  return systemPrefers('(prefers-contrast: more)') || systemPrefers('(forced-colors: active)')
}

export function resolveReducedMotion(settings: Pick<AppSettings, 'motion'>): boolean {
  if (settings.motion === 'reduced') return true
  if (settings.motion === 'full') return false
  return systemPrefers('(prefers-reduced-motion: reduce)')
}

/** Writes the resolved appearance onto the document root. */
export function applyAppearance(root: HTMLElement, settings: AppSettings): void {
  const theme = resolveTheme(settings)
  const highContrast = resolveHighContrast(settings)
  const tokens = {
    ...colorTokens({ settings, theme, highContrast }),
    ...layoutTokens(settings),
  }
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
  root.dataset.theme = theme
  root.dataset.contrast = highContrast ? 'high' : 'standard'
  root.dataset.motion = resolveReducedMotion(settings) ? 'reduced' : 'full'
  root.dataset.density = settings.density
  root.dataset.messageStyle = settings.messageStyle
  root.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', tokens['--bg'])
}
