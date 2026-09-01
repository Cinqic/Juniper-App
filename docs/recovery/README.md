# Clean-machine recovery

GitHub `main` is canonical. A recovery environment must not depend on the
current machine’s app data, model files, keychain, or build output.

## Linux desktop

1. Install Node.js LTS, pnpm 11, Rust stable (Rust 1.90+), and the Tauri Linux
   prerequisites from https://tauri.app/start/prerequisites/.
2. Clone and enter the repository.
3. Run `pnpm install` and then `pnpm validate`.
4. Run `pnpm tauri dev`.
5. Install Ollama from its official source, run `ollama pull qwen3:8b`, and
   connect the preconfigured `http://127.0.0.1:11434` profile.

## Windows desktop

Install Node.js LTS, pnpm 11, Rust with the MSVC toolchain, Microsoft C++ Build
Tools, and WebView2. Then run `pnpm install`, `pnpm validate`, and
`pnpm tauri dev`. Use an explicitly configured Ollama or llama.cpp endpoint.

## Android

Install Android Studio, JDK, SDK Platform/Platform Tools, NDK, build tools,
and the Android Rust targets from the Tauri prerequisites. Run
`pnpm tauri android init` once, then `pnpm tauri android build`.

## iOS

iOS builds require macOS, Xcode, iOS Rust targets, and CocoaPods. This Linux
repository cannot claim an iOS build result.

Application data lives in the platform app-data directory. Model weights and
managed runtimes are separate user-owned paths and are never required in the
Git checkout.
