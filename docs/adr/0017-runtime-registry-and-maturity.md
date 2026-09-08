# ADR 0017: Runtime registry and maturity

Status: Accepted for the rc29 review candidate

## Decision

Represent each inference backend in a generic runtime registry with pinned
identity, artifact formats, platform/architecture support, capabilities,
installation state, qualification state, and maturity. Keep runtime selection
separate from provider transport and model metadata.

## Consequences

The UI can show unavailable or package-only integrations without pretending
they are ready. Android llama.cpp remains Beta until physical ARM64 evidence;
that follow-up does not block the desktop release contract.
