# 0.3.0-rc.33 interface evidence

Evidence recorded while implementing the chat-first interface
([ADR 0021](../adr/0021-chat-first-interface-and-appearance-tokens.md)). It
covers what was executed, what passed, and what remains unverified. Screenshots
are in [`rc33-interface/`](rc33-interface/) and name the commit they came from.

## Baseline

| Item                     | Value                                                                 |
| ------------------------ | --------------------------------------------------------------------- |
| Starting commit          | `aa59eb2` on `main` (`0.3.0-rc.32`), clean worktree                   |
| Baseline validation      | `pnpm install --frozen-lockfile && pnpm build && pnpm validate` PASS  |
| Baseline test counts     | 63 frontend tests, 74 native tests (2 `#[ignore]`d live-Ollama tests) |
| Latest published release | `v0.3.0-rc.32`, 2026-09-17                                            |
| Open pull requests       | none                                                                  |
| Cinqic.com advertised    | `0.3.0-rc.32`                                                         |

## Validation

Run at `25305fd` from the committed tree:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm validate   # format, lint, typecheck, vitest, cargo fmt/clippy/test, schemas, version, license, runtime, branding
```

PASS: 112 frontend tests, 74 native tests (2 ignored), version consistency
`0.3.0-rc.33`, license, runtime contract (5 pins), branding integrity.

## Tests added for this work

`src/app/App.test.tsx` covers the three primary destinations, reachability of
every rc.32 surface, per-chat assistant avatars and composer names, routing
through the chat's own assistant model, model switching without rewriting
attribution, overflow actions, confirmed deletion, in-app rename, private-chat
export restrictions, progressive disclosure, touch versus keyboard composer
behaviour, sidebar preference, default assistant, per-assistant tool policy,
appearance settings changing the rendered document, accent rejection, phone
Settings back navigation, a failed Ollama pull, and copy feedback.
`src/lib/settings.test.ts` and `src/lib/appearance.test.ts` cover migration from
the rc.32 fixture in `src/test/fixtures.ts` and WCAG ratios across 222 accents in
light, dark, standard, and high contrast. `src/app/history.test.ts`,
`src/lib/flex-gap-fallback.test.ts`, `src/test/webview-compat.test.ts`, and the
Android cases in `src/app/App.tauri.test.tsx` cover history, older-WebView
fallbacks, and native insets and back handling.

## Negative controls

Each defect was reintroduced, the suite run, then the change reverted.

| Reintroduced defect                               | Result             |
| ------------------------------------------------- | ------------------ |
| Chat list draws the default assistant's avatar    | FAILED as expected |
| Composer labelled "Message Juniper" always        | FAILED as expected |
| Settings enums accepted without validation        | FAILED as expected |
| Density token fixed at 1                          | FAILED as expected |
| Chat deletion without confirmation                | FAILED as expected |
| Accent used as text without contrast correction   | FAILED as expected |
| Chat routed through the default assistant's model | FAILED as expected |
| Private chats exportable                          | FAILED as expected |
| `reducedMotion` not migrated to `motion`          | FAILED as expected |
| Silent history pops issued one back() at a time   | FAILED as expected |
| Phone Settings back arrow replaces its entry      | FAILED as expected |
| Failed Ollama pull clears the typed name          | FAILED as expected |

One control did not fail: removing the chat-view remount when the open chat
disappears. Clearing chats happens in Settings, where the chat view is already
unmounted, so that remount is a defensive guard rather than a fix for a
reachable rc.33 defect.

## Android

Emulator `juniper-explore`, API 30, x86_64, Android System WebView
83.0.4103.120, debug APK built with `pnpm tauri android build --apk --debug
--target x86_64 -- --locked` from a clean `tauri android init --ci` plus
`install-android-branding.mjs` (`verify-android-branding.mjs project`: PASS).

| Check                                                                   | Result                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| First redesign build on WebView 83                                      | FAIL: `TypeError: pi.at is not a function`, startup error page       |
| Same build after the compatibility fixes (`fac3f34` onward)             | PASS: `[juniper-startup] frontend ready`, no `frontend fatal` lines  |
| Status bar, navigation bar, cutout insets                               | header below the 24 px status bar; bottom navigation reserves 48 px  |
| Soft keyboard (`25305fd`)                                               | inset 343 px reported, composer bottom 379 px, bottom nav hidden     |
| Keyboard dismissed with back                                            | inset 0, bottom navigation returns, chat still open                  |
| Real chat through host Ollama at `10.0.2.2:11434`                       | PASS, labelled LOCAL NETWORK                                         |
| Back: menu, sheet, drawer, Settings section, Settings list, then exit   | PASS in that order                                                   |
| App update over an existing install (`fac3f34` → `be9e10b` → `25305fd`) | chats, connection, and settings kept; onboarding did not reopen      |
| Landscape                                                               | 48 px navigation inset honoured on the right, no horizontal overflow |
| Long reply with a code block                                            | code scrolls inside its block; the page does not scroll sideways     |

Not verified: a physical ARM64 phone, and Android llama.cpp local inference
(the host Ollama connection was used instead). The Android runtime maturity
claim is unchanged: Beta.

## Linux desktop

AppImage built with `pnpm tauri build --bundles appimage -- --locked` from
`7c539d5`; X11 session on FLOWBOX; isolated XDG profile.

| Check                                         | Result                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `scripts/linux-launch-probe.sh`               | PASS: ready in 2 s, 1280x820, 103 distinct colours, clean SIGTERM exit |
| Real chat through Ollama on `127.0.0.1:11434` | PASS, labelled ON DEVICE                                               |
| Chat options menu keyboard behaviour          | opens on "Rename", Down and End move, Escape restores focus to trigger |
| Model picker dialog                           | Tab stays inside, Escape restores focus to the model pill              |
| Accessible names through AT-SPI               | "Model: qwen3:0.6b, ON DEVICE. Change model", "Regenerate response", … |
| Onboarding open                               | the rest of the interface is not exposed to AT-SPI                     |
| Light, dark, and high contrast                | rendered                                                               |
| `Ctrl+Shift+S`, `Ctrl+Shift+O`, `Ctrl+K`      | sidebar toggles, new chat focuses the composer, search focuses         |
| Sidebar Auto at 980x720                       | collapses to icons                                                     |
| Minimum window 360x640                        | phone layout with history drawer and bottom navigation                 |

Not verified: Windows (covered by the release workflow's MSI install, launch,
and uninstall smoke) and native Wayland sessions.

## Older Android System WebView

Juniper supports Android 7.0+, where the system WebView can be much older than
the app. The build now targets Chromium 83 and Safari 15, JavaScript built-ins
newer than that are rejected by `src/test/webview-compat.test.ts`, flex `gap`
is emulated from Juniper's own stylesheet when unsupported, and `:focus-visible`
falls back to `:focus`. Two pre-existing rc.32 defects were fixed on the way:
`findLastIndex` in the context builder (every send) and `replaceAll` in the
markdown renderer (every rendered message) would both throw on WebView 83.

## Screenshots

| File                              | Source commit |
| --------------------------------- | ------------- |
| `android-new-chat-light.png`      | `fac3f34`     |
| `android-conversation-light.png`  | `fac3f34`     |
| `android-models.png`              | `fac3f34`     |
| `android-settings.png`            | `fac3f34`     |
| `android-conversation-dark.png`   | `be9e10b`     |
| `android-model-picker-dark.png`   | `be9e10b`     |
| `android-history-drawer-dark.png` | `be9e10b`     |
| `android-customized-theme.png`    | `be9e10b`     |
| `android-landscape.png`           | `be9e10b`     |
| `android-keyboard-open.png`       | `25305fd`     |
| `desktop-*.png`                   | `7c539d5`     |

The screenshots are real captures of the running app (`adb exec-out screencap`
on the emulator, GDK window captures on Linux), downscaled and colour-reduced.
No concept art is used as implementation evidence.
