# Provider contract

Providers expose `listModels`, `healthCheck`, `inspectModel`, `capabilityProbe`,
and `streamChat` semantics. v0.1 implements the Rust transport path for
Ollama and generic OpenAI-compatible servers. llama.cpp is supported through
the same endpoint contract, including its local `/v1` server path.

Capabilities are tri-state: `supported`, `unsupported`, or `unknown`.
Unknown never enables a tool/thinking/generation control. The Qwen3 8B
reference profile records tools, parallel tools, and thinking as expected
capabilities, but real qualification remains environment-dependent.

When a provider returns tool calls, the native adapter accumulates streamed
fragments, normalizes them, executes only the bounded host-safe tool set, sends
host-authored `juniper-tool-protocol-v1` results back to the provider, and
continues for at most four rounds. User-data tools remain behind explicit
permission work and are not enabled by the default chat request.
