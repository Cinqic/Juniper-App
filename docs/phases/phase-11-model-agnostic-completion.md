# Phase 11 — Model-agnostic completion and release-candidate remediation

Status: candidate pending independent review

Starting canonical commit: `9c900021435505ea5b2bb16647ebd5bf2bb035f5`
Working branch: `luna/juniper-model-agnostic-completion`

## Implemented in this pass

- Removed the product-level model default and made Juniper’s assistant binding optional.
- Added runtime-derived model profiles, capability tri-state handling, execution-location labels, and conversation model overrides.
- Added native Ollama discovery, inspection, chat, pull progress/cancellation, deletion, and running-model command surfaces.
- Added native SQLite v3 load/save commands and a transaction-backed repository path, including normalized attachment metadata with native-only paths; browser localStorage remains preview-only.
- Replaced duplicated prompt composition with deterministic personality, memory, tool guidance, history truncation, and current-message handling.
- Added a real JSON Schema validator script with representative fixtures.
- Tightened calculator limits, exact tool-argument validation, host result bounds, and dimension-safe unit conversion.
- Added the scoped desktop file-picker path for text attachments and native cancellation joining.
- Added the native permission request/decision loop, durable assistant/chat grants, and fixed-command Ollama GGUF import path.
- Split the remaining feature pages out of `App.tsx` into `src/app/pages.tsx`, leaving the shell and chat orchestration in the app entrypoint.
- Repaired pnpm version consistency and the GitHub Actions pnpm-cache setup order.

## Validation evidence

- Ollama 0.33.2 daemon: reachable at `http://127.0.0.1:11434`.
- Installed models observed: none (`/api/tags` returned `{"models":[]}`).
- Model download performed: none; the contract explicitly forbids an automatic large download.
- Real model generation: not claimed; pending the owner selecting an installed model.
- Frontend typecheck, build, lint, formatting, tests, and JSON Schema validation: pass with the bundled Node runtime.
- Frontend tests: 5 files, 17 tests passed.
- Rust/Tauri host `cargo check`, test compilation, strict Clippy, and the full 32-test suite: pass with temporary user-local Linux development metadata.
- `pnpm tauri build --bundles deb,appimage`: pass; optimized native binary, `.deb`, and `.AppImage` artifacts produced.
- Bounded `pnpm tauri dev` smoke: the Vite dev server and compiled Tauri binary launched and remained running until the headless timeout; no GUI interaction is claimed.
- Android compilation: the Rust Android target is installed, but the Android NDK clang toolchain is absent in this environment.

## Known limitations

- User-data tool permission prompts and their durable policy store are wired into the native chat loop. Managed llama.cpp process ownership remains unavailable; Ollama GGUF import is supported through a fixed native command.
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
