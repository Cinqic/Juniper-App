# Phase 3 — Provider abstraction and adapters

Status: implemented, integration validation pending.

The Rust provider boundary routes Ollama’s local `/api/tags` health/model
endpoints and OpenAI-compatible `/v1/chat/completions`; that same path covers
llama.cpp’s documented local server interface. Stream events normalize text,
reasoning metadata, tool-call deltas, completion, usage timing, and typed
errors. Remote credentials are read from the desktop keychain by reference.

No real provider server was available for execution.

Approval: `CANDIDATE - PENDING INDEPENDENT REVIEW`.
