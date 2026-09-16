# 0.3.0-rc.32 independent review

This is the release review of `0.3.0-rc.32` after pull request #32 merged. It
is not a second opinion on that pull request's own evidence. Every result below
was reproduced during this review or read from the exact CI run named.
`PASS`, `FAIL`, `NOT VERIFIED`, `NOT APPLICABLE`, and `ACCEPTED LIMITATION`
are used literally.

## Provenance

| Item          | Value                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewer      | Claude Opus 5 (AI model), acting as independent reviewer and release engineer for the repository owner. Not a human reviewer.                                                |
| Date          | 2026-09-16                                                                                                                                                                   |
| Base          | `main` at `cb7892395239d23a4297e8bf1b65ead0f96aedbf` (merge of #32)                                                                                                          |
| Reviewed code | `9efdfb8` on PR #33 (head of the fixes). The commit adding this record changes documentation only; the merge SHA and tag commit are in the PR and `RELEASE-PROVENANCE.json`. |
| Local host    | FLOWBOX: Linux Mint 22.3 (Ubuntu 24.04 base), kernel 7.0.0-31, X11. Rust 1.90.0, Node 22.23.2, pnpm 11.19.0, CMake 3.31.6 (Android SDK copy).                                |
| CI            | GitHub-hosted Ubuntu 22.04, Ubuntu 24.04, and Windows (`windows-latest`) runners                                                                                             |

State at the start of the review: `v0.3.0-rc.32` did not exist as a tag or
release, the latest published prerelease was `v0.3.0-rc.31`, no issues were
open, and the post-merge `main` validation run 35133244038 was still running.

## Version decision

The candidate stays `0.3.0-rc.32`. The tag, the release, and every rc.32
release-workflow run were absent, so no immutable rc.32 identity existed that
the fixes below could be confused with. Nothing was ever published under that
number. The rc.31 evidence and the rc.32 defect record
([rc32-platform-defects.md](rc32-platform-defects.md)) are unchanged.

## Findings

Each finding was reproduced, or for R4 its mechanism was confirmed, before it
was fixed. R1, R2, R3, R5, and R6 have negative controls that fail against the
previous code or gate.

### R1: saves silently stopped after removing a provider or model (data loss)

- **Reproduction:** `save_app_data_with_paths` with a model whose `providerId`
  is not among the providers, or a conversation whose `modelProfileId` is not
  among the models, returned `FOREIGN KEY constraint failed`. Both states are
  produced by normal UI actions: Models → remove provider keeps its models as
  `not-found`, and Models Market → remove leaves chats pinned to that model.
- **Impact:** the snapshot save is one transaction, so that save and every
  later save failed. `App.tsx` called `void saveNativeAppData(data)`, so the
  rejection was invisible, and every change after the removal was lost on the
  next start.
- **Root cause:** the relational tables are a projection of the authoritative
  `app_state` JSON snapshot, but the projection wrote dangling references into
  foreign-key columns.
- **Fix:** the projection skips model rows without a persisted provider, nulls
  a conversation's `model_profile_id` or a memory's `assistant_id` that has no
  persisted target, skips grants for missing assistants or chats, and ignores
  duplicate ids. `app_state` keeps the full snapshot, so the UI still shows
  "Model unavailable" as before.
- **Regression test:** `storage::tests::saves_survive_references_left_dangling_by_removals`.
  Negative control: the same test against the previous `storage.rs` fails with
  `FOREIGN KEY constraint failed`.

### R2: a failed load let defaults overwrite stored data

- **Reproduction:** if `load_app_data` rejected, the frontend alerted, marked
  itself hydrated, and its save effect wrote `initialAppData()` over the
  database.
- **Fix:** after a failed load, saving stays disabled for the session and a
  persistent notice says the stored data was left unchanged. A failed save now
  shows its error instead of disappearing.
- **Regression tests:** `App.tauri.test.tsx` "never overwrites stored state
  with defaults when loading it failed" and "shows a save failure instead of
  silently dropping changes". Negative control: both fail against the previous
  `App.tsx`.

### R3: the eight-calls-per-round tool bound skipped host data tools

- **Reproduction:** `tools::loop_allowed` was only checked inside
  `tools::execute_call`, which handles `calculator.evaluate`,
  `datetime.current`, and `unit.convert`. `memory.*`, `chat.search`, `file.*`,
  and `system.info` ran for every call in a turn. With a stored grant, 13
  `memory.save` calls in one round wrote 13 memories. The threat model claimed
  "eight calls per round".
- **Fix:** `host_tool_turn` applies the bound to every call before the
  permission gate or any host data access. Calls over the limit get a
  host-authored `TOOL_LOOP_LIMIT` denial.
- **Regression test:** `providers::tests::host_data_tool_calls_beyond_the_per_round_bound_are_denied_unexecuted`.
  Negative control: without the guard it fails (13 memories, expected 8).

### R4: quitting during a generation left `llama-server` running

- **Mechanism:** the desktop runtime child was spawned without `kill_on_drop`
  and never tracked outside the generating task. Tauri exits with
  `std::process::exit`, which runs no destructors. A child spawned that way is
  reparented to PID 1 and keeps running; that was confirmed on FLOWBOX with a
  stand-in child. A `llama-server` spawned the same way would keep its model
  loaded and its loopback port bound after Juniper closed.
- **Fix:** children are tracked in `AppState` by request and killed on
  `RunEvent::Exit`. They are also `kill_on_drop` and reaped when a generation
  ends. No dependency was added.
- **Regression tests:** `local_runtime::tests::exit_cleanup_stops_runtime_children_that_are_still_running`
  and `stopping_a_finished_generation_reaps_its_runtime_child`.
- **Not verified:** an interactive quit while a real model is generating in the
  packaged app.

### R5: the Windows MSI smoke passed on survival

- **Symptom:** `verify-windows-msi.ps1` launched `Juniper.exe` and passed if
  the process was alive after 10 seconds. That is the Linux rc.31 false positive
  on another platform, and the Windows build contained the same blank-interface
  defect.
- **Fix:** each launch must report `[juniper-startup] frontend ready`, stay
  alive through a 15-second settle period, and produce no fatal report. A second
  launch seeds the rc.31 stored Ollama state against a loopback stand-in and
  must persist the discovered model. The job now also runs in pull-request
  validation, so the Windows path is proven before a tag instead of only after.
- **Limit:** the Windows smoke does not capture window pixels.
- **Negative control:** branch `negative-control/windows-render-crash` injects a
  render-time `ReferenceError` after Ollama discovery. With unit tests present,
  run 35147005471 stopped at `App.tauri.test.tsx`. With unit tests removed from
  that branch's workflow, run 35147905894 built and installed the MSI, and the
  fresh launch passed. The stored-Ollama launch then failed on
  `[juniper-startup] frontend fatal: ReferenceError: negativeControlRenderCrash is not defined`.

### R6: a passed Android emulator smoke could still time out

- **Evidence:** in `main` validation run 35133244038 at `cb78923`, every
  Android check had passed by 18:33:19: credential vault, launcher icon,
  frontend readiness, rendered content, rotation, relaunch, and uninstall. The
  step then ran until its 30-minute `timeout` returned 124, and the runner later
  killed an orphaned `qemu-system-x86_64-headless`. The rc.31 `main` run
  34268021113 also ended in this step's 30-minute timeout (recorded in
  `rc32-platform-defects.md` as flakiness; its log was not re-inspected here).
- **Root cause:** the cleanup trap sent SIGTERM to the emulator and then called
  `wait` without a bound.
- **Classification:** test/gate defect, not a product defect and not a proven
  transient. The release workflow runs the same script, so a signed APK that
  passed every check could still fail its immutable tag.
- **Fix:** the drain is bounded to 60 seconds and then escalates to SIGKILL for
  the emulator and its children.
- **Reproduction and control:** a stand-in that ignores SIGTERM held the old
  cleanup until `timeout` returned 124. The new cleanup exits after the bounded
  drain and the stand-in is gone.

### R7: documentation truth

- README said no external host appears in the sources and every request uses
  the configured provider URL. Models Market downloads from the pinned
  Hugging Face URLs in `config/models/catalog.json`. The sentence now says so.
- Three documents linked `docs/release/0.2.0-rc.1-final-review.md`, which was
  never committed. The links now say that instead of pointing nowhere.
- The release Linux job now installs the same graphics baseline as the
  validated Linux smoke (`libgles2` and friends), removing a difference between
  what validation proved and what the tagged build runs.

## Non-blocking findings (not changed)

| Finding                                                                                                                                                                                                | Status                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Android health check, model list, and inspection use the desktop credential path, so a provider with an API key cannot be tested or listed on Android (chat uses the Keystore path and is unaffected). | Functional limitation; follow-up        |
| Managed downloads use a 300-second whole-request timeout, so a large model on a slow link stops and needs a manual resume; a stalled stream is not detected until that timeout.                        | Usability; integrity unaffected         |
| The Ollama path clears only conversation host context for private chats; the OpenAI-compatible path also clears memories. Memories reach the model through the system prompt either way.               | Inconsistency; no data leaves the route |
| Frontend network labels are advisory: the native side validates the label values but trusts the frontend's classification.                                                                             | Accepted design                         |

## Reproduced validation

Clean worktree of `9efdfb8` under `~/.cache` on FLOWBOX (a first clean run at
`701f01b` gave the same counts before a host reboot erased its `/tmp` logs):

| Check                                                                                                       | Result                                                               |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                            | PASS                                                                 |
| `pnpm audit --audit-level high`                                                                             | PASS                                                                 |
| `pnpm validate`: Prettier, ESLint, `tsc` app and node projects                                              | PASS                                                                 |
| Frontend tests (Vitest)                                                                                     | PASS, 63 tests in 11 files (61 before this review)                   |
| `cargo fmt --check`, `cargo clippy --all-targets -D warnings`                                               | PASS                                                                 |
| Native tests                                                                                                | PASS, 74 passed, 2 ignored (live Ollama; need an owner-chosen model) |
| Schemas, version, license, runtime contract, branding                                                       | PASS (7 schemas; 5 runtime pins; 53 branding assets)                 |
| `pnpm build`                                                                                                | PASS                                                                 |
| `scripts/build-llama-runtime.sh`, `tauri build --bundles deb,appimage -- --locked`                          | PASS (x86-64 ELF `llama-server`)                                     |
| TypeScript gate negative control: remove the `modelProfileFromDiscovery` import                             | current `typecheck` FAIL `TS2304` as expected; rc.31 command exits 0 |
| Branding gate negative control: `verify-android-branding.mjs apk` on the published rc.31 APK (hash-checked) | FAIL as expected, 16 failures                                        |

## Security and supply chain

- `pnpm audit --audit-level high`: PASS (no advisories at or above high).
- `cargo audit` on `src-tauri/Cargo.lock` (552 crates): no vulnerabilities.
  Seven informational advisories, all transitive through Tauri and GTK3:
  `proc-macro-error` (RUSTSEC-2024-0370), five `unic-*` crates
  (RUSTSEC-2025-0075, -0080, -0081, -0098, -0100), unmaintained; and `glib`
  0.18.5 `VariantStrIter` unsoundness (RUSTSEC-2024-0429). They are upstream
  maintenance items, not release blockers.
- Secret scan: gitleaks over repository history PASS in PR #33 run 35146901093. No secrets or signing material in this change.
- Network paths: no telemetry, analytics, or crash upload. The outbound
  requests are configured provider endpoints; the pinned HTTPS catalog
  downloads (`https_only`, SHA-256 verified before an atomic rename); the
  loopback `llama-server`; and the documented legacy `ollama create` import.
  No listener is opened except the ephemeral loopback runtime port. Device Link
  has no socket, command, or enabled UI.
- Credentials: desktop uses the OS keychain through opaque references; Android
  uses Keystore AES-GCM with the reference as AAD. The Android plugin's
  credential commands are not in its permission set, so the webview cannot
  invoke them. No secret is written to SQLite or exports.
- Tauri capabilities: desktop `core:default` and `dialog:default`; mobile
  `core:default`. CSP limits `connect-src` to self and loopback.

## Platform evidence

| Platform | Evidence                                                                                                                                                                                                                                                                                                 | Result                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Linux    | Locally built bundles on FLOWBOX's real X11 display (NVIDIA): normal FUSE AppImage and extract-and-run, each fresh and with stored Ollama state; frontend ready, rendered window, clean SIGTERM exit, discovered model persisted; bundled `llama-server` runs; icons match                               | PASS                                          |
| Linux    | Installed DEB on FLOWBOX                                                                                                                                                                                                                                                                                 | NOT VERIFIED locally (no sudo)                |
| Linux    | PR #33 run 35146901093: Ubuntu 22.04 and 24.04 Xvfb smokes of the CI-built DEB (installed through its desktop entry, purged, user data kept), FUSE AppImage, and extract-and-run; launch-probe self-test                                                                                                 | PASS                                          |
| Linux    | Native Wayland session                                                                                                                                                                                                                                                                                   | NOT VERIFIED                                  |
| Windows  | PR #33 run 35146901093: pinned `llama-server.exe` build, `validate:no-native-tests`, one MSI, ProductVersion `0.3.0.32`, install, readiness launch fresh and with stored Ollama state, persisted discovered model, uninstall                                                                             | PASS                                          |
| Windows  | Authenticode signature                                                                                                                                                                                                                                                                                   | ACCEPTED LIMITATION: unsigned                 |
| Android  | PR #33 run 35146901093: clean `tauri android init`, branding install and project check, debug APK audit and APK branding (21 checks), credential-vault instrumentation `OK (1 test)`, launcher-drawn Juniper icon, launch from launcher, frontend ready, rendered content, rotation, relaunch, uninstall | PASS (x86_64 emulator)                        |
| Android  | Signed release APK                                                                                                                                                                                                                                                                                       | Built and smoked only by the release workflow |
| Android  | Physical ARM64 device and native inference                                                                                                                                                                                                                                                               | NOT VERIFIED (Beta)                           |

## Accepted limitations

- Android native llama.cpp is Beta; there is no physical ARM64 run.
- Optional runtimes without Juniper adapters or artifacts are not available.
- The Windows MSI is unsigned unless `SIGNING-windows.txt` says `Valid`.
- No macOS, iOS, or MCP client.
- Device Link transport and the Juniper Network provider are disabled.
- Native Wayland is not verified; Linux evidence is X11 (Xvfb and a real X11
  session).
- Android loopback is the device itself.
- The browser preview is not the native runtime.

## Verdict

**APPROVED FOR RELEASE AS THE SPECIFIED RELEASE CANDIDATE** (`0.3.0-rc.32`).

This approval covers the reviewed code above. Release procedure is unchanged:
the merged `main` commit must pass validation before the tag is pushed, and the
tag-driven release workflow publishes nothing unless every job passes. This is
not approval of a final `0.3.0`.
