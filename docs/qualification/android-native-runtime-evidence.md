# Android native runtime qualification

## Verdict

**BLOCKED — not READY FOR INDEPENDENT REVIEW.**

The implementation and package gates below are complete, but the required
physical ARM64 qualification has not been performed. This document deliberately
does not promote emulator or static evidence to a device result.

## Reproduced evidence

- `config/llama-cpp.json` pins llama.cpp to
  `e107984bcffcfd701e82738092a2b000b6fda7a2`, NDK `29.0.13113456`, CMake
  `3.31.6`, and exactly `arm64-v8a` plus `x86_64`.
- Debug and release universal APKs compiled successfully with the native JNI
  bridge for both ABIs.
- The APK audit found 33 shared libraries, one JNI bridge per ABI, no
  `llama-server` library, and `0x4000` alignment for every `PT_LOAD` segment.
- The catalog's smallest GGUF was downloaded to the local qualification cache
  and matched its catalog SHA-256:
  `8030f04528538d47bda434f6f0bdf3952c40a58123e4d5e755332f23731a8684`.
- Rust Android-target checks passed for `aarch64-linux-android` and
  `x86_64-linux-android`.
- The end-to-end release APK assembled from those Rust libraries has SHA-256
  `43444ce6a5a1eddd32081ca3a60f0e286d11ca1fb7e9a82b74fe06aa10ab20ff`, and
  the unstripped native symbol archive has SHA-256
  `e10b99b31636d989e73ca52107d8b49c40669079209cb95f83db4bbfa81593bd`.
- The shared native contract harness covers parameter bounds, UTF-8 buffering,
  cancellation state, and idempotent move-only resource cleanup; Linux CI runs
  it with `scripts/run-native-contract-tests.sh`.
- Frontend validation passed: 43 tests, formatting, lint, typecheck, schema,
  version, branding, Cargo fmt, and Clippy with `-D warnings`.
- The native load path now parses GGUF metadata with the pinned `ggml-base`
  parser before the full llama model load, rejecting unsupported version,
  tensor, architecture, or tokenizer metadata as `LOCAL_GGUF_REJECTED`.
- The Android instrumentation inference smoke now exists as a reproducible
  test command; it has not run here because no ADB device or hardware-
  accelerated emulator is available.

The Tauri CLI's final Windows staging step could not create its Rust-library
symlinks because Developer Mode / `SeCreateSymbolicLinkPrivilege` is disabled
on this host. The Rust release libraries themselves compiled successfully for
both targets; the audited local APK used file copies of those exact outputs.
The Linux CI job uses the normal symlink-capable Tauri path.

## Outstanding qualification

Run on a physical ARM64 Android device with networking disabled after the
verified model is present in app-private managed storage:

1. Android inference smoke: run the documented
   `scripts/run-android-inference-smoke.sh` command with the hash-verified
   SmolLM2 135M Q4_K_M model, observe a valid streamed delta, and verify
   exactly one terminal event; repeat with cancellation and unload/reload.
2. First prompt: native load, real streamed tokens, and no network/localhost
   dependency.
3. Warm second prompt without a second model load.
4. Cancellation during prefill and decode.
5. Rotation, background/foreground, reload, and low-memory recovery without a
   stale request or leaked native engine.

The local x86_64 emulator could not start because this host has no Android
Emulator Hypervisor Driver; x86_64 emulation requires hardware acceleration.
That is an environment limitation, not evidence that the runtime passed.
