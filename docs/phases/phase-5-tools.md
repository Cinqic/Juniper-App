# Phase 5 — Tool runtime and permissions

Status: implemented, native execution validation pending.

Added the versioned host-result schema, safe recursive-descent calculator,
explicit unit conversions, tool allowlist validation, host result shape, loop
bounds, visible trust boundary, host-safe execution for calculator/datetime/
conversion, and tool cards for built-in capabilities. File access uses opaque
grants and never grants arbitrary paths through a model; user-data tools remain
permission-gated extension points.

Approval: `CANDIDATE - PENDING INDEPENDENT REVIEW`.
