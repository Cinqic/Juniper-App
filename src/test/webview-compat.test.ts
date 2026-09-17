import { describe, expect, it } from 'vitest'

// Juniper supports Android 7.0+, where Android System WebView can be as old as
// Chromium 83 (the API 30 emulator image used by the release smoke). These
// built-ins are newer and throw at run time there; a 0.3.0-rc.33 draft crashed
// at launch on `Array.prototype.at`. Use the noted alternatives instead.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\.at\(-?\d/, 'Array.prototype.at (Chromium 92): index with length - 1'],
  [/\.replaceAll\(/, 'String.prototype.replaceAll (Chromium 85): use replace with /g'],
  [/\.findLast(Index)?\(/, 'findLast/findLastIndex (Chromium 97): loop backwards'],
  [/Object\.hasOwn\(/, 'Object.hasOwn (Chromium 93): use Object.prototype.hasOwnProperty.call'],
  [/structuredClone\(/, 'structuredClone (Chromium 98)'],
  [/\.to(Sorted|Reversed|Spliced)\(/, 'change-array-by-copy (Chromium 110): copy, then mutate'],
  [/crypto\.randomUUID\(\)/, 'crypto.randomUUID (Chromium 92): use randomUuid from lib/ids'],
  [/(\|\||&&|\?\?)=/, 'logical assignment (Chromium 85): write the assignment out'],
]

const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('Android System WebView compatibility', () => {
  it('scans the application sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
    expect(Object.keys(sources)).toContain('../app/App.tsx')
  })

  it('does not call built-ins that older Android WebViews lack', () => {
    const violations: string[] = []
    for (const [path, text] of Object.entries(sources)) {
      text.split('\n').forEach((line, index) => {
        if (/^\s*(\/\/|\*)/.test(line) || line.includes('webview-compat: feature-detected')) return
        for (const [pattern, advice] of FORBIDDEN) {
          if (pattern.test(line)) violations.push(`${path}:${index + 1} ${advice}`)
        }
      })
    }
    expect(violations).toEqual([])
  })
})
