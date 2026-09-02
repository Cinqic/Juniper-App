// Shared test setup intentionally stays dependency-free so deterministic
// library tests can run before the optional browser component harness is added.
// React uses this flag to enable the supported act() test behavior.
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
