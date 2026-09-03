# Privacy and network policy

Juniper v0.3 contains no telemetry, analytics, advertising, automatic
conversation upload, silent cloud fallback, or Cinqic network requirement.

The Juniper local profile targets a loopback `llama-server` process that Juniper
starts and stops for a chat request. A remote profile is marked REMOTE and
receives the prompts the user sends through it. Model Market downloads, MCP
calls, and future web tools must be explicit actions; they are not part of
startup or automatic fallback. The local model catalog is HTTPS-only and every
download is checked against a checked-in SHA-256 pin before installation.

Ollama remains an optional external provider for users who already run it. The
Juniper local provider never probes Ollama and never silently falls back to it.

Provider credentials are referenced by opaque IDs and stored using the desktop
OS credential store. Exports intentionally omit credential values.
