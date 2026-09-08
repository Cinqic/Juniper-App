# ADR 0018: Artifact-centric model catalog

Status: Accepted for the rc29 review candidate

## Decision

Models expose concrete runtime artifacts and file manifests. Runtime,
format, architecture, source revision, hash, and qualification are properties
of an artifact, not universal claims about a model family.

## Consequences

Downloads and selection can be integrity-checked and capability-aware. The
current v1 variant shape is converted for compatibility, while new catalog
entries use v2 artifacts.
