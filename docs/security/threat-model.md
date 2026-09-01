# Security threat model

| Threat                                | Control                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Fake model-authored tool result       | Only Rust host functions create `host_result`; model continuation is never trusted.                                         |
| Prompt injection in files/tool output | Content is data; it cannot alter permissions or system policy.                                                              |
| Arbitrary file read                   | Opaque attachment grants, type allowlist, regular-file check, and 1 MiB cap.                                                |
| Shell injection                       | No shell command is exposed in default capabilities; GGUF import uses a fixed executable with separate validated arguments. |
| Secrets in logs/export                | Credentials never enter normal UI state, logs, or exports.                                                                  |
| Dangerous Markdown                    | Renderer escapes all text and only creates controlled links with `target`/`rel`.                                            |
| Unbounded tool loop/payload           | Four rounds, eight calls per round, and 64 KiB argument/result budget.                                                      |
| Local/remote confusion                | Locality is a typed profile property, shown in header, model list, and privacy center.                                      |
| Malformed assistant import            | Versioned schema validation and inert JSON parsing.                                                                         |
| Database corruption                   | SQLite migrations, foreign-key enforcement, and normalized entities.                                                        |

This document is a v0.2 self-review artifact, not an independent security audit.
