# ADR 0019: Device Link security boundary

Status: Accepted for the rc29 review candidate

## Decision

Device Link uses explicit pairing, TLS-pinned private-network transport,
versioned bounded frames, replay protection, an operation allowlist, and
least-privilege scopes. Pairing starts with inference only. Private chats and
implicit host context never cross the boundary.

## Consequences

Peer trust can be reviewed and revoked from Settings and persisted in SQLite.
Adding discovery or a socket implementation must preserve these invariants;
discovery is not authentication.
