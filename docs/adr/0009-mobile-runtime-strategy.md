# ADR-0009: Mobile runtime strategy

Status: accepted

## Decision

Share the React/Tauri domain and responsive UI across platforms. Android uses
an app-owned, in-process `llama.cpp` bridge for one SHA-256-verified managed
GGUF model. It streams through the existing chat contract and never starts a
`llama-server` or localhost inference process. Desktop keeps its existing
app-owned `llama-server` path. Endpoint-based inference remains available
where networking is permitted.

## Consequences

The mobile application can carry chats, assistants, settings, and provider
profiles while keeping model choice explicit. Android qualification is bounded
to the supported arm64-v8a and x86_64 packaging targets; the final physical
ARM64 device run remains a release gate.

## Security/privacy

Mobile capabilities exclude desktop filesystem, shell, and local-runtime
permissions. Mobile secure credential storage remains an explicit limitation.
