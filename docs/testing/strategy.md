# Testing strategy

`pnpm validate` is the canonical validation command. It is intended to run
formatting, lint, TypeScript, frontend tests, Rust formatting/clippy/tests,
and JSON schema syntax checks in one sequence.

Deterministic frontend tests cover the zero-model shell and navigation,
assistant import/export, context order and truncation, private persistence,
and browser-preview streaming. Rust tests cover the safe calculator, unit
conversion, protocol result shape, loop bounds, permission scope matching,
provider JSON/SSE/pull parsing, fake HTTP discovery/inspection/chat/error,
timeout/cancellation fixtures, scoped attachment/GGUF grants, and schema
version (32 tests).
Real-model qualification is reserved for an owner-selected installed model.
The historical Qwen fixture is optional.

Frontend build, lint, formatting, schema validation, deterministic tests, and
browser UI smoke checks were completed with the bundled Node runtime. Ollama
was reachable but had no installed models, so no real-model generation is
claimed. Native `cargo check`, test compilation, strict Clippy, and the full
Rust test suite pass with temporary user-local Linux development metadata. The
Linux Tauri `.deb` and `.AppImage` bundles also build in that isolated
prerequisite environment. Android tests additionally require the Android NDK
clang toolchain.

The fault-injection review targets malformed provider records, unknown tool
names, invalid arguments, private-chat leakage, attachment IDs outside the
picker grant set, denied permissions, oversized results, and tool-loop
overruns. These invariants are represented by the provider, tool, storage, and
frontend tests; a release reviewer should run the same fixtures against any
adapter change.
