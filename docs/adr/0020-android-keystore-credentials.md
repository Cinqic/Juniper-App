# ADR 0020: Android provider credentials use Keystore

Status: Accepted for the rc30 release candidate

## Decision

Android provider secrets are encrypted with an AES-GCM key held by Android
Keystore. SQLite and SharedPreferences contain only opaque references and
ciphertext metadata. Desktop continues to use the OS keychain. iOS remains an
explicitly unavailable platform until it has an equivalent secure-store
implementation.

## Consequences

Provider chat calls can retrieve a secret through the native plugin without
exposing it to the webview or writing it to app-state exports. Instrumentation
coverage is required for encrypt/decrypt/delete behavior.
