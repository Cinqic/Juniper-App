# Artifact-centric model catalog

Catalog models describe user-facing model metadata separately from concrete
runtime artifacts. An artifact identifies its runtime, format, platforms,
architectures, source revision, optional runtime minimum, maturity,
qualification, and a complete file manifest with HTTPS sources, expected byte
counts, and SHA-256 hashes.

The downloader and model picker select an artifact, never a bare model. A
multi-file runtime bundle is represented by multiple manifest files rather
than by pretending that one model file works for every backend. The current
bundled catalog contains four GGUF artifacts for llama.cpp; optional runtime
entries are visible in the registry but are not selectable without an
installed compatible artifact.

Legacy v1 catalogs are read once into the v2 in-memory shape for compatibility.
New catalog data must use `artifacts`; the `variants` field is only a temporary
compatibility view for older UI callers and is not a second source of truth.
