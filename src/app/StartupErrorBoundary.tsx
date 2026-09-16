import { Component, type ReactNode } from 'react'
import { reportFrontendFatal } from '../lib/runtime'

interface State {
  error: Error | null
}

/**
 * Last-resort boundary around the whole interface. Without it, an exception
 * during rendering unmounts everything and the desktop window stays blank with
 * no explanation. It never resets or deletes stored data.
 */
export class StartupErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error) {
    void reportFrontendFatal(error).catch(() => undefined)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <main role="alert" className="startup-error">
        <h1>Juniper could not display its interface</h1>
        <p>
          Juniper did not reset or delete your stored data. Restart Juniper. If this happens again,
          start Juniper from a terminal and include the lines beginning with{' '}
          <code>[juniper-startup]</code> in a bug report.
        </p>
        <pre>
          {error.name}: {error.message}
        </pre>
      </main>
    )
  }
}
