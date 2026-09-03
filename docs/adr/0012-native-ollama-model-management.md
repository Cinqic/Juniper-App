# ADR-0012: Native Ollama model management

Status: accepted as an optional external-provider compatibility path

Ollama is an optional external runtime. Juniper uses its native `/api/tags`,
`/api/show`, `/api/pull`, `/api/delete`, `/api/ps`, and `/api/chat` endpoints
for discovery, metadata, model management, runtime state, and chat. Pulls are
JSON/NDJSON requests with streamed progress and cancellation; no shell command
is built from a model reference.

Generic OpenAI-compatible and llama.cpp servers remain supported for chat.
The default Juniper provider does not probe or depend on Ollama; its model
catalog and managed weights are owned by Juniper instead.
