# Juniper

Juniper is a local-first AI desktop app for people who want a thoughtful assistant, visible model controls, and a clear boundary around private data. It is designed around Qwen3 8B through Ollama, with an OpenAI-compatible provider path for llama.cpp and other servers.

Status: `0.1.0-rc.1` — candidate pending independent review.

## What is included

- A calm, responsive chat workspace with onboarding, streaming preview, markdown, export, private chats, and mobile layouts.
- Assistant profiles with personality controls, model selection, tool policy, memory policy, import, and export.
- Provider and model management for local Ollama plus OpenAI-compatible and llama.cpp-compatible endpoints.
- A deterministic context builder that keeps the system prompt, curated memories, enabled tool definitions, and recent conversation within a context budget.
- A host-authored tool boundary with bounded calculator, unit conversion, datetime, attachment, memory, search, and system-info contracts.
- SQLite migration scaffolding, OS-keychain credential storage on desktop, scoped text attachments, diagnostics, privacy settings, JSON schemas, ADRs, CI workflows, and recovery notes.

Juniper’s provider boundary follows the documented [Ollama OpenAI-compatible API](https://docs.ollama.com/api/openai-compatibility), [Ollama streaming behavior](https://docs.ollama.com/api/streaming), and [llama.cpp server contract](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md). The native shell uses [Tauri 2](https://v2.tauri.app/start/) with a narrow capability surface.

## Quick start

Install Node.js 22+, pnpm 11, Rust 1.90+, and the platform prerequisites listed in the [Tauri prerequisite guide](https://tauri.app/start/prerequisites/). Then:

```bash
pnpm install
pnpm validate
pnpm tauri dev
```

For the browser-only UI preview:

```bash
pnpm dev
```

To use a real local model, install Ollama, start it, and pull the reference model:

```bash
ollama pull qwen3:8b
```

The app defaults to `http://127.0.0.1:11434` and keeps the local provider visibly labeled. Remote provider credentials are stored by reference in the desktop OS keychain; they are not written to the application JSON state.

## Development

Useful commands:

```bash
pnpm build             # TypeScript check and production Vite build
pnpm test              # deterministic frontend tests
pnpm lint              # ESLint
pnpm format            # Prettier check
pnpm schema:validate   # JSON schema syntax checks
pnpm tauri build       # native bundle, with platform prerequisites
```

The canonical validation command is `pnpm validate`. The native portion requires a Rust toolchain and the desktop/mobile dependencies for the target platform.

The repository is organized around a small frontend shell and explicit native boundaries:

```text
src/                  React UI, state, context, storage, browser preview
src-tauri/             Tauri commands, providers, SQLite, keychain, tools
config/                checked-in defaults and reference provider/tool data
schemas/               versioned assistant, provider, tool, and export schemas
docs/                  architecture, ADRs, privacy, security, phases, recovery
tests/fixtures/        Qwen3 qualification fixture and release metadata
```

## Qualification and known limitations

This repository contains a [Qwen3 8B qualification fixture](tests/fixtures/qwen3-8b-qualification.yaml), but no real Qwen3 result is claimed until Ollama is available. Native Tauri, Android, iOS, and provider integration tests are also pending independent execution. Native GGUF process management and MCP client calls are documented extension points rather than shipped v0.1 features. The browser attachment control records the selected filename; the native grant/read commands are ready for end-to-end picker integration.

See [CONTRIBUTING.md](CONTRIBUTING.md), [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [docs/recovery/README.md](docs/recovery/README.md) before making release decisions.

## License

Juniper is released under the MIT License. See [LICENSE](LICENSE).
