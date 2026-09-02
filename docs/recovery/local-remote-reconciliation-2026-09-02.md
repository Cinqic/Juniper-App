# Local vs. remote reconciliation — 2026-09-02

Phase 0 of the independent release review. Recorded before any other work.

## Starting state

| Check                   | Result                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| Working tree            | clean (no modified, no untracked)                                |
| `git stash list`        | empty                                                            |
| Behind `origin/main`    | 0 commits                                                        |
| Ahead of `origin/main`  | **1 commit** — `de8810e`, unpushed                               |
| Tags (local and remote) | none                                                             |
| Releases                | none                                                             |
| Dangling objects        | 9 blobs/trees, all unreferenced build noise; no recoverable work |

## The "Sol" question

The pre-audit noted that no branch, commit, or PR is attributable to Sol
anywhere on the remote. That was accurate. The missing work was **local and
unpushed**: commit `de8810e`, authored `Cinqic <meantanimalza@gmail.com>` on
2026-09-02 10:13 -0400, on local branch `codex/juniper-independent-release-review`
which has no remote counterpart.

It is substantial and real — not scratch work:

- `src-tauri/src/providers.rs` +674 lines
- `src-tauri/src/commands.rs` +229 lines
- `.github/workflows/release.yml` rewritten (+354)
- `scripts/configure-android-signing.mjs`, `verify-linux-bundles.sh`,
  `verify-windows-msi.ps1` added
- deletion of `desktop-build.yml` and `mobile-build.yml`
- frontend, schema, and test updates

Nothing was discarded. The original commit is preserved locally at
`backup/de8810e-original`.

## Problem found and resolved

`de8810e` committed **91 MB of build output** into git history:

- `release-artifacts/Juniper-0.2.0-rc.1-linux-x86_64.AppImage` (83.5 MB)
- `release-artifacts/Juniper-0.2.0-rc.1-linux-x86_64.deb` (7.7 MB)

Git history is permanent; these blobs would have burdened every future clone
forever, and release binaries belong on a GitHub Release, not in the source
tree.

With the owner's explicit direction, the commit was rebuilt as `b23e055`:
every line of source, workflow, and script content preserved byte-for-byte;
only the two binaries and `release-artifacts/PACKAGE-linux.txt` removed, plus
`release-artifacts/` added to `.gitignore`.

Verified by `git diff backup/de8810e-original b23e055`, which reports exactly:

```
 .gitignore                                   |  1 +
 .../Juniper-0.2.0-rc.1-linux-x86_64.AppImage | Bin 83552760 -> 0
 .../Juniper-0.2.0-rc.1-linux-x86_64.deb      | Bin 7716874 -> 0
 release-artifacts/PACKAGE-linux.txt          | 13 -----
```

The binaries themselves were copied to `~/juniper-release-artifacts-local/`
before removal and were not deleted.

## Resulting state

Local branch `codex/juniper-independent-release-review`:

- `b23e055` — the reconciled former `de8810e`
- `95d64fc` — real-model qualification harness (added during Phase 2)
- plus the review documentation commits

Still **unpushed**. `main` has not been touched, rewritten, or force-pushed;
the house rule that `main` is canonical and shared history is never rewritten
was not violated — `de8810e` was never published, so amending it rewrote
nothing anyone else had.

## Recommendation

Push the branch and merge to `main` by pull request, consistent with how PR #2
and PR #3 were handled.
