# Testing strategy

`pnpm validate` is the canonical validation command. It runs formatting, lint,
TypeScript, frontend tests, Rust formatting, Clippy with `-D warnings`, Rust
tests, JSON schema checks, version consistency, license and runtime contracts,
and branding checks in one sequence.

`pnpm typecheck` checks `tsconfig.app.json` and `tsconfig.node.json`
explicitly. Before `0.3.0-rc.32` it ran `tsc --noEmit` against the solution
`tsconfig.json`, whose `files` list is empty, so it type-checked nothing and
an unimported identifier reached a release.

A gate passes only when it has exercised the property it claims. Surviving a
timeout, finding a file by name, or matching a source checksum is not
evidence that a shipped artifact works or carries the right branding.

## Deterministic tests

Frontend tests cover the native startup path under a mocked Tauri runtime
(stored Ollama discovery, the frontend-ready report, and the root error
boundary), the zero-model shell and navigation, assistant
import/export, context order and truncation, private-chat exclusion from both
persistence and user export, attachment metadata privacy, model-fit estimates,
markdown rendering, and browser-preview streaming.

Native tests cover the safe calculator, unit conversion, host-authored
result shape, tool loop bounds, the default-deny tool gate, permission scope
matching, capability gating of generation controls, provider JSON/SSE/pull
parsing, fake HTTP discovery/inspection/chat/tool/error servers, unknown-model
behavior, timeout and cancellation, scoped attachment and GGUF grants,
read-time attachment revalidation, bounded runtime logs, restart-safe
attachment persistence, SQLite migrations across schema v1 to v4, runtime
registry maturity, artifact manifests, and Device Link pairing/framing/scope
policy.

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

Linux bundles are built once on Ubuntu 22.04 and smoked on Ubuntu 22.04 and
24.04 under Xvfb (X11) in pull-request validation and in the release workflow.
`scripts/verify-linux-bundles.sh` launches the normal FUSE AppImage, the
`APPIMAGE_EXTRACT_AND_RUN=1` fallback, and the installed DEB through its desktop
entry. Each launch goes through `scripts/linux-launch-probe.sh`, which passes
only after Juniper reports `[juniper-startup] frontend ready`, a viewable
Juniper window is rendered with real content, no fatal diagnostic appears
during a settle period, and the process exits on SIGTERM. A timeout is always a
failure. Each mode runs from an empty profile and again with stored state that
enables an Ollama provider backed by a loopback stand-in (the rc.31 blank-window
state), and must persist the discovered model. The script also checks
architecture, an executable bundled `llama-server`, licenses, the desktop
entry, icons against the official artwork, and that purging the DEB removes
package files but keeps user data. `scripts/test-linux-launch-probe.sh` proves
the probe rejects a hung process, an early exit, a window that never becomes
ready, a blank surface, and a crash after readiness. No automated check covers
a native Wayland session.

Android builds start from a clean `tauri android init`, install the official
launcher icons, and verify them in the generated project and in the built APK
with `scripts/verify-android-branding.mjs` (pixel comparison of every launcher,
round, and adaptive-foreground density plus the adaptive XML and background).
The emulator smoke also resolves the launcher activity, checks that the
launcher drew the Juniper icon, opens Juniper from that launcher entry, and
requires the frontend-ready report and non-blank content. Windows MSI bundling plus an install, launch, and uninstall
smoke run on a Windows runner. A signed Android APK is built and put through an
emulator credential-vault instrumentation run plus install, launch, rotation,
relaunch, and uninstall smoke. The credential test proves plaintext absence,
Android Keystore key ownership, per-reference AAD binding, deletion, and failed
post-deletion retrieval. The package audit also requires the two supported
native ABIs, rejects server-runtime libraries, and checks 16 KiB `PT_LOAD`
alignment for every shared object.
Release artifacts include the unstripped native symbol archive. The emulator
cannot prove real offline token generation, so a physical ARM64 run remains a
separate llama.cpp Beta-promotion follow-up. The validation and release
workflows do not make that physical run a global desktop release gate.

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
