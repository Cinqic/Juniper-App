# Privacy and network policy

Juniper v0.2 contains no telemetry, analytics, advertising, automatic
conversation upload, silent cloud fallback, or Cinqic network requirement.

The local Ollama profile targets loopback. A remote profile is marked REMOTE
and receives the prompts the user sends through it. Model downloads, MCP
calls, and future web tools must be explicit actions; they are not part of
startup or automatic fallback.

Provider credentials are referenced by opaque IDs and stored using the desktop
OS credential store. Exports intentionally omit credential values.
