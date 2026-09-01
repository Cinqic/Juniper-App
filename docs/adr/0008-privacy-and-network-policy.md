# ADR-0008: Privacy and network policy

Status: accepted

## Decision

Telemetry is off and absent. A local provider is the default profile. Any
remote provider, model download, or future MCP/web call must be explicitly
configured and visibly labeled.

## Consequences

Juniper remains useful offline with the browser preview and local provider
path. Remote features must explain where prompts go.

## Security/privacy

Credentials are held by the OS keychain on desktop. Logs are structured but
must not contain conversation content, files, memories, or secrets.
