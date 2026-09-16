# Juniper application icons

These assets are generated from the official Juniper artwork at the repository
boundary (`public/juniper-logo.png`). The same source artwork is used for the
web favicon, desktop bundle icons, Windows ICO, macOS ICNS, and Android/iOS
launcher derivatives. `branding.sha256` pins every file.

Regenerate all platform derivatives with:

```bash
pnpm tauri icon public/juniper-logo.png -o src-tauri/icons
```

Then restore Juniper black in `android/values/ic_launcher_background.xml`
(`tauri icon` writes `#fff`) and update `branding.sha256`. For the pinned Tauri
CLI (2.11.4) every Android PNG and the adaptive-icon XML in this directory are
byte-identical to that command's output.

## How icons reach shipped artifacts

- **Desktop:** `tauri.conf.json` bundles `icon.png`, `icon.ico`, and
  `icon.icns` directly. `scripts/verify-desktop-branding.mjs` compares the
  DEB and AppImage icons with these files pixel by pixel.
- **Android:** `pnpm tauri android init` always writes Tauri's default launcher
  icons into `src-tauri/gen/android`, and nothing there reads `android/` from
  this directory. After every init, and before building, run:

  ```bash
  pnpm android:branding
  ```

  This copies the checksum-verified `android/` set into the generated project
  and runs `scripts/verify-android-branding.mjs project`. The release and
  validation workflows run the same steps and then
  `verify-android-branding.mjs apk` on the built APK. `pnpm branding:verify`
  fails if a workflow that builds the APK skips or reorders them.
