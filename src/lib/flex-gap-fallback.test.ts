import { describe, expect, it } from 'vitest'
import appCss from '../styles/app.css?raw'
import { fallbackRules } from './flex-gap-fallback'

function rulesFrom(css: string): CSSRule[] {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  const rules = Array.from(style.sheet!.cssRules)
  style.remove()
  return rules
}

describe('flex gap fallback', () => {
  it('turns row, column, and wrapping flex gaps into margins', () => {
    const output = fallbackRules(
      rulesFrom(`
        .row { display: flex; gap: 0.5rem; }
        .column { display: flex; flex-direction: column; row-gap: 1rem; column-gap: 1rem; }
        .wrap { display: flex; flex-wrap: wrap; row-gap: 2px; column-gap: 4px; }
        .grid { display: grid; gap: 3rem; }
        .plain { color: red; }
      `),
    ).join('\n')
    expect(output).toContain('.row > * + * { margin-left: 0.5rem; }')
    expect(output).toContain('.row > .icon:first-child')
    expect(output).toContain('.column > * + * { margin-top: 1rem; margin-left: 0; }')
    expect(output).toContain('.wrap > * { margin-right: 4px; margin-bottom: 2px; }')
    expect(output).not.toContain('.grid')
    expect(output).not.toContain('.plain')
  })

  it('covers every flex gap rule in the application stylesheet', () => {
    const output = fallbackRules(rulesFrom(appCss)).join('\n')
    for (const selector of [
      '.button',
      '.composer-row',
      '.setting-row.stacked',
      '.swatches',
      '.bottom-nav button',
    ]) {
      expect(output).toContain(selector)
    }
  })
})
