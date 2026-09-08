# Device Link threat model

Device Link is an explicit, local-network trust boundary. It is disabled by
default and does not make the app a general-purpose remote-control server.

## Security invariants

- Pairing codes are random, time-limited, and one-time use. The short
  authentication string is displayed for out-of-band comparison.
- Transport must be HTTPS/TLS 1.3 on a private or link-local address and must
  pin the peer certificate/public-key fingerprint. Public Internet endpoints,
  plaintext HTTP, and unknown locality are rejected.
- A newly paired peer receives only `inference` scope. App control, runtime
  inspection, model management, and data sync are separately granted and
  revocable.
- Operations are an allowlist. A valid peer cannot invent a new operation or
  use a broader scope by changing a JSON field.
- Frames are versioned, length-bounded, and protected by a bounded replay-ID
  window. Payloads do not accept private-chat state or implicit host context.
- Peer identity/fingerprint/scope metadata is stored in SQLite. Pairing
  secrets and future TLS private keys belong in the platform secure store, not
  in app-state JSON, exports, logs, or model metadata.

## Threats and mitigations

| Threat                                                | Mitigation                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Stolen or photographed pairing code                   | 10-minute expiry, one-time consumption, SAS comparison, revocation                               |
| LAN attacker observes traffic                         | TLS 1.3 and certificate/public-key pinning are mandatory                                         |
| Malicious peer requests app control                   | Default inference-only scope and explicit per-scope grant                                        |
| Replay or oversized frame                             | Message IDs, bounded replay window, 1 MiB frame limit                                            |
| Model or attachment content impersonates control data | Device Link payload schema is separate from model/tool content; host authorization remains local |
| Private chat leaks to another device                  | Native validation rejects `privateChat`; host context is not synchronized                        |
| Public endpoint disguised as a provider               | HTTPS plus private/link-local address validation and explicit paired identity                    |
| Database copied from the device                       | Peer metadata is non-secret; secrets are never persisted in SQLite                               |

The current candidate ships the protocol/policy, trust-store commands, and the
pinned Juniper Network client path. It does not enable a socket listener or
mDNS discovery yet. Any future listener/discovery transport must use these
checks as a mandatory pre-dispatch layer; it must not introduce a permissive
fallback transport.
