# ADR 0021: Chat-first interface and appearance tokens

Status: Accepted for the 0.3.0-rc.33 release candidate

## Context

Through `0.3.0-rc.32` Juniper exposed seven equally weighted surfaces — Chats,
Assistants, Models, Tools, Settings, Privacy center, and Diagnostics — as five
sidebar tabs plus two footer links, and as a five-tab bottom bar on phones. The
conversation header held a full model `<select>` and Export, Rename, and Delete
buttons side by side. Every assistant reply carried a bordered card, a raw model
identifier, and a permanent Copy button, and "Regenerate last" sat beside the
composer. Configuration competed with conversation on every screen.

The rc.32 audit also found defects in that shell:

- the chat list drew the globally active assistant's avatar for every chat;
- the composer's accessible name was always "Message Juniper";
- a chat created with one assistant routed through a different assistant's
  default model once the active assistant changed;
- the `density` setting was stored but had no effect on rendering;
- the stylesheet requested Inter, which was never shipped, and used Georgia
  for most headings;
- stored settings were spread into state without validation, so any value
  (including arbitrary CSS text in `accent`) reached the document;
- phones were shown "Shift + Enter for a new line";
- onboarding claimed setup could be revisited from Settings, which was false,
  and reported "Ollama not detected" in native builds because it probed the
  `juniper-local` provider with the Ollama health check;
- Android's edge-to-edge window placed content under the status bar,
  navigation bar, and keyboard.

## Reference products

We reviewed first-party material for ChatGPT, Claude, and the Ollama desktop
app in September 2026, and extracted principles rather than layouts or assets:

- **Conversation is the default surface.** All three open to a composer, keep
  history in a sidebar or drawer, and treat settings as a separate place.
- **Model choice is contextual.** The model is a compact control near the
  conversation, not a form field; Ollama's app lists installed models from the
  current model's name.
- **Appearance is a small, meaningful set.** OpenAI's help centre describes
  System, Light, and Dark appearance with contrast and accent colour options;
  Claude's help centre describes Light, Match System, and Dark colour modes and
  a chat font choice of Default, Match System, or Dyslexic Friendly.
- **Advanced controls are present but nested.** Ollama keeps context length
  and network exposure in Settings instead of the chat screen.

Juniper uses none of those products' artwork, icons, typefaces, colour values,
or exact layouts. Icons are Juniper's own stroke set; fonts are open-source
files bundled with the app.

## Decision

### Information architecture

Conversation first, configuration second, diagnostics last.

- **Primary destinations are Chats, Models, and Settings.** Desktop shows them
  in a collapsible sidebar under New chat, above searchable, date-grouped
  history. Phones show them as a three-item bottom bar; history lives in a
  drawer opened from the chat header.
- **Settings is a grouped control center**: General, Appearance, Accessibility;
  Assistants, Models & runtime, Connections; Tools & permissions, Memory,
  Privacy & data; Advanced (with Diagnostics beneath it) and About. Desktop uses
  a section list beside the content; phones drill down with a back control.
- **Models stays primary.** Model management is a Juniper differentiator, so it
  keeps its own destination. Cards lead with name, purpose, size, fit, and one
  action; warnings that decide whether a model can run stay visible; source,
  hashes, quantization, engines, and qualification sit behind Details. Provider
  endpoints, GGUF import, and Ollama pulls move to Settings.
- **The conversation header** shows the assistant and title, a model pill that
  opens a focused picker listing each model's execution location, and an
  overflow menu for Rename, Chat details, Export, the developer-only Context
  inspector, and a separated, confirmation-protected Delete.
- **Replies** are unboxed; user messages keep a subtle bubble. Reasoning, tool
  activity with host results, and model and usage details are disclosures.
  Copy, Regenerate (latest reply only), and Details appear on hover, focus, or
  permanently on touch devices, and are always in the tab order.
- **In-app dialogs** replace `window.alert`, `confirm`, and `prompt`. Dialogs,
  sheets, the history drawer, and menus trap or restore focus, close on Escape,
  and each pushes a history entry so Android's back gesture closes them before
  it leaves a screen.

Location labels (ON DEVICE, LOCAL NETWORK, REMOTE, UNKNOWN) are unchanged in
meaning (ADR 0014). They move from the always-visible header into the model
picker, the model pill's accessible name, chat details, Models, Connections,
and Privacy & data, where they are read at the moment a route is chosen.

### Appearance is typed settings plus design tokens

User customisation is a closed set of validated `AppSettings` fields. No
setting accepts CSS, HTML, JavaScript, URLs, or font files.

`src/lib/settings.ts` owns defaults, the allowed values for every enumerated
field, and `normalizeSettings`, which validates stored settings field by field:
a malformed or unknown value falls back to that field's default without
discarding the others. Accent colours must be `#RGB` or `#RRGGBB`.

`src/lib/appearance.ts` derives every colour and layout token from those
settings and writes them to `:root`. Components use only semantic tokens
(`--surface`, `--ink`, `--muted`, `--accent`, `--on-accent`, `--accent-ink`,
`--focus`, `--space-*`, `--conversation-width`, `--chat-font-size`, …).

Contrast is computed, not assumed:

- `--on-accent` is black or white, whichever contrasts more with the accent;
  the better of the two is always at least 4.58:1.
- The raw accent is only ever a fill. Text, icons, links, and focus rings use
  `--accent-ink`, the accent moved toward black or white until it reaches
  4.5:1 (7:1 in high contrast) against every surface.
- Muted, faint, danger, warning, and success text are corrected the same way.

A test sweeps the palette and 216 generated colours across light, dark, and
high contrast, and a negative control shows the raw accent would fail.

Density scales `--space-*` and control height; touch devices keep 44 px targets
regardless. Interface size scales the root font size. Motion follows the
system unless the user chooses Reduce or Allow. Theme and contrast can follow
the system.

### Fonts

Inter (the default), Atkinson Hyperlegible Next, and OpenDyslexic are bundled
through locked `@fontsource` packages and served from the application origin;
the CSP already forbids remote fonts. The System option uses the platform UI
font. All three bundled fonts are SIL Open Font License 1.1.

### Android insets

Tauri's Android activity enables edge-to-edge drawing, and older Android System
WebView builds report `env(safe-area-inset-*)` as zero and do not resize for
the keyboard. The `juniper-local` Android plugin listens for window insets on
the WebView and reports status bar, navigation bar, cutout, and keyboard insets
in CSS pixels, both as a `juniper-window-insets` DOM event and through the
`window_insets` command. CSS uses the larger of those values and the WebView's
own safe-area values. Only numbers cross into the page. Desktop returns none.

## Consequences

- Every rc.32 capability keeps a documented path; see
  [`docs/product/interface.md`](../product/interface.md). No capability was
  removed to simplify the interface.
- rc.32 settings migrate automatically (`reducedMotion: true` becomes
  `motion: reduced`); a downgrade to rc.32 ignores the new fields.
- Chats now open on a fresh composer; a new chat is saved when its first
  message is sent rather than when New chat is pressed.
- On touch-first devices Enter inserts a newline and the send button sends; on
  devices with a precise pointer Enter sends and Shift+Enter adds a newline.
- The primary-navigation and appearance behaviour is covered by frontend tests
  with negative controls; rendered evidence comes from browser, desktop, and
  Android emulator screenshots rather than compilation alone.
