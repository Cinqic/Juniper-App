# ADR-0013: Native SQLite application repository

Status: accepted for the 0.2 release candidate

The Tauri app persists application state through the native SQLite repository.
The browser preview keeps an isolated localStorage repository for development
only. SQLite schema version 2 adds the optional model binding, app settings,
conversation model overrides, and a transaction-backed app-state payload while
retaining normalized entities and foreign keys.
