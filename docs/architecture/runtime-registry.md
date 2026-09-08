# Runtime registry and maturity

Juniper treats a runtime as a separately qualified implementation, not as a
property inferred from a model name. The registry is duplicated at the UI and
Rust boundaries so both surfaces can report the same identity, source
revision, artifact formats, platform/architecture support, capabilities,
installation state, maturity, and qualification reason.

The current pins are:

| Runtime            | Pin                                        | Current candidate status                                         |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------- |
| llama.cpp          | `e107984bcffcfd701e82738092a2b000b6fda7a2` | Desktop stable; Android Beta                                     |
| LiteRT-LM          | `v0.16.1`                                  | Optional, package-only until a compatible artifact is shipped    |
| ExecuTorch         | `v1.4.1`                                   | Optional, package-only until a compatible artifact is shipped    |
| MLC LLM            | `9fa644f54b04983adea4d0168f49fc6af4a893ba` | Experimental; compiled bundle and physical GPU evidence required |
| ONNX Runtime GenAI | `v0.15.2`                                  | Experimental; Preview API and no bundle in this candidate        |

`available` means that a compatible runtime package is present for the current
platform and architecture. `package-only` does not mean production-qualified;
it means the package exists but independent artifact/device evidence is still
missing. Unknown capabilities remain unknown and never imply accelerator,
streaming, tool, or structured-output support.

The Android llama.cpp bridge is intentionally Beta. Emulator and cross-build
results qualify packaging and lifecycle behavior, while a physical ARM64 run
is a promotion follow-up. It is not a global desktop release gate.
