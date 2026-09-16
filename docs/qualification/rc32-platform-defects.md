# 0.3.0-rc.32 platform defect record

Two defects were reported against the published `0.3.0-rc.31` prerelease:

1. the Android app showed the default Tauri launcher icon;
2. the Linux build did not start usably on the reporter's PC.

Both were reproduced against the published rc.31 artifacts before any change.
This record lists what was reproduced, the root causes, the repairs, and the
evidence. `PASS`, `FAIL`, `NOT VERIFIED`, and `NOT APPLICABLE` are used
literally; missing evidence is never recorded as a pass.

## Environments

| Name         | Details                                                                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FLOWBOX      | Linux Mint 22.3 (Ubuntu 24.04 base), kernel 7.0.0-31, Cinnamon on X11. NVIDIA GeForce RTX 2060 (driver 595.84) plus AMD Cezanne iGPU. WebKitGTK 2.52.6, GTK 3.24.41, FUSE 3.14. Ollama 0.33.2 running with installed models. |
| FLOWBOX Xvfb | The same host with a user-space Xvfb display (software rendering), for repeatable probes.                                                                                                                                    |
| Emulator     | Android emulator on FLOWBOX (KVM), `system-images;android-30;default;x86_64`, Pixel 2 profile, WebView 83.0.4103.120, AOSP Launcher3.                                                                                        |
| CI           | GitHub-hosted Ubuntu 22.04 and 24.04 runners; see the pull request checks for run links.                                                                                                                                     |

Toolchain: Rust 1.90.0, Node 22.23.2, pnpm 11.19.0, Tauri CLI 2.11.4, `tauri`
crate 2.11.5, Android build-tools 35.0.0, NDK 29.0.13113456, CMake 3.31.6.

## Defect ledger

### D1: Android launcher shows the Tauri logo

- **Artifact:** `Juniper-0.3.0-rc.31-android-universal.apk` (published).
- **Reproduction:** `aapt2 dump badging <apk>` names `res/o-.png` (and other
  densities) as the application icon; extracting it shows Tauri's yellow and
  cyan logo. Installing the APK on the emulator shows the same logo above the
  "Juniper" label in the launcher.
- **Expected:** the official Juniper artwork in every launcher density, the
  adaptive icon, and the round icon.
- **Root cause (confirmed):** `pnpm tauri android init --ci` generates
  `src-tauri/gen/android/app/src/main/res/mipmap-*/ic_launcher*.png` from
  Tauri's template and no `mipmap-anydpi-v26` adaptive icon. Nothing copies
  `src-tauri/icons/android/`. `tauri icon` writes Android icons into
  `gen/android` only when that directory already exists, so the committed set
  never reached a clean CI build. Running `tauri icon public/juniper-logo.png`
  reproduces every committed Android PNG and the adaptive XML byte for byte;
  only the background colour differs (`#fff` from the CLI, Juniper `#000000`
  committed).
- **Repair:** `scripts/install-android-branding.mjs` copies the
  checksum-verified committed set into the generated project after every init.
  Validation and release run it before Gradle.
- **Status:** repaired. See D2 and the evidence section.

### D2: Android branding gate checked sources, not what ships

- **Symptom:** `pnpm branding:verify` passed for rc.31 because it only
  checksummed `src-tauri/icons/**`.
- **Repair:** `scripts/verify-android-branding.mjs project` (generated project)
  and `... apk` (built APK through `aapt2`) decode and compare every launcher,
  round, and adaptive-foreground density with the official images pixel by
  pixel. They also check the manifest `icon`/`roundIcon` references, the
  adaptive-icon XML, the `#000000` background, and resources that could shadow
  the launcher. `branding:verify` fails if a workflow that builds the APK drops
  or reorders these steps. The emulator smoke checks the icon the launcher drew
  and opens Juniper from that entry.
- **Regression tests:** `scripts/verify-android-branding.test.ts` (skipped
  install, wrong foreground, wrong round icon, wrong legacy icon, wrong
  adaptive XML reference, wrong background, unexpected manifest icon,
  non-Juniper roundIcon override, shadowing resource).

### D3: Linux window stays blank

- **Artifacts:** `Juniper-0.3.0-rc.31-linux-x86_64.AppImage` (published); the
  DEB contains the same frontend.
- **Reproduction on FLOWBOX:** launching the AppImage from a terminal kept the
  process alive with a mapped 1280×820 window whose every pixel was `#0a0a0a`.
- **Narrowing:** `WEBKIT_DISABLE_DMABUF_RENDERER=1`,
  `WEBKIT_DISABLE_COMPOSITING_MODE=1`, and `__NV_DISABLE_EXPLICIT_SYNC=1`
  each left the window blank. With an empty `XDG_DATA_HOME` the full interface
  rendered. Copying only `juniper.db` reproduced the blank window, and copying
  only the WebKit storage did not. The database passed `PRAGMA integrity_check`
  at schema v4. Disabling only its stored Ollama provider restored the UI.
  Replaying that state under Vitest with a mocked Tauri runtime raised
  `ReferenceError: modelProfileFromDiscovery is not defined`.
- **Root cause (confirmed):** `src/app/App.tsx` called
  `modelProfileFromDiscovery` without importing it. When an enabled Ollama
  provider answered with installed models, the discovery state update threw
  during render and React unmounted the whole interface. It is not a GPU,
  WebKitGTK, FUSE, or packaging failure. The same code runs on every desktop
  platform, so any user with an enabled Ollama provider and installed models
  was affected. With Ollama unreachable, rc.31 rendered normally.
- **Repair:** add the import. No graphics workaround was added.
- **Regression test:** `src/app/App.tauri.test.tsx` fails on rc.31 with the
  ReferenceError and passes after the fix. It also requires the discovered
  models to be saved.

### D4: TypeScript gate checked no files

- **Symptom:** `pnpm typecheck` passed on rc.31 although `App.tsx` referenced
  an undefined identifier.
- **Root cause (confirmed):** `tsc --noEmit` ran against the solution-style
  `tsconfig.json` (`"files": []` with references) without `--build`, so no
  project was checked.
- **Repair:** check `tsconfig.app.json` and `tsconfig.node.json` explicitly
  and fix the latent type errors this exposed (no behaviour changes).
- **Negative control:** with the import removed, the new command fails with
  `TS2304` and the old command exits 0.

### D5: Linux release smoke passed on survival

- **Symptom:** `scripts/verify-linux-bundles.sh` accepted exit status 124 from
  `timeout 20s`.
- **Negative control (old semantics):** on FLOWBOX Xvfb, the rc.31 AppImage
  with the blanking Ollama state, run exactly as the old script did
  (`APPIMAGE_EXTRACT_AND_RUN=1 timeout 20s`), exited 124, which the old script
  counted as a pass. The Ollama stand-in logged two `GET /api/tags` requests.
- **Repair:** `scripts/linux-launch-probe.sh` (see
  [testing strategy](../testing/strategy.md)). A timeout is always a failure.
- **Negative controls (new semantics):** `scripts/test-linux-launch-probe.sh`
  rejects a hung process, an early exit, a window that never becomes ready, a
  ready-but-blank surface, and a fatal report after readiness, and accepts a
  rendered stand-in. It runs in validation. The published rc.31 AppImage with a
  copy of the reporter's data fails the probe on FLOWBOX's real display.

### D6: AppImage normal execution was never tested

- **Symptom:** the release smoke only ran `APPIMAGE_EXTRACT_AND_RUN=1`.
- **Repair:** the smoke launches the normal FUSE path and the extract-and-run
  fallback as separate required modes, and requires the startup report to show
  the runtime resolved inside the FUSE mount (`.mount_*`) or the extraction
  directory respectively.

### D7: DEB check did not prove a usable install

- **Symptom:** the smoke checked `command -v juniper` and survival only.
- **Repair:** the smoke validates the desktop entry, launches its `Exec` line
  through the probe, verifies `/usr/lib/Juniper/runtime/llama-server` is
  executable and runs, compares icons with the official artwork, and confirms
  purge removes every package-owned file while user data remains.

### D8: Startup failures were not observable

- **Symptom:** setup errors surfaced only as `error while running Juniper`, and
  a crashed interface left no trace.
- **Repair:** `[juniper-startup]` lines on local stderr report version,
  platform, display session, graphics overrides (names only), the resolved
  bundled runtime, the failing stage and path, frontend readiness, and a
  bounded single-line frontend error. A root error boundary shows an error page
  instead of a blank window. A database from a newer schema is reported as
  such and left unchanged. Nothing is sent off the device.

### D9: Android emulator smoke passed on activity focus

- **Symptom:** every rc.31 lifecycle capture of a fresh launch on the software
  GPU emulator is plain white, yet the smoke passed because it only checked
  `mResumedActivity` and window focus. After about 45 seconds the interface
  does render.
- **Repair:** after launching from the launcher entry, the smoke requires the
  `[juniper-startup] frontend ready` line in logcat and a non-blank capture of
  the content area. It fails on `frontend fatal` or a failed startup stage.

### Related observations (not defects)

- The Tauri AppImage GTK hook exports `GDK_BACKEND=x11`, so the AppImage runs
  through XWayland on Wayland desktops.
- The main-branch validation run for the rc.31 merge (run 34268021113) timed
  out in the Android emulator smoke after 30 minutes; the rc.31 release run
  passed. Flakiness, not these defects.
- Tauri versions are aligned (crate 2.11.5, API 2.11.1, CLI 2.11.4). Neither
  defect came from a dependency, and no dependency was changed.

## Evidence

Local evidence was produced on FLOWBOX between 11:00 and 12:20 on 2026-09-16.
CI evidence is attached to the pull request and release workflow runs.

### Android

| Check                                                                                       | Result                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Published rc.31 APK, `verify-android-branding.mjs apk`                                      | FAIL as expected (16 failures; Tauri default images)            |
| Clean rc.31 `tauri android init`, `verify-android-branding.mjs project`                     | FAIL as expected                                                |
| Same project after `install-android-branding.mjs`                                           | PASS (21 checks)                                                |
| Fresh checkout at the pre-review commit: init, unbranded check, install, project check      | unbranded FAIL as expected (17 failures); branded PASS          |
| Fresh checkout: debug APK `verify-android-apk.sh` and `verify-android-branding.mjs apk`     | PASS (21 branding checks)                                       |
| Fresh checkout, emulator: credential-vault instrumentation                                  | PASS (`OK (1 test)`)                                            |
| Fresh checkout, emulator: launcher resolves `com.cinqic.juniper/.MainActivity`              | PASS                                                            |
| Fresh checkout, emulator: launcher-drawn icon signature                                     | PASS (green 0.0276, black 0.2722, Tauri colours 0)              |
| Fresh checkout, emulator: open from launcher, `frontend ready` in logcat, non-blank content | PASS (122 distinct colours)                                     |
| Fresh checkout, emulator: rotation, force-stop relaunch, uninstall                          | PASS                                                            |
| Published rc.31 APK, emulator launcher check                                                | FAIL as expected (yellow 0.0177, cyan 0.0175)                   |
| Signed release APK, physical Android device                                                 | NOT VERIFIED locally; signed build runs in the release workflow |

### Linux

| Check                                                                                           | Result                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| rc.31 AppImage, FLOWBOX display, reporter's data (copy)                                         | FAIL as expected: window never ready, uniform `#0a0a0a` |
| rc.32 AppImage built from this branch, FLOWBOX display (X11, NVIDIA), reporter's data (copy)    | PASS; discovered the host's three Ollama models         |
| Reporter's original `juniper.db` after all runs                                                 | unchanged (SHA-256 verified)                            |
| Fresh checkout: `pnpm install --frozen-lockfile` and `pnpm validate`                            | PASS (61 frontend tests, 70 native tests)               |
| Fresh checkout: `test-linux-launch-probe.sh`                                                    | PASS (5 non-usable launches rejected, 1 accepted)       |
| Fresh checkout: `build-llama-runtime.sh`, `tauri build --bundles deb,appimage`                  | PASS                                                    |
| Fresh-checkout bundles, FLOWBOX Xvfb: AppImage FUSE, fresh profile and stored Ollama            | PASS                                                    |
| Fresh-checkout bundles, FLOWBOX Xvfb: AppImage extract-and-run, fresh profile and stored Ollama | first run FAIL (probe drain race, fixed); rerun PASS    |
| Installed DEB on FLOWBOX                                                                        | NOT VERIFIED locally (no sudo); runs in CI              |
| Fault injection (import removed) AppImage: new gate                                             | FAIL as expected: `frontend fatal: ReferenceError`      |
| Same fault-injected AppImage: old gate command (`APPIMAGE_EXTRACT_AND_RUN=1 timeout 20s`)       | exit 124, which the old script counted as PASS          |
| Native Wayland session                                                                          | NOT VERIFIED                                            |

The fresh-checkout extract-and-run failure was a defect in the new probe, not
in Juniper: it checked for leftover session processes immediately after the
main process exited, while WebKit helpers took about one second to exit. The
probe now allows a bounded 10-second drain and names any processes that
remain. Stopping extract-and-run with SIGTERM also left extraction directories
in `/tmp`, so the smoke now extracts into a private temporary directory.

The fresh checkout ran at the pre-review commit. The final commits differ only
in the diagnostic label (`graphics-overrides`), the error-page wording, the
probe drain fix, the extraction directory, and documentation.
