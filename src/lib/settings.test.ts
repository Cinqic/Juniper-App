import { describe, expect, it } from 'vitest'
import { rc32StoredState } from '../test/fixtures'
import {
  APPEARANCE_KEYS,
  JUNIPER_ACCENT,
  defaultSettings,
  normalizeSettings,
  parseHexColor,
  resetSettings,
} from './settings'
import { loadAppData, normalizeAppData, saveAppData } from './storage'

describe('settings normalisation and migration', () => {
  it('loads rc.32 settings without losing any existing preference', () => {
    const stored = rc32StoredState()
    const settings = normalizeAppData(stored).settings
    expect(settings.theme).toBe('dark')
    expect(settings.accent).toBe('#3B82F6')
    expect(settings.fontScale).toBe(1.1)
    expect(settings.density).toBe('compact')
    expect(settings.developerMode).toBe(true)
    expect(settings.onboardingComplete).toBe(true)
    expect(settings.telemetry).toBe('off')
  })

  it('migrates the rc.32 reducedMotion boolean to the motion preference', () => {
    expect(normalizeSettings({ reducedMotion: true }).motion).toBe('reduced')
    expect(normalizeSettings({ reducedMotion: false }).motion).toBe('system')
    expect(normalizeSettings({ reducedMotion: true, motion: 'full' }).motion).toBe('full')
    expect(normalizeSettings({ reducedMotion: true })).not.toHaveProperty('reducedMotion')
  })

  it('gives every new field a safe default when it is missing', () => {
    const settings = normalizeSettings(rc32StoredState().settings)
    expect(settings).toMatchObject({
      contrast: 'system',
      accentMode: 'color',
      fontFamily: 'juniper',
      chatTextSize: 'medium',
      lineSpacing: 'standard',
      conversationWidth: 'balanced',
      sidebar: 'auto',
      messageStyle: 'bubbles',
      showTimestamps: false,
      showMessageDetails: false,
      defaultAssistantId: null,
    })
    expect(Object.keys(settings).sort()).toEqual(Object.keys(defaultSettings).sort())
  })

  it('rejects malformed values field by field and keeps the valid ones', () => {
    const settings = normalizeSettings({
      theme: 'sepia',
      accent: 'red; background: url(https://example.com)',
      fontScale: 99,
      density: 42,
      conversationWidth: 'wide',
      fontFamily: 'Comic Sans',
      showTimestamps: 'yes',
      developerMode: true,
      telemetry: 'on',
      defaultAssistantId: 7,
    })
    expect(settings.theme).toBe('system')
    expect(settings.accent).toBe(JUNIPER_ACCENT)
    expect(settings.fontScale).toBe(1.3)
    expect(settings.density).toBe('comfortable')
    expect(settings.conversationWidth).toBe('wide')
    expect(settings.fontFamily).toBe('juniper')
    expect(settings.showTimestamps).toBe(false)
    expect(settings.developerMode).toBe(true)
    expect(settings.telemetry).toBe('off')
    expect(settings.defaultAssistantId).toBeNull()
  })

  it('treats unknown future enum values as defaults instead of failing', () => {
    const settings = normalizeSettings({
      sidebar: 'floating',
      messageStyle: 'cards',
      motion: 'fast',
    })
    expect(settings.sidebar).toBe('auto')
    expect(settings.messageStyle).toBe('bubbles')
    expect(settings.motion).toBe('system')
  })

  it('survives settings that are not an object at all', () => {
    for (const value of [null, undefined, 'dark', 3, [], true]) {
      expect(normalizeSettings(value)).toEqual(defaultSettings)
    }
  })

  it('clamps and rounds interface zoom', () => {
    expect(normalizeSettings({ fontScale: 0.1 }).fontScale).toBe(0.85)
    expect(normalizeSettings({ fontScale: 1.12 }).fontScale).toBe(1.1)
    expect(normalizeSettings({ fontScale: Number.NaN }).fontScale).toBe(1)
    expect(normalizeSettings({ fontScale: '1.2' }).fontScale).toBe(1)
  })

  it('migrates the legacy sage accent and accepts short hex colours', () => {
    expect(normalizeSettings({ accent: '#6f8f72' }).accent).toBe(JUNIPER_ACCENT)
    expect(normalizeSettings({ accent: '#abc' }).accent).toBe('#AABBCC')
    expect(parseHexColor('#12345')).toBeNull()
    expect(parseHexColor('#1234567')).toBeNull()
    expect(parseHexColor('rgb(0,0,0)')).toBeNull()
  })

  it('keeps chats, assistants, and model references intact through an upgrade round trip', () => {
    localStorage.clear()
    const stored = rc32StoredState()
    localStorage.setItem('juniper.app-data.v1', JSON.stringify(stored))
    const loaded = loadAppData()
    expect(loaded.conversations.map((chat) => chat.id)).toEqual(['chat-plan', 'chat-review'])
    expect(loaded.conversations[0]!.messages).toHaveLength(2)
    expect(loaded.conversations[1]!.modelProfileId).toBe('ollama-local:removed-model')
    expect(loaded.assistants.map((assistant) => assistant.modelProfileId)).toEqual([
      'ollama-local:qwen3:8b',
      'remote-openai:gpt-remote',
    ])
    expect(loaded.memories).toHaveLength(1)
    expect(loaded.permissions).toHaveLength(1)
    saveAppData(loaded)
    const reloaded = loadAppData()
    expect(reloaded).toEqual(loaded)
    expect(reloaded.settings.density).toBe('compact')
  })

  it('resets only the requested group of settings', () => {
    const customised = normalizeSettings({
      ...rc32StoredState().settings,
      fontFamily: 'dyslexic',
      conversationWidth: 'wide',
      contrast: 'high',
    })
    const reset = resetSettings(customised, APPEARANCE_KEYS)
    expect(reset.fontFamily).toBe('juniper')
    expect(reset.conversationWidth).toBe('balanced')
    expect(reset.theme).toBe('system')
    expect(reset.contrast).toBe('high')
    expect(reset.fontScale).toBe(1.1)
    expect(reset.developerMode).toBe(true)
    expect(reset.onboardingComplete).toBe(true)
  })
})
