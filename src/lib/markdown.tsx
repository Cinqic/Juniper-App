import type { ReactNode } from 'react'

function safeHref(value: string): string | null {
  if (value.startsWith('#') || (value.startsWith('/') && !value.startsWith('//'))) return value
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? value : null
  } catch {
    return null
  }
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(text.slice(cursor, index))
    const token = match[0]
    if (token.startsWith('**')) nodes.push(<strong key={`${index}-b`}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) nodes.push(<code key={`${index}-c`}>{token.slice(1, -1)}</code>)
    else {
      const parts = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/)
      const href = parts ? safeHref(parts[2]) : null
      nodes.push(
        parts && href ? (
          <a key={`${index}-a`} href={href} target="_blank" rel="noreferrer">
            {parts[1]}
          </a>
        ) : (
          token
        ),
      )
    }
    cursor = index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function Markdown({ content }: { content: string }) {
  const blocks = content.replaceAll('\r\n', '\n').split('\n')
  const output: ReactNode[] = []
  let index = 0
  while (index < blocks.length) {
    const line = blocks[index] ?? ''
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < blocks.length && !(blocks[index] ?? '').startsWith('```')) {
        code.push(blocks[index] ?? '')
        index += 1
      }
      output.push(
        <pre key={`code-${index}`} data-language={language}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      index += 1
      continue
    }
    if (/^#{1,3} /.test(line)) {
      const level = Math.min(3, line.match(/^#+/)?.[0].length ?? 1)
      const Heading = `h${level}` as 'h1' | 'h2' | 'h3'
      output.push(<Heading key={`h-${index}`}>{inline(line.slice(level + 1))}</Heading>)
      index += 1
      continue
    }
    if (/^[-*] /.test(line)) {
      const items: ReactNode[] = []
      while (index < blocks.length && /^[-*] /.test(blocks[index] ?? '')) {
        items.push(<li key={`li-${index}`}>{inline((blocks[index] ?? '').slice(2))}</li>)
        index += 1
      }
      output.push(<ul key={`ul-${index}`}>{items}</ul>)
      continue
    }
    if (/^\d+\. /.test(line)) {
      const items: ReactNode[] = []
      while (index < blocks.length && /^\d+\. /.test(blocks[index] ?? '')) {
        items.push(
          <li key={`oli-${index}`}>{inline((blocks[index] ?? '').replace(/^\d+\. /, ''))}</li>,
        )
        index += 1
      }
      output.push(<ol key={`ol-${index}`}>{items}</ol>)
      continue
    }
    if (!line.trim()) {
      index += 1
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (
      index < blocks.length &&
      (blocks[index] ?? '').trim() &&
      !/^(```|#{1,3} |[-*] |\d+\. )/.test(blocks[index] ?? '')
    ) {
      paragraph.push(blocks[index] ?? '')
      index += 1
    }
    output.push(<p key={`p-${index}`}>{inline(paragraph.join(' '))}</p>)
  }
  return <div className="markdown">{output}</div>
}
