# Testing strategy

`pnpm validate` is the canonical validation command. It is intended to run
formatting, lint, TypeScript, frontend tests, Rust formatting/clippy/tests,
and JSON schema syntax checks in one sequence.

Deterministic frontend tests cover assistant import/export, context order and
truncation, private persistence, and browser-preview streaming. Rust tests
cover the safe calculator, unit conversion, protocol result shape, loop
bounds, and schema version. Provider integration uses a fake HTTP server in
future CI work; real-model qualification is reserved for an owner-selected
installed model. The historical Qwen fixture is optional.

Frontend build, lint, formatting, schema validation, deterministic tests, and
browser UI smoke checks were completed with the bundled Node runtime. Ollama
was reachable but had no installed models, so no real-model generation is
claimed. Native Tauri tests are blocked in this environment by missing Linux
DBus/GTK/WebKit development packages; Android tests additionally require the
Android NDK clang toolchain.
