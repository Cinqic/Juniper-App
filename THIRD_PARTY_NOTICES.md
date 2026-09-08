# Third-party notices

Juniper is licensed under Apache License 2.0. Its runtime dependencies retain their
own licenses and notices; the exact versions are pinned in `pnpm-lock.yaml` and
`src-tauri/Cargo.toml` / `Cargo.lock` when a native build is performed.

The principal direct dependencies are:

- React, React DOM, Vite, TypeScript, ESLint, Vitest, and Prettier — MIT.
- Tauri and its plugins — MIT or Apache-2.0 as identified by their package
  metadata.
- Rust crates including Tokio, Reqwest, Serde, rusqlite, uuid, keyring, base64,
  hmac, and sha2 — licenses are recorded in each crate's published package
  metadata.

Release packaging should run a dependency license audit for the target bundle
and include any generated notices required by the selected platform.

## Android native runtime

Juniper's Android local runtime embeds the pinned `llama.cpp` source revision
declared in [`config/llama-cpp.json`](config/llama-cpp.json). `llama.cpp` and
the ggml components it builds are distributed under the MIT license by their
respective upstream copyright holders. The source checkout used for a build
is verified against the manifest commit before CMake continues.

The Android arm64 build also enables the upstream KleidiAI CPU backend. Its
compiled portions are Copyright 2024-2026 Arm Limited and/or its affiliates and
are licensed under Apache-2.0. The resolved upstream checkout contains no
`NOTICE` file. The complete Apache-2.0 terms shipped as Juniper's `LICENSE`
therefore also provide the applicable KleidiAI license text; this attribution
preserves the upstream copyright notice.

Juniper does not package `llama-server` on Android. The desktop release keeps
its separately built, pinned server runtime and is governed by the existing
desktop runtime build script.

### llama.cpp and ggml MIT notice

MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
