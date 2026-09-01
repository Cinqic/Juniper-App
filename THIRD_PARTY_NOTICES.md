# Third-party notices

Juniper is an MIT-licensed application. Its runtime dependencies retain their
own licenses and notices; the exact versions are pinned in `pnpm-lock.yaml` and
`src-tauri/Cargo.toml` / `Cargo.lock` when a native build is performed.

The principal direct dependencies are:

- React, React DOM, Vite, TypeScript, ESLint, Vitest, and Prettier — MIT.
- Tauri and its plugins — MIT or Apache-2.0 as identified by their package
  metadata.
- Rust crates including Tokio, Reqwest, Serde, rusqlite, uuid, and keyring —
  licenses are recorded in each crate's published package metadata.

Release packaging should run a dependency license audit for the target bundle
and include any generated notices required by the selected platform.
