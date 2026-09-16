# Linux startup and troubleshooting

This page covers the Linux desktop builds: `Juniper-<version>-linux-x86_64.AppImage`
and `Juniper-<version>-linux-x86_64.deb`.

## What is tested

| Environment                                 | AppImage (FUSE)                    | AppImage extract-and-run | Installed DEB | Evidence                          |
| ------------------------------------------- | ---------------------------------- | ------------------------ | ------------- | --------------------------------- |
| Ubuntu 22.04, Xvfb X11 (build baseline, CI) | tested                             | tested                   | tested        | release and validation workflows  |
| Ubuntu 24.04, Xvfb X11 (same artifacts, CI) | tested                             | tested                   | tested        | release and validation workflows  |
| Linux Mint 22.3 host, NVIDIA RTX 2060       | tested (real X11 display and Xvfb) | tested (Xvfb)            | not tested    | [rc.32 defect record][rc32]       |
| Any native Wayland session                  | not verified                       | not verified             | not verified  | no automated Wayland launch check |

"Tested" means the launch probe in `scripts/linux-launch-probe.sh` observed
Juniper report frontend readiness, a viewable window rendered with real
content, no fatal diagnostic for a settle period, and a clean exit. Each tested
mode is launched from an empty profile and again with stored state that enables
an Ollama provider with installed models. The probe does not click through the
interface, and it cannot see a freeze that begins after the settle period.

The AppImage's bundled GTK hook (from Tauri's linuxdeploy GTK plugin) exports
`GDK_BACKEND=x11`, so on a Wayland desktop the AppImage runs through XWayland.
The DEB uses the system GTK backend selection.

## Start Juniper from a terminal

Startup diagnostics go to the terminal only. Juniper has no telemetry or crash
reporting, and these lines never include credentials, prompts, or
conversations.

```bash
chmod +x Juniper-<version>-linux-x86_64.AppImage
./Juniper-<version>-linux-x86_64.AppImage
```

For the DEB, run `juniper`. A healthy start prints:

```text
[juniper-startup] Juniper <version> starting on linux/x86_64
[juniper-startup] linux display=x11 appimage=true graphics-overrides=none
[juniper-startup] local runtime: /…/usr/lib/Juniper/runtime/llama-server
[juniper-startup] stage native-setup: ok
[juniper-startup] frontend ready
```

| Diagnostic                                          | Meaning                                                                                                                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage create-app-data-dir failed (<path>): …`      | Juniper could not create its data directory, usually a permissions problem on `~/.local/share/com.cinqic.juniper`.                                                                                                      |
| `stage open-database failed (<path>): …`            | SQLite could not open or migrate `juniper.db`. A database written by a newer Juniper is reported as such and left unchanged. Juniper never deletes or resets the database to recover; keep a copy before experimenting. |
| `local runtime unavailable: …`                      | The bundled `llama-server` is missing. External providers still work; the Juniper local provider does not.                                                                                                              |
| No `frontend ready` line and the window stays blank | The webview did not finish loading the interface. See the graphics section below.                                                                                                                                       |
| `frontend fatal: …`                                 | The interface hit an error and shows an error page instead of going blank. Include this line in a bug report.                                                                                                           |

## Blank window in 0.3.0-rc.31

`0.3.0-rc.31` opened a blank window whenever Juniper's stored settings had an
enabled Ollama provider and Ollama was running with installed models. The
interface crashed while adding the discovered models. This is fixed in
`0.3.0-rc.32`; upgrade instead of changing graphics settings. On rc.31 only,
stopping the Ollama service before starting Juniper avoids the crash.

## FUSE and the AppImage

The normal AppImage path mounts the image with FUSE. On Debian and Ubuntu
derivatives, install `fuse3` if `/dev/fuse` or `fusermount3` is missing. When
FUSE is unavailable (for example in some containers), use the supported
fallback, which unpacks to a temporary directory on every launch:

```bash
APPIMAGE_EXTRACT_AND_RUN=1 ./Juniper-<version>-linux-x86_64.AppImage
```

## WebKitGTK graphics issues

Juniper renders its interface with WebKitGTK. Some GPU driver and compositor
combinations, most often on NVIDIA, have known upstream WebKitGTK problems
that can leave a window blank or flickering. Juniper does not force any
workaround, because each one reduces hardware acceleration for every user. If
Juniper prints `stage native-setup: ok` but never `frontend ready`, try these
one at a time as a diagnostic:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Juniper-<version>-linux-x86_64.AppImage
__NV_DISABLE_EXPLICIT_SYNC=1 ./Juniper-<version>-linux-x86_64.AppImage
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./Juniper-<version>-linux-x86_64.AppImage
```

Startup reports which of these variables, and `GDK_BACKEND`, were set (names
only, under `graphics-overrides`). If one of them
is required on your system, report your distribution, desktop session, GPU,
and driver version together with the `[juniper-startup]` lines. None of them
were needed on the NVIDIA host where the rc.31 blank window was reproduced.

[rc32]: ../qualification/rc32-platform-defects.md
