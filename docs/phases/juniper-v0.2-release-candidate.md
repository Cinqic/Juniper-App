# Juniper v0.2 release-candidate handoff

Status: CANDIDATE - PENDING INDEPENDENT REVIEW

## Provenance

- Starting canonical commit: 9c900021435505ea5b2bb16647ebd5bf2bb035f5
- Working branch: luna/juniper-model-agnostic-completion
- Final commit: recorded in the repository history for this handoff
- Product version: 0.2.0-rc.1

## Architecture changes

Juniper now separates assistants, providers, and model profiles. The default
Juniper assistant has no required model binding. Models are discovered and
inspected through runtime metadata, with tri-state capabilities and explicit
execution locations: ON DEVICE, LOCAL NETWORK, REMOTE, or UNKNOWN. An
unknown-compatible model can be used without a model-family source-code branch.

The supported provider classes are native Ollama, llama.cpp through its
OpenAI-compatible server contract, and generic OpenAI-compatible servers.
Ollama uses its native chat, discovery, inspection, pull, delete, and running
model surfaces. Model pulls use the provider API directly with streamed
progress; user/model text is never placed in a shell command.

## Model independence and live runtime evidence

- Product-level Qwen coupling was removed. The historical Qwen qualification
  fixture remains optional and is not a product default.
- Ollama 0.33.2 was reachable at http://127.0.0.1:11434.
- Installed models observed: none (the tags endpoint returned an empty model list).
- Model downloads performed: none.
- Real model chats executed: none; qualification remains pending until the
  owner selects an installed model.
- The no-model UI state remains usable and directs the user to add or download
  a model. Browser-only fake streaming is visibly development-preview behavior.

## Persistence, chat, tools, files, and privacy

- Tauri application state is saved through SQLite schema v2, with migrations,
  foreign keys, normalized entity tables, an app-state snapshot, and private
  chat exclusion. Browser localStorage is isolated to the development preview.
- Prompt composition is deterministic: Juniper identity, assistant prompt,
  compiled personality, response preference, host tool guidance, curated
  memory, history, attachment context, and the current user message.
  The current user message is included exactly once.
- Personality sliders compile into model-facing guidance. Curated memory is
  included only when the assistant policy enables it.
- Native provider streams carry separate reasoning, tool-call, host-result,
  usage, completion, and stable error events. Cancellation uses one request ID
  through the frontend and native boundary.
- Safe host tools use strict argument validation, bounded calculator parsing,
  dimension-safe conversion, bounded loops/payloads, and host-authored results.
  Unknown or malformed tool arguments never become an empty object.
- Text attachments use scoped native picker grants and a 1 MiB per-file cap.
  The GGUF picker validates extension, readability, size, and the GGUF magic
  header without exposing the selected path to the webview.
- Desktop provider secrets use opaque references backed by the OS credential
  store; credentials are not exported. There is no telemetry, automatic
  conversation upload, or silent remote fallback.

## Validation evidence

Passing with the bundled Node runtime:

- pnpm format
- pnpm lint
- pnpm typecheck
- pnpm test — 4 files, 11 tests
- pnpm build
- pnpm schema:validate — 7 schemas and representative fixtures
- pnpm version:check
- Rust cargo fmt --check

Native validation was attempted with Rust 1.90.0. Host Tauri tests and
Clippy were blocked before Juniper source compilation because this environment
does not have the Linux dbus-1.pc, GTK, and WebKit development packages.
The Android Rust target is installed, but Android compilation was blocked by
the absent Android NDK clang toolchain. CI workflows now install the Linux
Tauri packages and Android SDK/NDK explicitly. No Linux package, Android
build, iOS build, or live provider integration result is claimed here.

## Known and accepted limitations

- User-data tool permission dialogs and their durable policy store are not
  wired into the native chat loop; those tools remain disabled in default chat.
- Managed llama.cpp process ownership/import and GGUF execution are not enabled.
  A user can connect an already-running llama.cpp-compatible server.
- MCP client calls remain explicitly unavailable in this candidate.
- Mobile secure credential vault integration, mobile file reads, and iOS
  validation require platform-specific workspaces.
- Independent review is still required for native compilation, provider
  fixtures, SQLite restart behavior, cancellation races, permissions,
  accessibility, and packaging.

## Recovery and owner acceptance flow

Install Node.js 22+, pnpm 11, Rust 1.90+, the Tauri platform prerequisites,
and Ollama. From a clean clone, run pnpm install --frozen-lockfile and
pnpm validate. Open Juniper, confirm the Models page detects Ollama, enter
any compatible Ollama model reference under Download a model, watch the real
progress, cancel if desired, and refresh/select the resulting model. The
header then shows Juniper, the actual model, and its execution location.

Normal model management does not require a terminal after Ollama is installed.
Do not treat the absence of a downloaded model as a failure and do not pull a
large qualification model automatically.
