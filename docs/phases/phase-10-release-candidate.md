# Juniper App v0.1 release candidate handoff

Status: `CANDIDATE - PENDING INDEPENDENT REVIEW`

## Exact final commit

The final handoff commit is recorded in the completion message for this task;
the report remains intentionally self-contained before that commit exists.

## Branch

`juniper-app-v0.1` (created from the canonical GitHub main branch; no existing
history was rewritten).

## Architecture summary

Tauri 2 shell, React/TypeScript/Vite UI, Rust native boundary, SQLite schema,
OS keychain credential abstraction, normalized provider stream events, and a
host-authored tool boundary. See `docs/architecture/overview.md`.

## Implemented features

Onboarding, responsive chat UI with browser-preview streaming, assistant
builder, versioned `.juniper` import/export, model/provider surfaces, Ollama
and OpenAI-compatible/llama.cpp transport path, context builder, safe tools,
scoped attachments, privacy center, diagnostics, local/remote labeling,
settings, migrations, schemas, CI workflows, and recovery documentation.

## Provider and tool status

The source implementation supports the documented transport shapes, but no
real Ollama, llama.cpp, or remote server was available for execution. Built-in
tools include calculator, datetime contract, conversions, memories, chat
search, scoped files, and system info; the Rust unit boundary fully exercises
the calculator/conversion/loop primitives when Rust is available.

## Tests/builds executed

Completed locally with the bundled Node runtime: `pnpm build`, `pnpm test` (6
tests), `pnpm lint`, `pnpm format`, `pnpm schema:validate`, and browser smoke
checks at desktop and 390px mobile widths. Rust, Tauri, desktop, Android, and
iOS commands remain pending because their toolchains were unavailable.

## Qwen3 8B qualification

Fixture: `tests/fixtures/qwen3-8b-qualification.yaml`. Real Qwen3 behavior,
thinking, tools, cancellation, and restart persistence are pending an Ollama
installation. No result is claimed.

## Mobile validation

Responsive UI and mobile capability metadata are present. Android/iOS builds,
devices, native mobile inference, and mobile credentials are untested.

## Known failures and accepted limitations

- Native build/test execution is pending Rust/OS toolchains.
- The checked-in pnpm lockfile was generated with pnpm 11.19.0; the frontend
  dependencies were installed and verified with the bundled Node runtime.
- Native GGUF process management and MCP client calls are extension points, not
  shipped v0.1 claims.
- Browser file attachment UX names a selected file; native text grant/read
  flows live behind Rust commands and need an end-to-end picker integration.

## Recovery and reviewer focus

Follow `docs/recovery/README.md`, then focus independent review on provider
stream parsing/tool-call association, keychain configuration across targets,
attachment grants, SQLite persistence wiring, and real Qwen3 qualification.
