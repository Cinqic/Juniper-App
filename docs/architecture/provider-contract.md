# Provider contract

Providers expose `listModels`, `healthCheck`, `inspectModel`, `pullModel`,
`deleteModel`, `runningModels`, `capabilityProbe`, and `streamChat` semantics.
v0.3 implements a Juniper-owned local `llama-server` path plus optional Ollama,
generic OpenAI-compatible, llama.cpp-compatible, and paired Juniper Network
servers. Juniper Network is an HTTPS/TLS-pinned private-LAN route with an
explicit peer identity; it is not a cloud fallback and cannot be used for a
private chat.

Capabilities are tri-state: `supported`, `unsupported`, or `unknown`.
Unknown never enables a tool/thinking/generation control. Runtime metadata is
the source of truth; no model family is required or used as a compatibility
shortcut. Optional model-specific profiles may document tested quirks, but
generic discovery remains the default.

When a provider returns tool calls, the native adapter accumulates streamed
fragments, normalizes them, executes only the bounded host-safe tool set, sends
host-authored `juniper-tool-protocol-v1` results back to the provider, and
continues for at most four rounds. User-data tools remain behind explicit
permission work and are not enabled by the default chat request.
