# ADR-0012: Native Ollama model management

Status: accepted for the 0.2 release candidate

Ollama is a first-class local runtime. Juniper uses its native `/api/tags`,
`/api/show`, `/api/pull`, `/api/delete`, `/api/ps`, and `/api/chat` endpoints
for discovery, metadata, model management, runtime state, and chat. Pulls are
JSON/NDJSON requests with streamed progress and cancellation; no shell command
is built from a model reference.

Generic OpenAI-compatible and llama.cpp servers remain supported for chat.
