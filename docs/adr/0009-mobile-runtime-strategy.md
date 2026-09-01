# ADR-0009: Mobile runtime strategy

Status: accepted

## Decision

Share the React/Tauri domain and responsive UI across platforms. v0.1 mobile
supports endpoint-based inference where networking is permitted. Native
on-device GGUF inference is an extension point and is not claimed complete.

## Consequences

The mobile application can carry chats, assistants, settings, and provider
profiles without pretending that an 8B desktop model fits every phone.

## Security/privacy

Mobile capabilities exclude desktop filesystem, shell, and local-runtime
permissions. Mobile secure credential storage remains an explicit limitation.
