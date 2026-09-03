# Juniper architecture

```text
React UI
  ↓ normalized use cases
Juniper state and context builder
  ↓
Rust Tauri commands / orchestrator boundary
  ├─ provider adapters (Juniper local, Ollama, OpenAI-compatible, llama.cpp)
  ├─ host tool runtime and permissions
  ├─ SQLite repositories and migrations
  ├─ OS credential store
  └─ scoped attachment/runtime operations
```

Models supply inference. Assistants supply behavior. The UI never depends on
raw Juniper-local, Ollama, or OpenAI response shapes; `ChatStreamEvent` is the
normalized stream contract.

The browser preview is intentionally useful without a native runtime: it
uses a deterministic fake stream and clearly says that a real provider is not
connected. In the Tauri shell, provider requests happen behind Rust commands.

## Data flow

1. The assistant template, selected memories, enabled tools, conversation, and
   current message form a deterministic context summary.
2. The provider adapter receives normalized messages and only the generation
   parameters it knows the provider can accept.
3. Model tool calls remain untrusted until schema/permission checks complete.
4. Only host implementations create trusted tool results.
5. Persistence uses normalized tables, not a provider-specific message blob.

## Platform boundary

Desktop can connect to external local providers, launch the Juniper-owned
loopback runtime, and use the OS keychain. Mobile shares the UI/domain model and
catalog management path, but this candidate does not claim a packaged native
local inference process on Android.
