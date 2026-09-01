# ADR-0003: Provider abstraction

Status: accepted

## Decision

Normalize provider profiles, capabilities, stream events, usage, thinking,
tool calls, and errors at the adapter boundary. Implement Ollama’s local API
and an OpenAI-compatible path that also covers llama.cpp.

## Consequences

Provider-specific behavior stays out of the UI. Capability probing and
graceful degradation are required for servers with partial compatibility.

## Security/privacy

Locality is an explicit profile property and is shown in the UI. Remote
providers are never silently used as a fallback.
