# Juniper privacy

Juniper v0.3 has no telemetry, analytics, advertising SDK, crash reporting,
automatic upload, or Cinqic account requirement. Chats and curated memories
stay in the local application data directory when using a local provider.

When a user configures a remote provider, that provider receives the prompts,
context, attachments, and tool inputs included in the request. The UI marks
that route REMOTE. Juniper Network is a distinct paired private-LAN route:
private chats, implicit memories, and host context are rejected rather than
sent. Model Market downloads and future MCP/web tools are explicit actions,
not silent fallback.

Desktop provider credentials are stored in the operating system credential
store, Android provider credentials use Android Keystore, and neither is
exported. Users can clear chats and memories and export their user data
without API keys.
