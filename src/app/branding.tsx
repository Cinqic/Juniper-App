import type { ImgHTMLAttributes } from 'react'
import type { Assistant } from '../types'

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

  return (
    <span
      className={className}
      style={{ background: assistant.accent }}
      aria-hidden={decorative ? true : undefined}
    >
      {assistant.avatar}
    </span>
  )
}
