# Security policy

Please report security issues privately to the repository owner rather than
publishing exploit details first. Include the affected commit, impact,
reproduction steps, and whether user data or credentials may be exposed.

Juniper is local-first, but a remote provider or MCP server can receive data
the user sends to it. The host permission runtime is authoritative; prompts
cannot grant file, network, memory, or process permissions. See
`docs/security/threat-model.md` for the current v0.1 boundary.
