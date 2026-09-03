# ADR-0016: Standalone local runtime boundary

Status: accepted for the 0.3 release candidate

## Decision

Juniper owns the normal local inference lifecycle. Release builds package a
CPU-safe `llama-server` built from the pinned `llama.cpp` revision in
`scripts/build-llama-runtime.sh`. For each local chat request, Rust resolves a
verified model from the managed catalog, reserves a loopback port, starts the
server with a loopback-only bind, waits for `/health`, routes the request
through Juniper's normalized OpenAI-compatible adapter, and stops the child
when the request ends. `JUNIPER_LLAMA_SERVER` is a developer-only override.

Ollama is not probed and is never a fallback. External provider adapters stay
available under Advanced for users who intentionally configure them.

## Consequences

The ordinary desktop installation path needs no Ollama installation, daemon,
account, or model-specific source-code branch. Runtime binaries are generated
by the release build and ignored by git; model weights remain user-owned,
downloaded on demand, and verified before use. The first implementation uses a
short-lived server per generation, which favors isolation and simple cleanup
over warm-server latency.

Android shares the catalog and management UI, but this release candidate does
not claim a packaged native local inference process on Android. A future mobile
runtime must use an Android-native library boundary rather than assuming that a
desktop executable can run from the APK.

## Security and privacy

The runtime binds to `127.0.0.1`, receives only a trusted catalog model path,
does not accept shell fragments from model metadata, and reports a structured
`LOCAL_RUNTIME_UNAVAILABLE` error when its resource is missing. No silent
network or Ollama fallback is permitted.
