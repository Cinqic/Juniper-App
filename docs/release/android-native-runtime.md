# Android native local runtime

Juniper Android uses an in-process `llama.cpp` bridge for the managed GGUF
model path. It does not start `llama-server`, bind a localhost port, or proxy
the model through a second process. The desktop path remains unchanged and
continues to own its packaged `llama-server` runtime.

## Reproducible build inputs

The source revision, Android ABIs, NDK, and CMake versions are recorded in
[`config/llama-cpp.json`](../../config/llama-cpp.json). The Android plugin
verifies the llama.cpp checkout before compiling and builds the CPU backend
with 16 KiB `PT_LOAD` alignment for both `arm64-v8a` and `x86_64`.

From a clean checkout with the Android SDK and Rust targets installed:

```bash
pnpm install --frozen-lockfile
pnpm tauri android init --ci
pnpm tauri android build --debug --apk --ci --target aarch64 x86_64 -- --locked
```

Audit the resulting universal APK with:

```bash
bash scripts/verify-android-apk.sh \
  src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

The audit requires exactly the two supported ABIs, the JNI bridge in each
ABI, no server runtime library, 16 KiB alignment for every packaged shared
object, and Android `zipalign -P 16` verification. The qualification build
used NDK `29.0.13113456`, CMake `3.31.6`, and the pinned llama.cpp commit
`e107984bcffcfd701e82738092a2b000b6fda7a2`.

The host-side native contract checks cover parameter bounds, strict UTF-8
buffering, UTF-16/UTF-8 conversion, cancellation state, and move-only
resource cleanup:

```bash
bash scripts/run-native-contract-tests.sh
```

The native inference instrumentation smoke uses the pinned SmolLM2 135M
Q4_K_M file without checking the model into the repository:

```bash
./gradlew :juniper-local-runtime:assembleDebugAndroidTest
JUNIPER_TEST_CONTEXT_SIZE=2048 bash scripts/run-android-inference-smoke.sh \
  path/to/SmolLM2-135M-Instruct.Q4_K_M.gguf \
  src-tauri/plugins/juniper-local/android/build/outputs/apk/androidTest/debug/juniper-local-runtime-debug-androidTest.apk
```

The script verifies the catalog SHA-256, pushes the model into test-app-private
storage, and now rejects JUnit process-crash summaries as failures even when
`am instrument` returns code zero. The test suite covers real streamed text,
terminal-event uniqueness, Unicode/JNI conversion, immediate/prefill/decode
cancellation, context overflow and recovery, unload, and reload.

The reusable emulator smoke requires KVM and refuses software emulation. It
supports an explicit `ANDROID_SYSTEM_IMAGE` override for API 24 and official
16 KB-page images. The manually dispatched GitHub workflow follows the same
rule: if the hosted runner cannot expose usable KVM, it exits with a truthful
blocked status instead of reporting a slow software-emulation inference pass.

## Runtime contract

After the user downloads a model, Rust verifies its catalog SHA-256 and keeps
it in app-private managed storage. The native bridge parses and validates GGUF
version, tensor, architecture, and tokenizer metadata before it attempts the
full model load. The first chat then loads that verified path into the process;
subsequent prompts reuse the warm native context. Generation is serialized,
streamed as `ChatStreamEvent` deltas, cancellable during prefill and decode,
and unloaded on background lifecycle transitions. Rotation and reload cannot
leave a stale native request running.

Before a native load, Android reports `ActivityManager.MemoryInfo` to the
runtime. The controller accounts for the verified file size, context scratch
space, and a native overhead reserve; unsafe loads fail with a stable
`LOCAL_MEMORY_UNSAFE` result. Runtime status also reports the packaged ABI,
available memory, low-memory state, and load failure code so the UI can keep
downloaded, loading, ready, and unavailable states distinct. Critical trim
and low-memory callbacks cancel generation and unload native allocations.

## Qualification status

FLOWBOX evidence currently passes on KVM-accelerated x86_64 Android API 30,
API 24, and an official Android 35 16 KB-page image. The universal debug APK
also passes the app lifecycle smoke for cold start, rotation,
force-stop/relaunch, and uninstall. The API 30 suite passed offline with the
network disabled.

These are emulator and cross-build results. A physical ARM64 device remains a
release gate for offline first prompt, warm second prompt, prefill/decode
cancellation, rotation/background/reload, low-memory recovery, and actual
ARM64 execution. Until that device run is recorded, do not label the release
fully cross-platform qualified or ready for independent release review.
