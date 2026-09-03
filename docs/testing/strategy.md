# Testing strategy

`pnpm validate` is the canonical validation command. It runs formatting, lint,
TypeScript, frontend tests, Rust formatting, Clippy with `-D warnings`, Rust
tests, JSON schema checks, and version consistency in one sequence.

## Deterministic tests

Frontend tests cover the zero-model shell and navigation, assistant
import/export, context order and truncation, private-chat exclusion from both
persistence and user export, attachment metadata privacy, model-fit estimates,
markdown rendering, and browser-preview streaming.

Native tests cover the safe calculator, unit conversion, host-authored
result shape, tool loop bounds, the default-deny tool gate, permission scope
matching, capability gating of generation controls, provider JSON/SSE/pull
parsing, fake HTTP discovery/inspection/chat/tool/error servers, unknown-model
behavior, timeout and cancellation, scoped attachment and GGUF grants,
read-time attachment revalidation, bounded runtime logs, restart-safe
attachment persistence, and SQLite migrations across schema v1 to v3.

Two native tests are `#[ignore]`d because they require a live Ollama service
and an owner-selected installed model. They are not counted as passes when
skipped.

## Real-model qualification

Qualification runs against a real installed model, not a fixture:

```bash
JUNIPER_LIVE_OLLAMA_MODEL=<installed model> \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture
```

The suites in `tests/qualification/` each declare an `applies_when` capability
gate. The harness reads the capabilities the runtime actually reports from
`/api/show` and reports a suite whose gate is unmet as NOT-APPLICABLE. A
capability a model does not have is never recorded as a pass. Recorded results
are in [../qualification/ollama-real-model-evidence.md](../qualification/ollama-real-model-evidence.md).

The standalone local path adds deterministic catalog, device-fit, symlink
rejection, and managed-state tests. A release build must additionally run the
pinned runtime build script and the Linux/Windows install smoke; those checks
prove that the Tauri resource exists and that the app-owned process can be
started without Ollama.

`tests/fixtures/qwen3-8b-qualification.yaml` is a historical fixture retained
for reference. It is not evidence of a real-model result.

## Platform validation

Linux builds, `.deb`/`.AppImage` bundling, and a launch smoke are reproducible
locally and in CI. Windows MSI bundling plus an install, launch, and uninstall
smoke run on a Windows runner. A signed Android APK is built and put through an
emulator install, launch, rotation, relaunch, and uninstall smoke.

Native unit tests are excluded from the Windows release job only: the Tauri mock
runtime fails to load there, aborting the test binary at startup with
`STATUS_ENTRYPOINT_NOT_FOUND` before any test runs. Every compile-level check,
including `cargo clippy -D warnings`, still runs on Windows, and the native
tests run on Linux.

## Fault injection

The fault-injection review targets malformed provider records, tool calls the
request never enabled, unknown tool names, invalid arguments, private-chat
leakage, attachment IDs outside the picker grant set, denied permissions,
oversized results, and tool-loop overruns. These invariants are represented by
the provider, tool, storage, and frontend tests; a release reviewer should run
the same fixtures against any adapter change.
