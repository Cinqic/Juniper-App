// Serialised access to window.history for in-app navigation and overlays.
//
// Juniper records page changes and open overlays as history entries so the
// browser back action and Android's back gesture (see useAndroidBack) close an
// overlay or return to the previous screen. Closing an
// overlay from the UI must pop its entry again; history.back() is asynchronous,
// so pushes issued while a pop is still pending are queued until it lands, and
// listeners are told to ignore pops Juniper caused itself.

type Listener = (state: Record<string, unknown>) => void
type DepthListener = (depth: number) => void

let pendingBacks = 0
/** Entries Juniper pushed that are still on the history stack. */
let depth = 0
const depthListeners = new Set<DepthListener>()

function setDepth(next: number) {
  depth = Math.max(0, next)
  for (const listener of [...depthListeners]) listener(depth)
}
const queuedPushes: Array<Record<string, unknown>> = []
const listeners = new Set<Listener>()
let installed = false

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('popstate', (event) => {
    const state = (event.state ?? {}) as Record<string, unknown>
    if (pendingBacks > 0) {
      pendingBacks -= 1
      if (pendingBacks === 0) {
        for (const next of queuedPushes.splice(0)) window.history.pushState(next, '')
      }
      return
    }
    setDepth(depth - 1)
    for (const listener of [...listeners]) listener(state)
  })
}

export function currentHistoryState(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}
  const queued = queuedPushes[queuedPushes.length - 1]
  return queued ?? ((window.history.state ?? {}) as Record<string, unknown>)
}

export function pushHistory(state: Record<string, unknown>) {
  install()
  if (pendingBacks > 0 || silentPops > 0) queuedPushes.push(state)
  else window.history.pushState(state, '')
  setDepth(depth + 1)
}

export function replaceHistory(state: Record<string, unknown>) {
  install()
  window.history.replaceState(state, '')
}

let silentPops = 0
let expiry: ReturnType<typeof setTimeout> | undefined

/**
 * Pops one entry Juniper pushed, without notifying listeners.
 *
 * Several overlays can close in the same tick, and browsers collapse repeated
 * history.back() calls into one traversal, so pops are batched into a single
 * history.go(-n) that produces one popstate. If that popstate never arrives,
 * the expectation expires so a later back press is not swallowed.
 */
export function popHistorySilently() {
  install()
  setDepth(depth - 1)
  if (queuedPushes.length > 0) {
    queuedPushes.pop()
    return
  }
  silentPops += 1
  if (silentPops > 1) return
  queueMicrotask(() => {
    const count = silentPops
    silentPops = 0
    pendingBacks += 1
    window.history.go(-count)
    clearTimeout(expiry)
    expiry = setTimeout(() => {
      if (pendingBacks === 0) return
      pendingBacks = 0
      for (const next of queuedPushes.splice(0)) window.history.pushState(next, '')
    }, 1000)
  })
}

/** Entries Juniper pushed that are still on the history stack. */
export function historyDepth(): number {
  return depth
}

/** Reports how many Juniper history entries can be gone back through. */
export function onHistoryDepth(listener: DepthListener): () => void {
  depthListeners.add(listener)
  listener(depth)
  return () => depthListeners.delete(listener)
}

export function onHistoryPop(listener: Listener): () => void {
  install()
  listeners.add(listener)
  return () => listeners.delete(listener)
}
