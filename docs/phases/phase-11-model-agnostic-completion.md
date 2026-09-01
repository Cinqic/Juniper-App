# Phase 11 — Model-agnostic completion and release-candidate remediation

Status: candidate pending independent review

Starting canonical commit: `9c900021435505ea5b2bb16647ebd5bf2bb035f5`
Working branch: `luna/juniper-model-agnostic-completion`

## Implemented in this pass

- Removed the product-level model default and made Juniper’s assistant binding optional.
- Added runtime-derived model profiles, capability tri-state handling, execution-location labels, and conversation model overrides.
- Added native Ollama discovery, inspection, chat, pull progress/cancellation, deletion, and running-model command surfaces.
- Added native SQLite v2 load/save commands and a transaction-backed repository path; browser localStorage remains preview-only.
- Replaced duplicated prompt composition with deterministic personality, memory, tool guidance, history truncation, and current-message handling.
- Added a real JSON Schema validator script with representative fixtures.
- Tightened calculator limits, exact tool-argument validation, host result bounds, and dimension-safe unit conversion.
- Added the scoped desktop file-picker path for text attachments and native cancellation joining.
- Repaired pnpm version consistency and the GitHub Actions pnpm-cache setup order.

## Validation evidence

- Ollama 0.33.2 daemon: reachable at `http://127.0.0.1:11434`.
- Installed models observed: none (`/api/tags` returned `{"models":[]}`).
- Model download performed: none; the contract explicitly forbids an automatic large download.
- Real model generation: not claimed; pending the owner selecting an installed model.
- Frontend typecheck, build, lint, formatting, tests, and JSON Schema validation: pass with the bundled Node runtime.
- Rust/Tauri host compilation: attempted with Rust 1.90, but blocked before source compilation by the missing Linux `dbus-1.pc`/GTK/WebKit development packages.
- Android compilation: the Rust Android target is installed, but the Android NDK clang toolchain is absent in this environment.

## Known limitations

- User-data tool permission prompts and their durable policy store are not yet wired into the native chat loop; those tools are not sent by the default chat path.
- GGUF selection now has a scoped, header-validating picker; managed llama.cpp import/execution remains unavailable.
- MCP is explicitly unavailable in this candidate.
- Mobile build and iOS validation require platform toolchains not present in the workspace.

## Owner recovery flow

1. Install and start Ollama.
2. Open Juniper; the Models page checks the preconfigured local endpoint.
3. Choose Download a model and enter a compatible model reference.
4. Watch real status/progress, cancel if needed, then refresh/select the model.
5. Start a chat; Juniper’s identity, context, memory policy, tools, and privacy labels remain the same while the model changes.

Independent review should focus on native compilation, Tauri plugin permissions,
provider fixtures, the SQLite restart path, cancellation races, and permission
enforcement before release approval.
