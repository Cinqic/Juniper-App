# Juniper local runtime slot

Release and development bundles place the Juniper-owned `llama-server` executable
in this directory before Tauri packages the application. The executable is not
checked into git and is never downloaded at runtime.

Use `scripts/build-llama-runtime.sh` on a supported desktop build runner. It
checks out the pinned `llama.cpp` source revision, builds a CPU-safe server, and
writes only the resulting executable here. `JUNIPER_LLAMA_SERVER` remains
available as a developer override for local testing.

The source project is licensed under MIT. Model weights are separate user-owned
files and are downloaded only from the HTTPS URLs and SHA-256 pins in
`config/models/catalog.json`.
