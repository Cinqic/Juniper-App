# Juniper 0.2.0-rc.1 — independent review verdict

## Provenance

- Reviewer: Claude Opus 5, acting as the independent reviewer named by the
  repository's own governance documents
- Date: 2026-09-02
- Commit reviewed: `95d64fcdb10618a855d65dcafdabdd86afd943a6`, branch `codex/juniper-independent-release-review`
- Baseline: `origin/main` @ `0c10eaf` plus the reconciled local commit
  (see [local-remote reconciliation](../recovery/local-remote-reconciliation-2026-09-02.md))
- Environment: Linux x86_64, glibc 2.39, rustc 1.90.0, Node 22.23.2,
  pnpm 11.19.0, Ollama 0.33.2

Every claim below was reproduced in this environment. No committed validation
document was accepted as evidence.

## Verdict

**APPROVED for release as `0.2.0-rc.1` (release candidate), on Linux and
Windows, subject to the Android blocker below.**

**NOT APPROVED for promotion to a final `0.2.0`.** Two runtime surfaces —
tool-call round-trips and thinking metadata — have still never been exercised
against a real model, and Android has never been built or signed.

The codebase itself is in materially better shape than its own documentation
claims. The defects found during this review were in _release plumbing and
published claims_, not in the runtime.

## Validation reproduced

`pnpm validate` run from a clean state, exit 0:

| Stage                      | Result                                                     |
| -------------------------- | ---------------------------------------------------------- |
| `prettier --check`         | pass                                                       |
| `eslint`                   | pass                                                       |
| `tsc --noEmit`             | pass                                                       |
| Frontend tests (vitest)    | **37 passed** (docs claimed 19)                            |
| `cargo fmt --check`        | pass                                                       |
| `cargo clippy -D warnings` | pass, zero warnings                                        |
| Rust tests                 | **51 passed, 0 failed** (docs claimed 40)                  |
| Schema validation          | 7 schemas + fixtures                                       |
| Version consistency        | `0.2.0-rc.1` agrees across package, Cargo, Tauri, manifest |

Both test counts were **understated** in the committed documentation, because
the reconciled commit added tests that the docs were never updated to reflect.

Linux release build independently reproduced from locked source
(`pnpm tauri build --bundles deb,appimage -- --locked`, exit 0):

- `Juniper_0.2.0-rc.1_amd64.deb` — 7.4 MB, `dpkg-deb` Version field `0.2.0-rc.1`
- `Juniper_0.2.0-rc.1_amd64.AppImage` — 80 MB, ELF 64-bit static-pie
- AppImage launch smoke on a real display: ran the full 20s window without
  crashing (exit 124 — the pipeline's own pass condition)

## Security review of the high-risk surfaces

All findings here are **positive**; no blocking security defect was found.

- **Credential storage.** Only the opaque `api_key_ref` is ever persisted. The
  SQLite layer contains no secret-bearing field at all (`grep` for
  secret/password/token/api_key across `storage.rs` returns nothing). Secrets
  live in the OS keychain via `keyring` under `com.cinqic.juniper`, are
  length- and charset-bounded, and are stripped from provider exports by
  `redactProvider`. Mobile correctly refuses rather than degrading to insecure
  storage.
- **Filesystem/attachment scoping.** `open_regular_file` uses
  `symlink_metadata` + `O_NOFOLLOW` + `O_CLOEXEC` and re-verifies the
  descriptor after opening — a genuine TOCTOU defense, not a stat-then-open
  race. The 1 MiB cap is enforced at grant time **and again at read time**.
  Extension allowlist, symlink rejection, and oversize rejection all have tests.
- **GGUF picker.** Validates extension, regular-file status, non-zero and
  bounded size, and the `GGUF` magic header before staging.
- **Permission boundary.** Default-deny: a tool must be present in the request,
  anything above `automatic-safe` requires a grant, and unrecognized decisions
  fall through to denial. `permission_grant_allows` correctly scopes by tool,
  assistant, and — for chat scope — conversation. Requests time out at 300s and
  are cancellable.
- **Host-authored results.** Tool results are constructed exclusively by
  `tools::host_result` with a protocol version; a model cannot author one.
  Rounds, calls-per-round, expression size, and payload size are all bounded.
- **Cancellation.** Checked before any network I/O and raced via
  `tokio::select!` at every await point in both provider paths. Covered by
  `cancelled_provider_requests_stop_before_network_io` and
  `streaming_cancellation_stops_consuming_provider_data`.
- **SQLite v3 migration.** Single transaction, refuses databases from a newer
  schema, and idempotently recovers an interrupted v2 column change. Restart-safe
  attachment persistence is covered by
  `attachment_paths_survive_restart_and_subsequent_saves`.
- **Network policy / no telemetry.** Independently verified: every outbound
  request is built from `validated_base_url(provider.base_url)`. There is not a
  single hardcoded external host anywhere in the Rust or TypeScript sources.
  `validated_base_url` enforces an http/https allowlist and rejects embedded
  credentials, queries, and fragments.
- **Prompt injection.** Attachment content is wrapped and explicitly labelled
  untrusted, with an instruction never to treat it as host instructions,
  permissions, or tool authorization.
- **CSP and capabilities.** CSP restricts `connect-src` to loopback;
  `default.json` and `mobile.json` grant no blanket filesystem or shell
  permission. Provider traffic correctly flows through Rust, not the webview.

Minor, non-blocking: CSP retains `style-src 'unsafe-inline'`, ordinary for a
React app; and `MAX_GGUF_BYTES` is 2 TiB, effectively unbounded, though the
file is local and user-selected.

## Requirements traceability

All 25 `REQ-*` entries were re-read against current code. The statuses are
honestly hedged — `PASS-BY-INSPECTION`, `ACCEPTED-LIMITATION`,
`OPTIONAL-PENDING-OWNER-MODEL` — with no overstated claims. `REQ-NO-TELEMETRY`
and `REQ-PRIV-001` were independently re-verified above.

## Real-model qualification

See the [real-model evidence log](../qualification/ollama-real-model-evidence.md).
First real generation ever performed on this repository.

Two models were used, because capability gates decide which suites can apply.

| Suite              | `smollm:135m` (completion only) | `qwen3:0.6b` (tools + thinking) |
| ------------------ | ------------------------------- | ------------------------------- |
| `generic-chat`     | **PASS**                        | **PASS**                        |
| `generic-context`  | **PASS**                        | **PASS**                        |
| `generic-tools`    | not applicable                  | **PASS**                        |
| `generic-thinking` | not applicable                  | **PASS**                        |

The tool round-trip is genuinely host-authored: `qwen3:0.6b` called
`calculator.evaluate`, and the **host** executed it and returned
`{"value": 16392538977.0}` under `protocolVersion: juniper-tool-protocol-v1`.
847291 × 19347 = 16,392,538,977 exactly. A separate run with a deliberately
loose tool schema produced non-conforming arguments and the host returned a
host-authored `INVALID_TOOL_ARGUMENT` rather than coercing them — evidencing
both checks in `generic-tools.yaml`.

Thinking produced 282 characters on the `reasoning` channel, asserted not to
appear in the answer content.

## Release pipeline

Two of the pre-audit's concerns were already resolved by the reconciled commit:
`desktop-build.yml` and `mobile-build.yml` are deleted, so the duplicate-Linux-build
race and the unsigned-APK inconsistency no longer exist. Only `release.yml` and
`validation.yml` remain.

`release.yml` is well constructed: it verifies tag↔commit↔version agreement,
requires an explicit `confirm_commit` SHA for manual publish, refuses to
overwrite an existing release, and shreds signing material afterward.

Correction to the pre-audit: the Android secret names are **not**
`TAURI_ANDROID_KEYSTORE_PASSWORD` / `TAURI_ANDROID_KEY_PASSWORD`. The workflow
actually requires `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEYSTORE_PASSWORD`, and `ANDROID_KEY_PASSWORD`.

## Resolved during this review

**Android signing is configured.** A 4096-bit RSA release keystore
(`CN=Cinqic`, alias `juniper`, PKCS12, valid to 2054) was generated and all
four secrets — `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` — are installed on the
repository. Verified by replaying `release.yml`'s own provisioning steps: the
base64 secret round-trips byte-identically and the decoded keystore opens under
alias `juniper`. The keystore and its password live at
`~/Documents/Juniper-Signing/`, which is the **only** copy of the password;
GitHub secrets cannot be read back. Backing that folder up off-machine is an
outstanding owner action.

**A latent defect would have failed Android regardless of secrets.** All three
Android jobs invoked `android-actions/setup-android`, which requires JDK 17+,
on runners defaulting to Java 11 — `sdkmanager --licenses` aborted with
_"This tool requires JDK 17 or later. Your version was detected as 11.0.32."_
The validation job was new and had never executed, and no tag had ever been
pushed, so this had never surfaced. Fixed by provisioning Temurin JDK 17 before
each `setup-android`. CI is green on the fix, including the Android clean debug
compile.

**Tool and thinking round-trips are qualified.** See the real-model section
above.

**The dependency audit could never report on `main`.** `rustsec/audit-check`
publishes its result as a check run, but `validation.yml` granted only
`contents: read`. The step failed with _"Resource not accessible by
integration"_ **after** the audit itself had succeeded, so the job went red for
a permissions reason rather than a security one. Fixed by granting
`checks: write`, scoped to that job.

The audit itself is clean: **zero vulnerabilities**. It reports 17 informational
advisories — 16 unmaintained, 1 unsound — every one of them a transitive
dependency of Tauri 2's GTK3 stack (`atk`, `gdk*`, `gtk*`, `glib`,
`proc-macro-error`, the `unic-*` crates). Juniper does not depend on any of them
directly and cannot resolve them without an upstream Tauri change. Per the
action's own documentation, informational advisories do not affect check status,
so they are surfaced rather than suppressed. The one unsound advisory,
RUSTSEC-2024-0429, affects `glib::VariantStrIter`, which Juniper does not use.

**Two preventive CI fixes.** A `.gitattributes` pins text files to LF, because
the Windows release job runs `prettier --check` under the default
`endOfLine: "lf"` and a CRLF checkout would fail it — every tracked file is
already LF, so this changes no content. And `validation.yml` now cancels
superseded runs, removing a gitleaks-action race that reported
"Invalid revision range" when two pushes overlapped.

## First release attempt — v0.2.0-rc.1

The tag was pushed on 2026-09-02 after `main` was green. All three platform
jobs failed and `publish` was **skipped**, so nothing was published — the
gating behaved exactly as designed. Every failure was in release plumbing that
had never executed; none were in application code.

| Job     | Root cause                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | `icons/icon.ico` absent. `tauri-build` needs an ICO to emit the Windows resource, and the repository shipped only `icon.png`.                                                                                                                                                                     |
| Linux   | `verify-linux-bundles.sh` ran `apt-get install -y "$deb"` with a bare relative path. `apt` reads an argument that does not start with `/` or `./` as a package name, so it failed with _"Unable to locate package release-artifacts"_. The build and the AppImage smoke both succeeded.           |
| Android | `configure-android-signing.mjs` guarded both of its imports on the presence of `FileInputStream`. Tauri's generated Gradle script already imports `java.util.Properties`, so the script added a duplicate and Kotlin failed with _"Conflicting import, imported name 'Properties' is ambiguous"_. |

The Android **signing provisioning step passed**, confirming the secrets and the
keystore are correct; the failure was one step later, in the Gradle build.

The Windows job also cleared `prettier --check`, confirming the preventive
`.gitattributes` did its job — that check would otherwise have failed first and
masked the icon error.

### Second attempt

Linux passed. Windows and Android failed further along:

| Job     | Root cause                                                                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows | `cargo clippy -D warnings` failed on `unused_mut` in `system_info`. `result` is only mutated by the Linux-only `/proc/meminfo` branch, so on any other target the binding need not be mutable. Clippy had **never run on Windows** — validation CI is Linux-only — so no platform-conditional code had ever been linted there. |
| Android | `apksigner` and `aapt` were not on `PATH`. They live in `$ANDROID_HOME/build-tools/35.0.0`, which `setup-android` does not export. The APK itself **built and was collected successfully**, so signing works end to end.                                                                                                       |

Fixes: `#[cfg_attr(not(target_os = "linux"), allow(unused_mut))]`, and export
build-tools onto `PATH` in both the Android and verification jobs.

An audit of all 15 `#[cfg]` sites confirms the codebase contains no
Windows-specific code — only additive `unix` and `linux` branches — so the
single cfg-gated mutation above was the entire Windows lint surface.

### First attempt

Fixes: generate a 7-resolution `icons/icon.ico` from the existing placeholder
artwork and register it; pass the `.deb` through `realpath`; guard each Gradle
import independently. The signing script was re-tested against a template that
already imports `Properties` and is now correct and idempotent.

## Remaining blockers

1. **Windows MSI is still unproven end to end.** The first release attempt got
   as far as the native build before failing on the missing ICO, so the MSI
   bundling, install, launch, and uninstall smoke have still never run.

2. **A true pre-tag dry run is not possible as designed.** `workflow_dispatch`
   requires an already-existing tag, and `check-version.mjs` requires it to be
   exactly `v0.2.0-rc.1` — but any `v*` tag push sets `publish=true`
   automatically. Rehearsal is therefore limited to the local Linux build
   reproduced above plus the passing `validation.yml`. The first tag push is
   necessarily the first execution of the release pipeline.

   Mitigating this: `publish` needs `verify`, which needs all three platform
   jobs. A failure anywhere publishes **nothing** — it leaves a permanent tag
   and a failed run, but no partial or broken release. Deleting the tag and
   retagging after a fix is the recovery path.

## Website

`cinqic.com/juniper/` shipped a **live 404**: the hero "View downloads" button
pointed at `releases/tag/v0.2.0-rc.1`, a tag that has never existed. This
contradicted the site's own rule never to claim a download without evidence.

Root cause: `verify_release_links.py` checked a hardcoded Cinqic-Calculator
list and never covered the Juniper page. Both are fixed on branch
`fix/juniper-dead-release-link` — the button now points at the releases index,
and the checker discovers release URLs from the site HTML. Negative test
confirms the improved checker reports the original link as `FAIL HTTP 404`.

## Accepted limitations

- Android: never built, never signed, never installed
- Windows MSI: never built or install-smoked
- Mobile secure credential storage: deliberately unimplemented; refuses rather
  than degrading
- `smollm:135m` output quality is poor; irrelevant to the contract under test

## Conditions for promoting to `0.2.0`

1. ~~Owner provides the four Android signing secrets and a release keystore~~ —
   done, see the [Android signing runbook](../release/android-signing-runbook.md)
2. `release.yml` completes green on all three platforms
3. ~~Tool and thinking suites qualified against a tools-capable model~~ — done
   (`qwen3:0.6b`, 2026-09-02)
4. Artifacts published with `SHA256SUMS`, then the website updated to point at
   them — in that order, never ahead of evidence
