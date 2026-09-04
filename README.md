# Juniper

Juniper is a local-first AI desktop and Android app for people who want a thoughtful assistant, visible model controls, and a clear boundary around private data. It works with compatible text-generation models through supported runtimes; no model family is required and no model is bundled.

**Version `0.3.0-rc.8` — standalone-runtime release candidate.** The release workflow builds and packages the Juniper-owned local runtime for desktop targets, then publishes install-smoked artifacts after the verification gates pass. See [Download](#download).

## Download

Installers will be published on the [GitHub releases page](https://github.com/Cinqic/Juniper-App/releases/tag/v0.3.0-rc.8) after the release workflow completes. You do not need Git, a build toolchain, or a GitHub account to use a published desktop artifact.

| Platform          | File                                       | Notes                                                             |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| Windows 10/11 x64 | `Juniper-0.3.0-rc.8-windows-x86_64.msi`    | The bundled local runtime is Juniper-owned; SmartScreen may warn. |
| Linux x86_64      | `Juniper-0.3.0-rc.8-linux-x86_64.AppImage` | `chmod +x`, then run. No installation required.                   |
| Linux x86_64      | `Juniper-0.3.0-rc.8-linux-x86_64.deb`      | `sudo apt install ./Juniper-...deb`                               |
| Android 7.0+      | `Juniper-0.3.0-rc.8-android-universal.apk` | Signed release APK; enable install from unknown sources.          |

Verify a download against `SHA256SUMS.txt` from the same release:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
```

`SIGNING-android.txt` records the APK signing certificate and `SIGNING-windows.txt` records the MSI Authenticode status. Every executable artifact also carries a [GitHub artifact attestation](https://github.com/Cinqic/Juniper-App/attestations) linking it to the workflow run and commit that produced it.

Juniper’s desktop bundle owns its loopback `llama-server` process, so ordinary local use does not require Ollama, a daemon, or an account. On first run, open Models Market, review the device-aware recommendations, and download a verified model. Model weights are separate user-owned files and are never bundled in the installer.

## What Juniper does

- A chat workspace with onboarding, streaming, markdown, export, private chats, and mobile layouts.
- Assistant profiles with personality controls, model selection, tool policy, memory policy, import, and export.
- A first-class Juniper local provider with device detection, model recommendations, verified resumable downloads, atomic installation, pause/resume, and removal.
- A curated catalog of four instruction-tuned GGUF models below 1B parameters, with source revision, license, size, and SHA-256 shown before download.
- Optional Ollama, OpenAI-compatible, and llama.cpp-compatible provider connections for advanced users and existing setups.
- A deterministic context builder that keeps the system prompt, curated memories, enabled tool definitions, and recent conversation within a context budget.
- A host-authored tool boundary with bounded calculator, unit conversion, datetime, attachment, memory, search, and system-info contracts. A tool the request did not enable is denied, never executed.
- Native SQLite persistence with migrations, OS-keychain credential storage on desktop, scoped text attachments, diagnostics, and privacy settings.

## What Juniper does not do

These are deliberate exclusions in this release, not oversights:

- **No Ollama dependency.** Ollama remains an optional external provider and legacy import path; it is not probed or used as a fallback by the Juniper local provider.
- **Desktop runtime provenance.** The release workflow builds the pinned `llama.cpp` server from source and places it in the Tauri resource slot. A source checkout needs CMake and uses `scripts/build-llama-runtime.sh` before a local bundle can run the native provider.
- **No MCP client.** The Settings entry is present and explicitly disabled.
- **No secure credential storage on Android.** Juniper refuses to store a provider API key there rather than falling back to insecure storage. Use a provider that needs no key, or use the desktop app.
- **Android local inference packaging is still pending in this candidate.** Android can inspect the catalog and manage app state, but this release does not claim a packaged native local inference process on Android yet.
- **No iOS or macOS build.**
- **No telemetry, analytics, crash reporting, or account.**

## Privacy and security

- Telemetry is off and there is no analytics or crash-reporting code. No hardcoded external host appears anywhere in the sources; every outbound request is built from the provider base URL you configure.
- Juniper labels every route as ON DEVICE, LOCAL NETWORK, REMOTE, or UNKNOWN, and never treats UNKNOWN as safe.
- Desktop provider credentials are stored in the OS keychain and referenced only by an opaque identifier. Secrets are never written to the SQLite state and are stripped from exports.
- Private chats are held in memory only; they are excluded from persistence and from user exports.
- Attachments are opened through a scoped native picker with symlink rejection, an extension allowlist, and a 1 MiB cap enforced at both grant time and read time. Attachment content is labelled untrusted to the model.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [docs/privacy/network-policy.md](docs/privacy/network-policy.md).

## Build from source

Install Node.js 22+, pnpm 11, Rust 1.90+, CMake, Git, and the platform prerequisites in the [Tauri prerequisite guide](https://tauri.app/start/prerequisites/).

```bash
pnpm install --frozen-lockfile
pnpm validate      # canonical check: format, lint, types, tests, clippy, schemas, version
scripts/build-llama-runtime.sh
pnpm tauri dev     # run the desktop app
pnpm tauri build   # produce a native bundle
```

`pnpm dev` runs a browser-only UI preview. It cannot reach a provider and uses a clearly-marked deterministic fake responder; it is a development aid, not a way to use Juniper.

Individual checks: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm schema:validate`.

Repository layout:

```text
src/           React UI, state, context, storage, browser preview
src-tauri/     Tauri commands, providers, SQLite, keychain, tools
config/        checked-in defaults and reference provider/tool data
schemas/       versioned assistant, provider, tool, and export schemas
scripts/       version, schema, and platform bundle verification
tests/         model qualification suites and fixtures
docs/          architecture, ADRs, privacy, security, release, phase history
```

## Testing and qualification

`pnpm validate` runs the frontend and native test suites, static checks, schema validation, and version checks. See [docs/testing/strategy.md](docs/testing/strategy.md).

The historical provider qualification can still run against a locally installed Ollama model:

```bash
JUNIPER_LIVE_OLLAMA_MODEL=qwen3:0.6b \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture
```

Suites whose capability gate the model does not meet are reported NOT-APPLICABLE, never as passes. That evidence covers the optional Ollama adapter; the standalone runtime is qualified separately by release artifact smoke and a model download/inference run.

## Known limitations

- The Windows MSI may be unsigned, so Windows SmartScreen can show an unrecognized-publisher warning.
- `0.3.0-rc.8` is a prerelease. It is published for evaluation and is not yet promoted to a final `0.3.0`.
- Android loopback addresses refer to the phone itself. Reaching a computer on your network needs an explicit LAN endpoint.
- Browser-preview attachments are development-only; the real attachment path is the desktop native picker.

## Contributing and history

See [CONTRIBUTING.md](CONTRIBUTING.md). Architecture and decisions are in [docs/architecture/](docs/architecture/) and [docs/adr/](docs/adr/). Release records are in [docs/release/](docs/release/). The `docs/phases/` directory holds dated point-in-time development reports; treat this README and [docs/release/](docs/release/) as authoritative where they differ.

## License

Juniper is released under the MIT License. See [LICENSE](LICENSE).
