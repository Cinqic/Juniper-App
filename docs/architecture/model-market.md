# Models Market and managed model lifecycle

`config/models/catalog.json` is the single checked-in source for the initial
model catalog. Each entry includes the model family, parameter count, use cases,
chat template, context length, supported CPU architectures, license and
attribution, a source revision, an HTTPS download URL, an exact byte size, and a
SHA-256 digest. The initial catalog contains four instruction-tuned GGUF models
under 1B parameters.

The frontend and Rust native layer both validate the catalog shape before using
it. The frontend combines architecture, logical cores, available/total memory,
memory pressure, and free storage to produce an explainable recommendation.
Unknown measurements reduce confidence; they never become an optimistic
compatibility claim. Downloads require the model size plus a 512 MiB safety
headroom when free storage is known.

## Download state machine

```text
absent -> downloading -> ready
             |              |
             v              v
          partial        corrupt
             |
             +------ resume
```

Weights are written to an app-data `models/` directory as a `.gguf.part` file.
An existing partial file is resumed only when the server returns `206 Partial
Content`; otherwise it is safely restarted. The stream is bounded by the
catalogue's expected byte count. The completed file is hashed, compared with
the catalog digest, and atomically renamed into its final name only after the
check passes. A mismatch is removed and surfaced as a structured error.

The final and partial paths are derived from trusted variant IDs and reject
unsafe names. Symlinks are not accepted for verification or resume. Remove
cleans both final and partial files for the selected trusted catalog entry.

The UI exposes Recommended, All models, and Installed views, shows the device
profile and fit reason, supports pause/resume, and keeps advanced source,
license, context, filename, and digest details visible without making them the
default reading path.
