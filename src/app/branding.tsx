import type { ImgHTMLAttributes } from 'react'
import type { Assistant } from '../types'
import { readableOn } from '../lib/appearance'
import { parseHexColor } from '../lib/settings'

export const JUNIPER_LOGO_PATH = '/juniper-logo.png'

export function JuniperMark({
  className,
  alt = '',
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  return (
    <img
      {...props}
      className={['juniper-mark', className].filter(Boolean).join(' ')}
      src={JUNIPER_LOGO_PATH}
      alt={alt}
    />
  )
}

export function AssistantAvatar({
  assistant,
  className = 'assistant-avatar',
  decorative = true,
}: {
  assistant: Pick<Assistant, 'id' | 'name' | 'avatar' | 'accent'>
  className?: string
  decorative?: boolean
}) {
  if (assistant.id === 'assistant-juniper') {
    return (
      <JuniperMark
        className={[className, 'assistant-avatar-image'].filter(Boolean).join(' ')}
        alt={decorative ? '' : `${assistant.name} avatar`}
        aria-hidden={decorative ? true : undefined}
      />
    )
  }

  // Imported assistants can carry any accent string; only a hex colour is applied.
  const background = parseHexColor(assistant.accent) ?? '#5A5F66'
  return (
    <span
      className={[className, 'assistant-avatar-glyph'].filter(Boolean).join(' ')}
      style={{ background, color: readableOn(background) }}
      aria-hidden={decorative ? true : undefined}
    >
      {assistant.avatar}
    </span>
  )
}
