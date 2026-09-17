// Flexbox `gap` needs Chromium 84. Android devices can still run an older
// Android System WebView (the API 30 emulator image ships Chromium 83), where
// every flex container would lose its spacing. When the browser lacks flex gap,
// this reads Juniper's own stylesheet rules and adds equivalent margins, so the
// fallback cannot drift from the real styles. Modern engines skip it entirely.

export function supportsFlexGap(doc: Document = document): boolean {
  const probe = doc.createElement('div')
  probe.style.display = 'flex'
  probe.style.flexDirection = 'column'
  probe.style.rowGap = '1px'
  probe.style.position = 'absolute'
  probe.append(doc.createElement('div'), doc.createElement('div'))
  doc.body.append(probe)
  const supported = probe.scrollHeight === 1
  probe.remove()
  return supported
}

function property(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim()
}

function gaps(style: CSSStyleDeclaration): { row: string; column: string } {
  const [shorthandRow = '', shorthandColumn = shorthandRow] = splitGap(property(style, 'gap'))
  return {
    row: property(style, 'row-gap') || shorthandRow,
    column: property(style, 'column-gap') || shorthandColumn,
  }
}

/** Splits a `gap` shorthand on top-level whitespace, keeping `calc()`/`var()` intact. */
function splitGap(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const character of value) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (/\s/.test(character) && depth === 0) {
      if (current) parts.push(current)
      current = ''
    } else current += character
  }
  if (current) parts.push(current)
  return parts
}

/** Margin rules equivalent to the gaps declared in `rules`. Exported for tests. */
export function fallbackRules(rules: Iterable<CSSRule>): string[] {
  const output: string[] = []
  for (const rule of rules) {
    if (rule instanceof CSSMediaRule) {
      const nested = fallbackRules(Array.from(rule.cssRules))
      if (nested.length) output.push(`@media ${rule.conditionText} { ${nested.join(' ')} }`)
      continue
    }
    if (!(rule instanceof CSSStyleRule)) continue
    const style = rule.style
    const { row: rowGap, column: columnGap } = gaps(style)
    if (!rowGap && !columnGap) continue
    const display = property(style, 'display')
    const direction = property(style, 'flex-direction')
    const column = direction === 'column'
    // A rule may only change direction (e.g. a stacked variant of a flex row).
    if (display !== 'flex' && display !== 'inline-flex' && !direction) continue
    const selectors = rule.selectorText.split(',').map((selector) => selector.trim())
    const scoped = (suffix: string) =>
      selectors.map((selector) => `${selector}${suffix}`).join(', ')
    if (property(style, 'flex-wrap') === 'wrap') {
      output.push(
        `${scoped(' > *')} { margin-right: ${columnGap || rowGap}; margin-bottom: ${rowGap || columnGap}; }`,
      )
    } else if (column) {
      output.push(`${scoped(' > * + *')} { margin-top: ${rowGap || columnGap}; margin-left: 0; }`)
    } else {
      const gap = columnGap || rowGap
      output.push(`${scoped(' > * + *')} { margin-left: ${gap}; }`)
      // Icons are often followed by a bare text label, which `* + *` cannot reach.
      output.push(
        `${scoped(' > .icon:first-child')}, ${scoped(' > i:first-child')} { margin-right: ${gap}; }`,
      )
      output.push(
        `${scoped(' > .icon:first-child + *')}, ${scoped(' > i:first-child + *')} { margin-left: 0; }`,
      )
    }
  }
  return output
}

export function installFlexGapFallback(doc: Document = document): boolean {
  if (supportsFlexGap(doc)) return false
  const rules: CSSRule[] = []
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      rules.push(...Array.from(sheet.cssRules))
    } catch {
      // A sheet that cannot be read is not one of Juniper's bundled styles.
    }
  }
  const style = doc.createElement('style')
  style.dataset.juniperFlexGapFallback = 'true'
  style.textContent = fallbackRules(rules).join('\n')
  doc.head.append(style)
  doc.documentElement.dataset.flexGap = 'fallback'
  return true
}
