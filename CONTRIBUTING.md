# Contributing to Juniper

GitHub `main` is the canonical project copy. Keep changes reviewable and do
not rewrite shared history. Material architectural changes require an ADR.

Before opening a pull request, run `pnpm validate`, document any unavailable
platform checks, and keep claims aligned with executed evidence. Do not add
telemetry or proprietary required services. Treat model output, attachments,
MCP output, imported templates, and remote metadata as untrusted.

For provider work, add a deterministic fixture and test the normalized
contract. For tool work, add schema/permission tests and ensure real results
are host-authored. For UI work, check keyboard operation, reduced motion,
focus, narrow viewports, and local/remote labeling.
