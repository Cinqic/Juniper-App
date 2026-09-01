# Phase 2 — Persistence, schemas, assistants, chat model

Status: implemented, native migration validation pending.

Added versioned assistant JSON, JSON Schemas, import/export validation,
normalized TypeScript chat entities, browser-preview persistence with private
chat exclusion, and a Rust SQLite migration containing assistants, providers,
models, conversations, messages, parts, memories, attachments, calls, and
results with foreign keys.

Tests: frontend assistant/context/storage tests passed; the Rust migration test
is present but pending a native Rust toolchain.

Approval: `CANDIDATE - PENDING INDEPENDENT REVIEW`.
