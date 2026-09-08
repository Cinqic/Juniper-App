# Third-party notices

Juniper is an MIT-licensed application. Its runtime dependencies retain their
own licenses and notices; the exact versions are pinned in `pnpm-lock.yaml` and
`src-tauri/Cargo.toml` / `Cargo.lock` when a native build is performed.

The principal direct dependencies are:

- React, React DOM, Vite, TypeScript, ESLint, Vitest, and Prettier — MIT.
- Tauri and its plugins — MIT or Apache-2.0 as identified by their package
  metadata.
- Rust crates including Tokio, Reqwest, Serde, rusqlite, uuid, keyring, base64,
  hmac, sha2, rustls, and rustls-pki-types — licenses are recorded in each
  crate's published package metadata.

Release packaging should run a dependency license audit for the target bundle
and include any generated notices required by the selected platform.

## Android native runtime

Juniper's Android local runtime embeds the pinned `llama.cpp` source revision
declared in [`config/llama-cpp.json`](config/llama-cpp.json). `llama.cpp` and
the ggml components it builds are distributed under the MIT license by their
respective upstream copyright holders. The source checkout used for a build
is verified against the manifest commit before CMake continues.

The Android arm64 build also enables the upstream KleidiAI CPU backend. Its
license and copyright notices are kept with the pinned upstream checkout and
must accompany any redistributed native symbol or source package.

Juniper does not package `llama-server` on Android. The desktop release keeps
its separately built, pinned server runtime and is governed by the existing
desktop runtime build script.
