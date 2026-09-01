# ADR-0004: Local inference strategy

Status: accepted

## Decision

Ollama is the first-class local workflow. llama.cpp is supported via its
OpenAI-compatible server, with a scoped Local GGUF manager boundary reserved
for desktop. No model weights or llama binaries are committed.

## Consequences

Users can start with `qwen3:8b` in Ollama and advanced users can use a local
GGUF server. Managed runtime download is future work and must be explicit,
hash-verified, cancellable, and atomic.

## Security/privacy

Child-process launch permissions are not enabled in the default capability;
the manager must receive a separate security review before activation.
