# Real-model qualification evidence — Ollama

## Provenance

- Repository: https://github.com/Cinqic/Juniper-App
- Commit under test: `772815dde3e6eb6c53fba1f08632f898c1d9c8b5` (branch `codex/juniper-independent-release-review`)
- Host: Linux x86_64, glibc 2.39, rustc 1.90.0, Node 22.23.2, pnpm 11.19.0
- Runtime: Ollama 0.33.2 at http://127.0.0.1:11434
- Date: 2026-09-02

Models used:

| Model         | Params        | Declared capabilities             | Context |
| ------------- | ------------- | --------------------------------- | ------- |
| `smollm:135m` | 134.52M, Q4_0 | `completion`                      | 2048    |
| `qwen3:0.6b`  | 0.6B          | `completion`, `tools`, `thinking` | 40960   |

These are the first real-model generations ever executed against this
repository. Every prior validation document recorded
`real_model_generation: pending-owner-selected-model` because Ollama had no
installed models.

## Suite results

| Suite                   | `applies_when`      | `smollm:135m`  | `qwen3:0.6b` |
| ----------------------- | ------------------- | -------------- | ------------ |
| `generic-chat.yaml`     | chat: supported     | **PASS**       | **PASS**     |
| `generic-context.yaml`  | chat: supported     | **PASS**       | **PASS**     |
| `generic-tools.yaml`    | tools: supported    | not applicable | **PASS**     |
| `generic-thinking.yaml` | thinking: supported | not applicable | **PASS**     |

`smollm:135m` declares only `completion`, so it cannot exercise tools or
thinking. The harness reports those as NOT-APPLICABLE rather than as passes —
a completion-only model cannot qualify them, and claiming otherwise would be
false. `qwen3:0.6b` declares all three and completes all four suites.

## Recorded harness output — qwen3:0.6b

```
QUALIFICATION model=qwen3:0.6b capabilities=["completion", "tools", "thinking"] context_length=Some(40960)
QUALIFICATION generic-chat: PASS chars=122 done_events=1
QUALIFICATION generic-context current-message-once: PASS
QUALIFICATION generic-tools: PASS host_authored_results=1 statuses=["success"]
QUALIFICATION generic-tools detail: name=Some("calculator.evaluate") status=Some("success") result={"value":16392538977.0} error=null
QUALIFICATION generic-thinking: PASS reasoning_chars=282 separate_from_answer=true
test result: ok. 1 passed; 0 failed
```

## Recorded harness output — smollm:135m

```
QUALIFICATION model=smollm:135m capabilities=["completion"] context_length=Some(2048)
QUALIFICATION generic-chat: PASS chars=100 done_events=1
QUALIFICATION generic-context current-message-once: PASS
QUALIFICATION generic-tools: NOT-APPLICABLE (model declares ["completion"])
QUALIFICATION generic-thinking: NOT-APPLICABLE (model declares ["completion"])
test result: ok. 1 passed; 0 failed
```

## What was actually verified

**Streaming and termination.** Deltas arrive normalized through the native
Ollama adapter; the stream ends with **exactly one** `done` event and no error
event, on both models.

**Tool round-trip is host-authored.** `qwen3:0.6b` was asked
_"Calculate 847291 \* 19347."_ with the calculator definition the app actually
ships (`src/lib/defaults.ts`). The model emitted a tool call; the **host**
executed it and authored the result:

```
protocolVersion: juniper-tool-protocol-v1
name: calculator.evaluate
status: success
result: { "value": 16392538977.0 }
```

847291 × 19347 = 16,392,538,977 — the host's arithmetic is exact. The harness
asserts `protocolVersion`, `callId`, `name`, and `status` on every result, so a
model-authored number could not be mistaken for execution.

**Malformed arguments are rejected, not coerced.** An earlier run of the same
suite used the loose test-stub schema (`{"type": "object"}`), which gave the
model no argument guidance. It produced non-conforming arguments and the host
returned a host-authored error:

```
status: error
error: { "code": "INVALID_TOOL_ARGUMENT", "message": "invalid tool arguments" }
```

That is exactly the `malformed-call` check in `generic-tools.yaml`: the host
returns `INVALID_TOOL_ARGUMENT` without coercing arguments to an empty object.
Both branches of that suite are therefore evidenced.

**Thinking stays separate from the answer.** With `thinking: "on"`,
`qwen3:0.6b` produced 282 characters of reasoning delivered on the `reasoning`
channel. The harness asserts the reasoning text does not appear inside the
answer content, so thinking metadata cannot leak into the visible reply.

**Capability honesty.** Because `smollm:135m` does not declare `tools`,
`tool_payload` produces an empty payload and no tool definitions are sent.
Juniper never widens what the runtime declares.

**Context assembly.** The current user message appears exactly once in the
compiled outgoing body, after host and assistant context.

**Execution location.** Resolves `on-device` for a local Ollama provider; the
header renders **ON DEVICE** via `labelExecutionLocation`.

**Identity.** Diagnostics retain the real model ID (`inspect_model` returns the
model id with `metadata_source: ollama:/api/show`) while the assistant persona
stays host-authored — Juniper identity is never sourced from model
self-description.

## Reproducing

```
ollama pull qwen3:0.6b
JUNIPER_LIVE_OLLAMA_MODEL=qwen3:0.6b \
  cargo test --locked --manifest-path src-tauri/Cargo.toml \
  live_ollama_qualification_suites -- --ignored --nocapture
```

The harness is gated on `JUNIPER_LIVE_OLLAMA_MODEL` so ordinary runs stay
hermetic, and it adapts to whatever the named model declares.

## Note on output quality

Both models produce weak prose — `smollm:135m` in particular repeats itself.
That is expected at 135M and 0.6B parameters and is **not** what these suites
measure. The suites measure the runtime contract: normalized streaming,
termination, capability honesty, host-authored tool execution, reasoning
separation, and context assembly.

## Re-verification — 2026-09-03, final review

Both suites were re-run from a clean state during the final independent review,
after the tool-permission and thinking fixes described in
[the final review report](../release/0.2.0-rc.1-final-review.md). Same host,
same Ollama 0.33.2.

```
QUALIFICATION model=smollm:135m capabilities=["completion"] context_length=Some(2048)
QUALIFICATION generic-chat: PASS chars=187 done_events=1
QUALIFICATION generic-context current-message-once: PASS
QUALIFICATION generic-tools: NOT-APPLICABLE (model declares ["completion"])
QUALIFICATION generic-thinking: NOT-APPLICABLE (model declares ["completion"])
test result: ok. 2 passed; 0 failed
```

```
QUALIFICATION model=qwen3:0.6b capabilities=["completion", "tools", "thinking"] context_length=Some(40960)
QUALIFICATION generic-chat: PASS chars=128 done_events=1
QUALIFICATION generic-context current-message-once: PASS
QUALIFICATION generic-tools: PASS host_authored_results=1 statuses=["success"]
QUALIFICATION generic-tools detail: name=Some("calculator.evaluate") status=Some("success") result={"value":16392538977.0} error=null
QUALIFICATION generic-thinking: PASS reasoning_chars=604 separate_from_answer=true
test result: ok. 2 passed; 0 failed
```

The host-authored `calculator.evaluate` result reproduced exactly
(`16392538977.0`), confirming that tightening the tool gate to default-deny did
not close the legitimate path: a tool the request _does_ enable still executes
and still returns a host-authored result.

### A real defect this qualification run exposed

`live_ollama_owner_approved_model_uses_the_native_adapter` **failed** against
`qwen3:0.6b` with _"live model returned no text"_, while passing against
`smollm:135m`. This was not a test defect.

`ollama_body` only sent Ollama's `think` field when the model's declared
thinking capability was exactly `supported`. A model discovered without
inspection reports `unknown`, so `think` was omitted entirely and Ollama applied
the _model's own default_ — thinking on. On a thinking-capable model the whole
output budget was then spent on reasoning and the user received an empty answer,
even though the assistant was explicitly configured with Thinking = Off.

Reproduced directly against the runtime:

```
$ curl .../api/chat -d '{"model":"qwen3:0.6b","options":{"num_predict":64}, ...}'
content= ''
thinking_len= 252
```

Ollama accepts `think: false` for a model without thinking support, but rejects
`think: true` (`"smollm:135m" does not support thinking`). Disabling is
therefore always safe to send; only enabling needs the capability gate. Fixed
accordingly, and the previously failing live test now passes.
