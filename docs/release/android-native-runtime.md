# Android native local runtime

Juniper Android uses an in-process `llama.cpp` bridge for the managed GGUF
model path. It does not start `llama-server`, bind a localhost port, or proxy
the model through a second process. The desktop path remains unchanged and
continues to own its packaged `llama-server` runtime.

## Reproducible build inputs

The source revision, Android ABIs, NDK, and CMake versions are recorded in
[`config/llama-cpp.json`](../../config/llama-cpp.json). The Android plugin
verifies the `llama.cpp` checkout before compiling and links the JNI bridge
with 16 KiB `PT_LOAD` alignment for both `arm64-v8a` and `x86_64`.

From a clean checkout with the Android SDK and Rust targets installed:

```bash
pnpm install --frozen-lockfile
pnpm tauri android init --ci
pnpm tauri android build --apk --ci -- --locked
```

The release workflow runs the package audit below and publishes unstripped
native symbols separately from the signed APK:

```bash
bash scripts/verify-android-apk.sh path/to/Juniper-android-universal.apk
bash scripts/package-android-symbols.sh path/to/merged_native_libs/out/lib native-symbols.zip
```

The audit requires exactly the two supported ABIs, the JNI bridge in each ABI,
no server runtime library, and 16 KiB alignment for every packaged shared
object.

## Runtime contract

After the user downloads a model, Rust verifies its catalog SHA-256 and keeps
it in app-private managed storage. The native bridge parses and validates GGUF
version, tensor, architecture, and tokenizer metadata before it attempts the
full model load. The first chat then loads that verified path into the process;
subsequent prompts reuse the warm native context. Generation is
serialized, streamed as `ChatStreamEvent` deltas, cancellable during prefill
and decode, and unloaded on background lifecycle transitions. Rotation and
reload therefore cannot leave a stale native request running.

Before a native load, Android reports `ActivityManager.MemoryInfo` to the
runtime. The controller accounts for the verified file size, context scratch
space, and a native overhead reserve; unsafe loads fail with a stable
`LOCAL_MEMORY_UNSAFE` result. Runtime status also reports the packaged ABI,
available memory, low-memory state, and load failure code so the UI can keep
downloaded, loading, ready, and unavailable states distinct. Critical trim and
low-memory callbacks cancel generation and unload native allocations.

## Qualification status

CI covers clean native compilation, APK contents, ABI alignment, emulator
install/lifecycle smoke, and the existing Rust/frontend validation suite. The
real inference smoke and final qualification remain device gates: a physical
ARM64 device still needs to be connected for the offline first prompt with a
real streamed delta, warm second prompt, cancellation during prefill/decode,
rotation/background/reload, and low-memory recovery. Until that run is
recorded, the release must not be labelled `READY FOR INDEPENDENT REVIEW`.
