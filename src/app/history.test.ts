import { describe, expect, it } from 'vitest'
import { onHistoryDepth, onHistoryPop, popHistorySilently, pushHistory } from './history'

const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

describe('in-app history', () => {
  it('closing two overlays at once does not swallow the next back press', async () => {
    const delivered: unknown[] = []
    const depths: number[] = []
    const stopPop = onHistoryPop((state) => delivered.push(state.juniperNav))
    const stopDepth = onHistoryDepth((depth) => depths.push(depth))

    pushHistory({ juniperNav: 'settings' })
    pushHistory({ juniperNav: 'settings', juniperOverlay: 'a' })
    pushHistory({ juniperNav: 'settings', juniperOverlay: 'b' })
    popHistorySilently()
    popHistorySilently()
    await settle()
    expect(delivered).toEqual([])
    expect(depths.at(-1)).toBe(1)

    window.history.back()
    await settle()
    expect(delivered).toHaveLength(1)
    expect(depths.at(-1)).toBe(0)

    stopPop()
    stopDepth()
  })

  it('queues a push made while a silent pop is still pending', async () => {
    pushHistory({ juniperOverlay: 'menu' })
    popHistorySilently()
    pushHistory({ juniperOverlay: 'dialog' })
    await settle()
    expect((window.history.state as Record<string, unknown>).juniperOverlay).toBe('dialog')
    popHistorySilently()
    await settle()
  })
})
