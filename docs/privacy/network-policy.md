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

Provider credentials are referenced by opaque IDs. Desktop uses the OS
credential store; Android uses Android Keystore. Exports intentionally omit
credential values.

Device Link and the Juniper Network provider are disabled in this candidate.
The repository retains bounded framing, replay, least-privilege scope, and
private-chat policy as a non-networked preview, but there is no listener,
discovery, usable pairing flow, peer connection, or remote-control route. A
future implementation must exchange the exact TLS certificate or SPKI pin used
by transport, store the private key in a platform secure facility, and validate
resolved destinations as private or link-local before any network I/O.
