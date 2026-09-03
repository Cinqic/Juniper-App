# Clean-machine recovery

GitHub `main` is canonical. A recovery environment must not depend on the
current machine’s app data, model files, keychain, or build output.

## Linux desktop

1. Install Node.js LTS, pnpm 11, Rust stable (Rust 1.90+), CMake, Git, and the
   Tauri Linux prerequisites from https://tauri.app/start/prerequisites/.
2. Clone and enter the repository.
3. Run `pnpm install` and then `pnpm validate`.
4. Run `pnpm tauri dev`.
5. Run `scripts/build-llama-runtime.sh` when building from source, then start
   Juniper and open Models Market. Choose the recommended model and download it
   without a terminal. Ollama is optional and is not needed for the Juniper
   local provider.

## Windows desktop

Install Node.js LTS, pnpm 11, Rust with the MSVC toolchain, CMake, Git,
Microsoft C++ Build Tools, and WebView2. Then run `pnpm install`, build the
pinned runtime with `bash scripts/build-llama-runtime.sh`, run `pnpm validate`,
and start `pnpm tauri dev`. Use an explicitly configured external provider only
if you need one.

## Android

Install Android Studio, JDK, SDK Platform/Platform Tools, NDK, build tools,
and the Android Rust targets from the Tauri prerequisites. Run
`pnpm tauri android init` once, then `pnpm tauri android build`.

## iOS

iOS builds require macOS, Xcode, iOS Rust targets, and CocoaPods. This Linux
repository cannot claim an iOS build result.

Application data lives in the platform app-data directory. Model weights are
downloaded into its managed `models/` directory. The packaged runtime is a
release resource; source builds create it in `src-tauri/runtime/`, which is
ignored by git and never contains user data.
