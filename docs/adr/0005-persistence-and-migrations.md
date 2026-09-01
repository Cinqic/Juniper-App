# ADR-0005: Persistence and migrations

Status: accepted

## Decision

Use SQLite for structured user data with stable IDs, timestamps, normalized
message parts, foreign keys, and a schema migration table. Preferences are
kept in the small typed app settings layer until native persistence is wired.

## Consequences

Chats, assistants, memories, attachments, tools, and provider metadata can be
exported without depending on a vendor response blob.

## Security/privacy

The database is local application data. Private chats are excluded from the
persistent browser-preview store and no API keys are exported.
