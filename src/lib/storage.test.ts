import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppData } from './defaults'
import { inferTransportLocation, loadAppData, saveAppData } from './storage'

describe('browser-preview storage', () => {
  beforeEach(() => localStorage.clear())
  it('does not persist private chats', () => {
    const data = initialAppData()
    data.conversations = [
      {
        id: 'private',
        title: 'Private',
        assistantId: data.assistants[0]!.id,
        createdAt: '',
        updatedAt: '',
        privateChat: true,
        messages: [],
      },
    ]
    saveAppData(data)
    expect(loadAppData().conversations.length).toBe(0)
  })

  it('does not persist chat-scoped grants for private chats', () => {
    const data = initialAppData()
    data.conversations = [
      {
        id: 'private',
        title: 'Private',
        assistantId: data.assistants[0]!.id,
        createdAt: '',
        updatedAt: '',
        privateChat: true,
        messages: [],
      },
    ]
    data.permissions = [
      {
        id: 'grant-private',
        toolName: 'file.read',
        scope: 'chat',
        assistantId: data.assistants[0]!.id,
        conversationId: 'private',
        createdAt: '',
        updatedAt: '',
      },
    ]
    saveAppData(data)
    expect(loadAppData().permissions).toHaveLength(0)
  })

  it('does not persist attachment metadata for private chats', () => {
    const data = initialAppData()
    data.conversations = [
      {
        id: 'private',
        title: 'Private',
        assistantId: data.assistants[0]!.id,
        createdAt: '',
        updatedAt: '',
        privateChat: true,
        messages: [],
      },
      {
        id: 'saved',
        title: 'Saved',
        assistantId: data.assistants[0]!.id,
        createdAt: '',
        updatedAt: '',
        messages: [],
      },
    ]
    data.attachments = [
      {
        id: 'private-file',
        conversationId: 'private',
        name: 'private.txt',
        sizeBytes: 12,
        contentType: 'text/plain',
      },
      {
        id: 'saved-file',
        conversationId: 'saved',
        name: 'saved.txt',
        sizeBytes: 10,
        contentType: 'text/plain',
      },
    ]
    saveAppData(data)
    expect(loadAppData().attachments.map((item) => item.id)).toEqual(['saved-file'])
  })

  it.each([
    ['http://localhost:11434', 'on-device'],
    ['http://model.localhost:11434', 'on-device'],
    ['http://127.8.4.2:11434', 'on-device'],
    ['http://[::1]:11434', 'on-device'],
    ['http://192.168.1.2:11434', 'local-network'],
    ['http://169.254.3.4:11434', 'local-network'],
    ['http://[fd00::1234]:11434', 'local-network'],
    ['http://[fe80::1234]:11434', 'local-network'],
    ['https://api.example.test', 'remote'],
    ['not a URL', 'unknown'],
  ])('classifies provider route %s as %s', (url, expected) => {
    expect(inferTransportLocation(url)).toBe(expected)
  })
})
