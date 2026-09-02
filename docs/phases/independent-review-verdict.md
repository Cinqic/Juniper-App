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

See the [smollm:135m evidence log](../qualification/smollm-135m-evidence.md).
First real generation ever performed on this repository.

- `generic-chat`: **PASS** — normalized streaming, exactly one `done` event,
  no error, 74 characters of real output
- `generic-context`: **PASS** — current message appears exactly once
- `generic-tools`: **NOT APPLICABLE** — `smollm:135m` declares only `completion`
- `generic-thinking`: **NOT APPLICABLE** — same reason

Tools and thinking are deliberately **not** marked as passing.

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

## Blockers

1. **Android signing secrets are absent.** `gh secret list` returns empty. The
   Android job hard-fails by design without them. Because `publish` needs
   `verify` needs `android`, a tag push today would fail and publish **nothing** —
   safe, but it would leave a permanent tag and a failed run. Generating the
   release keystore is an owner decision: the signing identity permanently
   determines who can ship Android updates for `com.cinqic.juniper`.

2. **A true pre-tag dry run is not possible as designed.** `workflow_dispatch`
   requires an already-existing tag, and `check-version.mjs` requires it to be
   exactly `v0.2.0-rc.1` — but any `v*` tag push sets `publish=true`
   automatically. Rehearsal is therefore limited to the local build reproduced
   above plus the passing `validation.yml`.

3. **Windows MSI is unproven locally** — it requires a Windows runner. Its
   verification script exists but has never executed.

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

- Tool-call and thinking round-trips: fixture-verified only, never real-model
- Android: never built, never signed, never installed
- Windows MSI: never built or install-smoked
- Mobile secure credential storage: deliberately unimplemented; refuses rather
  than degrading
- `smollm:135m` output quality is poor; irrelevant to the contract under test

## Conditions for promoting to `0.2.0`

1. Owner provides the four Android signing secrets and a release keystore
   (see the [Android signing runbook](../release/android-signing-runbook.md))
2. `release.yml` completes green on all three platforms
3. Tool and thinking suites qualified against a tools-capable model
4. Artifacts published with `SHA256SUMS`, then the website updated to point at
   them — in that order, never ahead of evidence
