# ADR-0004: Local inference strategy

Status: accepted

## Decision

Juniper's first-class local workflow is an app-owned, loopback `llama-server`
process built from a pinned `llama.cpp` revision and packaged as a Tauri
resource. Ollama remains an optional external provider. No model weights or
runtime binaries are committed to the repository.

## Consequences

Users can open Models Market, choose a device-aware recommendation, and
download a catalogued GGUF model without installing a separate daemon. An
advanced user can still connect Ollama, an OpenAI-compatible endpoint, or a
llama.cpp server. The model manager is explicit, hash-verified, resumable,
cancellable, and atomic.

## Security/privacy

The local runtime is launched only on loopback, with a Juniper-selected port,
an app-data model path resolved from the trusted catalog, and a bounded
request lifecycle. It is never a fallback to a remote provider or Ollama.
