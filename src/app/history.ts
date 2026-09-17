// Serialised access to window.history for in-app navigation and overlays.
//
// Android's back gesture calls WebView.goBack() while the page has history, so
// Juniper records page changes and open overlays as history entries. Closing an
// overlay from the UI must pop its entry again; history.back() is asynchronous,
// so pushes issued while a pop is still pending are queued until it lands, and
// listeners are told to ignore pops Juniper caused itself.

type Listener = (state: Record<string, unknown>) => void

let pendingBacks = 0
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
    for (const listener of [...listeners]) listener(state)
  })
}

export function currentHistoryState(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}
  const queued = queuedPushes.at(-1)
  return queued ?? ((window.history.state ?? {}) as Record<string, unknown>)
}

export function pushHistory(state: Record<string, unknown>) {
  install()
  if (pendingBacks > 0) queuedPushes.push(state)
  else window.history.pushState(state, '')
}

export function replaceHistory(state: Record<string, unknown>) {
  install()
  window.history.replaceState(state, '')
}

/** Pops one entry Juniper pushed, without notifying listeners. */
export function popHistorySilently() {
  install()
  if (queuedPushes.length > 0) {
    queuedPushes.pop()
    return
  }
  pendingBacks += 1
  window.history.back()
}

export function onHistoryPop(listener: Listener): () => void {
  install()
  listeners.add(listener)
  return () => listeners.delete(listener)
}
