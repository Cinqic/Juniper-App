# Android native runtime qualification

## Verdict

**BETA — VERIFIED ON KVM-ACCELERATED X86_64 ANDROID EMULATORS; PHYSICAL ARM64
PROMOTION PENDING.**

The native Android implementation, package gates, lifecycle smoke, offline
inference, API 24 compatibility lane, and official 16 KB-page lane pass on
FLOWBOX. Emulator evidence is not promoted to a physical ARM64 result.

## Reproduced evidence

- The earlier PR #31 qualification run used baseline commit
  `8fbdfecaacc7852f44cac7ebf57dfcee0ad04e22` on branch
  `codex/astra-independent-android-review`. Those emulator and package
  results are retained as historical evidence for the rc29 review candidate;
  they do not replace a fresh physical ARM64 run.
- `config/llama-cpp.json` pins llama.cpp to
  `e107984bcffcfd701e82738092a2b000b6fda7a2`, NDK `29.0.13113456`, CMake
  `3.31.6`, and exactly `arm64-v8a` plus `x86_64`.
- FLOWBOX is Linux `7.0.0-30-generic` on an AMD Ryzen 7 5700G host with 16
  CPUs. `/dev/kvm` is readable and writable by the task user, and
  `emulator -accel-check` reports `KVM ... installed and usable`.
- The qualification model is SmolLM2 135M Q4_K_M, SHA-256
  `8030f04528538d47bda434f6f0bdf3952c40a58123e4d5e755332f23731a8684`.
- Rust Android-target checks and the native contract harness passed in that
  earlier run. Its frontend/Rust validation suite passed with 43 Vitest tests,
  formatting, lint, typecheck, schema/version/branding checks, Cargo fmt,
  Clippy, and Cargo tests.
- The universal debug APK was built with the pinned toolchain and audited:
  SHA-256 `c5beb5b8ababd0b7b6056503cadf2113a6a1d106ea2f190212bac833682d5886`;
  both required ABIs; 33 native libraries; no server runtime; every native
  `PT_LOAD` aligned at `0x4000`; and `zipalign -c -P 16` passed.
- The x86_64 instrumentation APK audit passed with SHA-256
  `c780fa7714d2456725ceb5db340997cdf8c9ebfdaba8df3c30ca8ff3cf9be1a1`.
  Its ABI-specific audit found the JNI bridge, 19 native libraries, no
  server runtime, `0x4000` ELF load alignment, and 16-byte zip alignment.

## Runtime matrix

All inference rows used production context `2048`, four native threads, and
the hash-verified model. Each row ran the complete instrumentation suite:
streamed cold and warm generation, Unicode/JNI text, 20-turn conversation,
128-token long stream, structured context overflow and recovery, immediate
cancel, prefill cancel, decode cancel, unload/reload, and exactly one terminal
event per request.

| Lane                                | Result          | Evidence                                                                                                     |
| ----------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| API 30 x86_64, KVM                  | PASS, 88.911 s  | CPU backend ready; load 449 ms; 128-token stream; `CONTEXT_TOO_LARGE`; both cancellation phases; reload pass |
| API 30 x86_64 offline               | PASS, 87.742 s  | Airplane mode enabled, Wi-Fi/data disabled; same suite passed without network/localhost dependency           |
| API 24 x86_64, KVM                  | PASS, 91.825 s  | SDK 24 boot/install/inference/recovery/reload pass                                                           |
| API 35 x86_64 16 KB page image, KVM | PASS, 112.401 s | `ro.product.cpu.pagesize.max=16384`; AVD RAM 6144 MB; same suite passed                                      |
| API 30 universal app lifecycle      | PASS            | Clean boot, install, MainActivity cold start, rotation/configuration change, force-stop/relaunch, uninstall  |

The API 30 native logcat records CPU backend registration/readiness, context
2048 and four threads, cold/warm output, Unicode, long streaming, structured
overflow, prefill/decode cancellation, and reload. The offline emulator was
restored to normal connectivity after the test.

## Native and JNI hardening

- Cancellation is request-scoped, including a pending-cancel handoff for the
  race between the Kotlin start call and native entry. Prefill cancellation is
  synchronized to a native phase callback in instrumentation, not a timing
  sleep.
- JNI string conversion uses standard Java UTF-16 to strict UTF-8 conversion
  in both directions. Invalid UTF-8 is replaced safely, supplementary
  characters round-trip, callback exceptions are cleared, and local JNI
  references are released.
- Native CPU backend readiness is checked after backend initialization, so
  Kotlin reports `runtimeAvailable` truthfully instead of assuming that a
  library load succeeded.
- Native generation return codes are converted into one terminal failure event
  rather than silently leaving a request busy.
- The ARM64 build has `GGML_NATIVE=OFF`, `GGML_CPU_ALL_VARIANTS=ON`, and
  `GGML_CPU_KLEIDIAI=ON`. The packaged ARM64 libraries are AArch64 and all
  pass the 16 KiB `PT_LOAD` alignment audit. This is a static/cross-build and
  packaging result, not a physical ARM64 execution result.

## Remaining qualification gate

A physical ARM64 Android device is still required before promoting this
runtime beyond Beta. On that device, repeat the offline first prompt, warm
prompt, prefill/decode cancellation, rotation and background/foreground
lifecycle, unload/reload, low-memory recovery, and managed-storage model
verification. This follow-up does not block the core desktop release contract.
No merge, tag, or release was performed as part of this qualification work.
