# ADR-0002: Frontend stack

Status: accepted

## Decision

Use React 19, TypeScript strict mode, Vite 7, CSS tokens, and a small
feature-local state model. Avoid a global UI framework and avoid unnecessary
dependency surface.

## Consequences

The design system is inspectable in CSS, responsive behavior is explicit, and
the application can be tested with Vitest without a server.

## Security/privacy

Markdown is rendered from escaped text and does not use raw HTML injection.
