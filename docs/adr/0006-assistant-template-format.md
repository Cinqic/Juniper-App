# ADR-0006: Assistant template format

Status: accepted

## Decision

Use human-readable `.juniper` JSON with `format: juniper-assistant` and
`version: 1`. Validate it against the schema and treat imports as inert data.

## Consequences

Assistants are portable, editable, and independent from model weights. A
missing model profile can be reported without executing anything.

## Security/privacy

Imported files contain no executable code and cannot expand Tauri permissions.
