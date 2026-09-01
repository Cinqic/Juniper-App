# ADR-0001: Cross-platform framework

Status: accepted

## Context

Juniper must share a desktop-first UI with a mobile-compatible architecture
while keeping native permissions narrow.

## Decision

Use Tauri 2 with React/TypeScript/Vite in the webview and Rust for native/core
operations.

## Alternatives

Electron was rejected for a heavier bundled runtime; native-per-platform UI
was rejected for duplicated product behavior.

## Consequences

Desktop and mobile share domain contracts and UI, while capabilities and
runtime features can be platform-specific. Tauri prerequisites are required
for actual builds.

## Security/privacy

Tauri capabilities are explicitly enumerated; no blanket filesystem or shell
permissions are granted.
