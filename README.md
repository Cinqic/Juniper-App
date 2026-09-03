# Juniper

Juniper is a local-first AI desktop and Android app for people who want a thoughtful assistant, visible model controls, and a clear boundary around private data. It works with compatible text-generation models through supported runtimes; no model family is required and no model is bundled.

**Version `0.2.0-rc.1` — release candidate (prerelease).** Windows, Linux, and Android artifacts are built, install-smoked, and published. See [Download](#download).

## Download

Installers are published on the [GitHub releases page](https://github.com/Cinqic/Juniper-App/releases/tag/v0.2.0-rc.1). You do not need Git, a build toolchain, or a GitHub account.

| Platform          | File                                       | Notes                                                    |
| ----------------- | ------------------------------------------ | -------------------------------------------------------- |
| Windows 10/11 x64 | `Juniper-0.2.0-rc.1-windows-x86_64.msi`    | Not Authenticode-signed; SmartScreen will warn.          |
| Linux x86_64      | `Juniper-0.2.0-rc.1-linux-x86_64.AppImage` | `chmod +x`, then run. No installation required.          |
| Linux x86_64      | `Juniper-0.2.0-rc.1-linux-x86_64.deb`      | `sudo apt install ./Juniper-...deb`                      |
| Android 7.0+      | `Juniper-0.2.0-rc.1-android-universal.apk` | Signed release APK; enable install from unknown sources. |

Verify a download against `SHA256SUMS.txt` from the same release:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
```

`SIGNING-android.txt` records the APK signing certificate and `SIGNING-windows.txt` records the MSI Authenticode status. Every executable artifact also carries a [GitHub artifact attestation](https://github.com/Cinqic/Juniper-App/attestations) linking it to the workflow run and commit that produced it.

**You also need a model runtime.** Juniper ships no model and no inference engine. Install [Ollama](https://ollama.com/download) (simplest), or point Juniper at any OpenAI-compatible or llama.cpp-compatible endpoint. On first run, open Models, choose Download a model, and enter any Ollama model reference.

## What Juniper does

- A chat workspace with onboarding, streaming, markdown, export, private chats, and mobile layouts.
- Assistant profiles with personality controls, model selection, tool policy, memory policy, import, and export.
- Provider and model management for Ollama plus OpenAI-compatible and llama.cpp-compatible endpoints. Ollama discovery, inspection, pull progress, cancellation, and deletion use its native API.
- A deterministic context builder that keeps the system prompt, curated memories, enabled tool definitions, and recent conversation within a context budget.
- A host-authored tool boundary with bounded calculator, unit conversion, datetime, attachment, memory, search, and system-info contracts. A tool the request did not enable is denied, never executed.
- Native SQLite persistence with migrations, OS-keychain credential storage on desktop, scoped text attachments, diagnostics, and privacy settings.

## What Juniper does not do

These are deliberate exclusions in this release, not oversights:

- **No native GGUF inference.** Juniper has no built-in inference engine. A GGUF file you select is imported into Ollama, which runs it.
- **No managed llama.cpp process.** Juniper talks to a llama.cpp server you already run; it does not start, supervise, or stop one.
- **No MCP client.** The Settings entry is present and explicitly disabled.
- **No secure credential storage on Android.** Juniper refuses to store a provider API key there rather than falling back to insecure storage. Use a provider that needs no key, or use the desktop app.
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

Install Node.js 22+, pnpm 11, Rust 1.90+, and the platform prerequisites in the [Tauri prerequisite guide](https://tauri.app/start/prerequisites/).

```bash
pnpm install --frozen-lockfile
pnpm validate      # canonical check: format, lint, types, tests, clippy, schemas, version
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

`pnpm validate` runs 38 frontend tests and 54 native tests. See [docs/testing/strategy.md](docs/testing/strategy.md).

Real-model qualification runs against a locally installed Ollama model rather than a fixture:

```bash
JUNIPER_LIVE_OLLAMA_MODEL=qwen3:0.6b \
  cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture
```

Suites whose capability gate the model does not meet are reported NOT-APPLICABLE, never as passes. Recorded results are in [docs/qualification/ollama-real-model-evidence.md](docs/qualification/ollama-real-model-evidence.md).

## Known limitations

- The Windows MSI is not Authenticode-signed, so Windows SmartScreen shows an unrecognized-publisher warning.
- `0.2.0-rc.1` is a prerelease. It is published for evaluation and is not yet promoted to a final `0.2.0`.
- Android loopback addresses refer to the phone itself. Reaching a computer on your network needs an explicit LAN endpoint.
- Browser-preview attachments are development-only; the real attachment path is the desktop native picker.

## Contributing and history

See [CONTRIBUTING.md](CONTRIBUTING.md). Architecture and decisions are in [docs/architecture/](docs/architecture/) and [docs/adr/](docs/adr/). Release records are in [docs/release/](docs/release/). The `docs/phases/` directory holds dated point-in-time development reports; treat this README and [docs/release/](docs/release/) as authoritative where they differ.

## License

Juniper is released under the MIT License. See [LICENSE](LICENSE).
