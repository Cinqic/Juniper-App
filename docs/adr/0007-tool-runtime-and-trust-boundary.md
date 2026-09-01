# ADR-0007: Tool runtime and trust boundary

Status: accepted

## Decision

Use `juniper-tool-protocol-v1`; parse structured calls, validate schemas,
evaluate host permissions, enforce conservative loop/payload bounds, and
author results only in host code.

## Consequences

The model can request a capability but cannot declare that it ran. Tool
execution is testable with deterministic fixtures and independent of model
quality.

## Security/privacy

Prompt injection and fabricated results are treated as untrusted data. There
is no language-level `eval` and no unrestricted filesystem or shell tool.
