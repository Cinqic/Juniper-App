import { describe, expect, it } from 'vitest'
import {
  applyAppearance,
  colorTokens,
  contrastRatio,
  ensureContrast,
  layoutTokens,
  readableOn,
} from './appearance'
import { ACCENT_PALETTE, defaultSettings, normalizeSettings } from './settings'

function sampledAccents(): string[] {
  const values: string[] = ACCENT_PALETTE.map((item) => item.value)
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51) {
        values.push(
          `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`,
        )
      }
  return values
}

describe('contrast maths', () => {
  it('matches the WCAG reference ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
  })

  it('always finds a readable foreground for any fill', () => {
    for (const accent of sampledAccents()) {
      expect(contrastRatio(readableOn(accent), accent)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('ensureContrast reaches the requested ratio against every background', () => {
    const color = ensureContrast('#FFFF00', ['#FFFFFF', '#FAFAF8'], 4.5, '#000000')
    expect(contrastRatio(color, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(color, '#FAFAF8')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('colour tokens', () => {
  const surfaceKeys = ['--bg', '--surface', '--surface-raised', '--surface-sunken'] as const

  for (const theme of ['light', 'dark'] as const) {
    for (const highContrast of [false, true]) {
      const minimum = highContrast ? 7 : 4.5
      it(`keeps every accent readable in ${theme}${highContrast ? ' high contrast' : ''}`, () => {
        for (const accent of sampledAccents()) {
          for (const accentMode of ['color', 'neutral'] as const) {
            const tokens = colorTokens({ settings: { accent, accentMode }, theme, highContrast })
            for (const surface of surfaceKeys) {
              expect(contrastRatio(tokens['--accent-ink'], tokens[surface])).toBeGreaterThanOrEqual(
                minimum,
              )
              expect(contrastRatio(tokens['--ink'], tokens[surface])).toBeGreaterThanOrEqual(
                minimum,
              )
              expect(contrastRatio(tokens['--muted'], tokens[surface])).toBeGreaterThanOrEqual(
                minimum,
              )
              expect(contrastRatio(tokens['--faint'], tokens[surface])).toBeGreaterThanOrEqual(4.5)
              expect(contrastRatio(tokens['--danger'], tokens[surface])).toBeGreaterThanOrEqual(
                minimum,
              )
              expect(contrastRatio(tokens['--focus'], tokens[surface])).toBeGreaterThanOrEqual(3)
            }
            expect(contrastRatio(tokens['--on-accent'], tokens['--accent'])).toBeGreaterThanOrEqual(
              4.5,
            )
            expect(
              contrastRatio(tokens['--on-accent-soft'], tokens['--accent-soft']),
            ).toBeGreaterThanOrEqual(minimum)
            expect(contrastRatio(tokens['--ink'], tokens['--user-bubble'])).toBeGreaterThanOrEqual(
              minimum,
            )
            // Danger buttons draw --bg text on a --danger fill.
            expect(contrastRatio(tokens['--bg'], tokens['--danger'])).toBeGreaterThanOrEqual(4.5)
          }
        }
      })
    }
  }

  it('negative control: the raw accent alone would fail as text', () => {
    // Without --accent-ink, a yellow accent used as link text is unreadable.
    expect(contrastRatio('#FFFF00', '#FFFFFF')).toBeLessThan(4.5)
    const tokens = colorTokens({
      settings: { accent: '#FFFF00', accentMode: 'color' },
      theme: 'light',
      highContrast: false,
    })
    expect(tokens['--accent']).toBe('#FFFF00')
    expect(tokens['--accent-ink']).not.toBe('#FFFF00')
  })
})

describe('layout tokens and document application', () => {
  it('maps every layout option to a distinct token value', () => {
    const densities = (['compact', 'comfortable', 'spacious'] as const).map(
      (density) => layoutTokens({ ...defaultSettings, density })['--density'],
    )
    expect(new Set(densities).size).toBe(3)
    const widths = (['narrow', 'balanced', 'wide'] as const).map(
      (conversationWidth) =>
        layoutTokens({ ...defaultSettings, conversationWidth })['--conversation-width'],
    )
    expect(new Set(widths).size).toBe(3)
    const fonts = (['juniper', 'system', 'legible', 'dyslexic'] as const).map(
      (fontFamily) => layoutTokens({ ...defaultSettings, fontFamily })['--font-ui'],
    )
    expect(new Set(fonts).size).toBe(4)
    expect(fonts.every((stack) => !/https?:/.test(stack))).toBe(true)
    const sizes = (['small', 'medium', 'large'] as const).map(
      (chatTextSize) => layoutTokens({ ...defaultSettings, chatTextSize })['--chat-font-size'],
    )
    expect(new Set(sizes).size).toBe(3)
    const spacing = (['compact', 'standard', 'relaxed'] as const).map(
      (lineSpacing) => layoutTokens({ ...defaultSettings, lineSpacing })['--chat-line-height'],
    )
    expect(new Set(spacing).size).toBe(3)
  })

  it('writes resolved theme, contrast, motion, and tokens to the root element', () => {
    const root = document.createElement('div')
    applyAppearance(
      root,
      normalizeSettings({
        theme: 'dark',
        contrast: 'high',
        motion: 'reduced',
        density: 'spacious',
        messageStyle: 'minimal',
        fontScale: 1.2,
      }),
    )
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.contrast).toBe('high')
    expect(root.dataset.motion).toBe('reduced')
    expect(root.dataset.density).toBe('spacious')
    expect(root.dataset.messageStyle).toBe('minimal')
    expect(root.style.getPropertyValue('--density')).toBe('1.2')
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.2')
    expect(root.style.getPropertyValue('--bg')).toBe('#000000')
  })

  it('follows the system for theme, contrast, and motion only when asked to', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: /dark|more|reduce/.test(query),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    try {
      const root = document.createElement('div')
      applyAppearance(root, defaultSettings)
      expect(root.dataset.theme).toBe('dark')
      expect(root.dataset.contrast).toBe('high')
      expect(root.dataset.motion).toBe('reduced')
      applyAppearance(
        root,
        normalizeSettings({ theme: 'light', contrast: 'standard', motion: 'full' }),
      )
      expect(root.dataset.theme).toBe('light')
      expect(root.dataset.contrast).toBe('standard')
      expect(root.dataset.motion).toBe('full')
    } finally {
      window.matchMedia = original
    }
  })
})
