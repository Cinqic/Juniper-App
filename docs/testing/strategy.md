# Testing strategy

`pnpm validate` is the canonical validation command. It is intended to run
formatting, lint, TypeScript, frontend tests, Rust formatting/clippy/tests,
and JSON schema syntax checks in one sequence.

Deterministic frontend tests cover assistant import/export, context order and
truncation, private persistence, and browser-preview streaming. Rust tests
cover the safe calculator, unit conversion, protocol result shape, loop
bounds, and schema version. Provider integration uses a fake HTTP server in
future CI work; real Qwen3 is reserved for the qualification fixture.

Frontend build, lint, formatting, schema syntax checks, deterministic tests,
and browser UI smoke checks were completed with the bundled Node runtime. No
real Qwen3, Tauri, Android, or desktop test is claimed because Rust, Java,
Android SDK/NDK, and Ollama were not available in this environment.
