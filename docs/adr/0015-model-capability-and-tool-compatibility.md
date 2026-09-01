# ADR-0015: Model capability and tool compatibility

Status: accepted for the 0.2 release candidate

Capabilities are tri-state. Unknown is not supported. Native structured tool
calling is preferred; malformed, unknown, or out-of-schema calls are rejected
at the host boundary. Only host code authors tool results. Tool loops, payloads,
calculator complexity, and file reads are bounded. User-data tools remain
disabled until the permission dialog path is complete rather than bypassing
permissions.
