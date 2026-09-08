# ADR 0019: Device Link security boundary

Status: Policy preview retained for rc31; transport and pairing are deferred

## Decision

This candidate retains versioned bounded frames, replay rejection, revocable
peer-record shapes, least-privilege scopes, and private-chat policy as a
non-networked preview. It does not expose a listener, discovery, usable pairing
flow, peer connection, remote control, or Juniper Network provider.

The earlier review candidate derived a device fingerprint from the stable
device ID while the TLS verifier interpreted that field as a SHA-256 certificate
digest. Those identity domains are not interchangeable. Transport remains
disabled until a persistent, securely stored TLS keypair/certificate exists and
pairing exchanges the exact certificate or SPKI pin consumed by verification.
Resolved endpoints must also be checked as private or link-local so `.local`
names cannot become a DNS-rebinding route to a public address.

## Consequences

The Settings and provider controls stay disabled. Adding discovery or a socket
implementation must preserve these invariants; discovery is not authentication.
