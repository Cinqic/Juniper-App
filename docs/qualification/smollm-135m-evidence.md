# Real-model qualification evidence — smollm:135m

Provenance

- Repository: https://github.com/Cinqic/Juniper-App
- Commit under test: `95d64fcdb10618a855d65dcafdabdd86afd943a6` (branch `codex/juniper-independent-release-review`)
- Host: Linux x86_64, glibc 2.39, rustc 1.90.0, Node 22.23.2, pnpm 11.19.0
- Runtime: Ollama 0.33.2 at http://127.0.0.1:11434
- Model: `smollm:135m` (134.52M params, Q4_0, GGUF, llama family)
- Date: 2026-09-02

This is the first real-model generation ever executed against this repository.
Every prior validation document recorded `real_model_generation: pending-owner-selected-model`
because Ollama had no installed models.

## Declared model capabilities

Queried from `/api/show` and via Juniper's own `inspect_model`:

```
capabilities   = ["completion"]
context_length = 2048
metadata_source = ollama:/api/show
```

`smollm:135m` declares **completion only** — no `tools`, no `thinking`.
This determines which qualification suites can apply.

## Suite results

| Suite                   | `applies_when`      | Result                                                |
| ----------------------- | ------------------- | ----------------------------------------------------- |
| `generic-chat.yaml`     | chat: supported     | **PASS**                                              |
| `generic-context.yaml`  | chat: supported     | **PASS** (current-message-once)                       |
| `generic-tools.yaml`    | tools: supported    | **NOT APPLICABLE** — model declares only `completion` |
| `generic-thinking.yaml` | thinking: supported | **NOT APPLICABLE** — model declares only `completion` |

Tools and thinking are **not** recorded as passing. A completion-only model
cannot exercise them, and asserting otherwise would be a false claim. Those two
surfaces remain covered only by deterministic fixture tests
(`fake_ollama_chat_server_handles_tool_calls`,
`fake_ollama_chat_server_handles_thinking_and_final_record`, and peers).

## Recorded harness output

```
QUALIFICATION model=smollm:135m capabilities=["completion"] context_length=Some(2048)
QUALIFICATION generic-chat: PASS chars=74 done_events=1
QUALIFICATION generic-chat sample="Here is a short answer:\n\nThe answer to the following question is:\n\nAnswer:"
QUALIFICATION generic-context current-message-once: PASS
QUALIFICATION generic-tools: NOT-APPLICABLE (model declares ["completion"])
QUALIFICATION generic-thinking: NOT-APPLICABLE (model declares ["completion"])
test result: ok. 1 passed; 0 failed
```

The sampled text is low quality; that is expected of a 135M-parameter model and
is not what these suites measure. The suites measure the **runtime contract**:
normalized streaming, termination, capability honesty, and context assembly.

## What was actually verified

- Streaming deltas arrive normalized through the native Ollama adapter and the
  stream terminates with **exactly one** `done` event; no error event.
- Real generated text is non-empty (74 characters).
- Diagnostics retain the real model ID (`inspect_model` returns `smollm:135m`,
  `metadata_source: ollama:/api/show`) while the assistant persona stays
  host-authored — Juniper identity is never sourced from model self-description.
- **Capability honesty:** because the model does not declare `tools`,
  `tool_payload` produces an empty payload and no tool definitions are sent.
  Juniper does not widen what the runtime declares.
- **Context assembly:** the current user message appears exactly once in the
  compiled outgoing body, after host and assistant context.
- Execution location resolves `on-device` for a local Ollama provider and the
  header renders **ON DEVICE** (`labelExecutionLocation`).
- `health_check` reports `connected`; an unknown model is correctly rejected.

## Reproducing

```
ollama pull smollm:135m
JUNIPER_LIVE_OLLAMA_MODEL=smollm:135m \
  cargo test --locked --manifest-path src-tauri/Cargo.toml \
  live_ollama_qualification_suites -- --ignored --nocapture
```

The harness is gated on `JUNIPER_LIVE_OLLAMA_MODEL` so ordinary runs stay
hermetic. Suites whose capability gate is unmet report NOT-APPLICABLE rather
than passing.

## Remaining gap

Tool-call round-trips and thinking metadata have **never** been exercised
against a real model. Qualifying them requires an installed model that declares
`tools` (and `thinking`) — for example `qwen3` or `llama3.1`. Until then
`REQ-TOOLS` and the thinking path rest on fixture evidence only.
