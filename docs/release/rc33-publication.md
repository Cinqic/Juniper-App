# 0.3.0-rc.33 publication record

Written after the release was published. It records what was published, how it
was verified, and one publication failure that needed manual completion.

## Identity

| Item             | Value                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| Version          | `0.3.0-rc.33` (Android versionCode 3033, MSI 0.3.0.33)                            |
| Pull request     | [#35](https://github.com/Cinqic/Juniper-App/pull/35)                              |
| Merge commit     | `a1ecdc04174cdbc06140804d546498d8baa2b117`                                        |
| Tag              | annotated `v0.3.0-rc.33` → `a1ecdc0`                                              |
| Release workflow | [run 35272545277](https://github.com/Cinqic/Juniper-App/actions/runs/35272545277) |
| Release          | https://github.com/Cinqic/Juniper-App/releases/tag/v0.3.0-rc.33                   |
| Published        | 2026-09-17T21:14:47Z, prerelease                                                  |

Post-merge `pnpm validate && pnpm build` on `a1ecdc0`: PASS (112 frontend tests,
74 native tests with 2 live-Ollama tests ignored, version, license, runtime
contract, and branding checks).

## Publication failure and completion

The workflow's build, smoke, verification, and provenance jobs all passed. The
final `Atomic GitHub prerelease publication` job created the release, then
`softprops/action-gh-release` failed with `Error creating asset temp dir` after
uploading 11 of 14 assets. The job is marked failed in the run, and the release
was published without:

- `Juniper-0.3.0-rc.33-windows-x86_64.msi`
- `Juniper-0.3.0-rc.33-linux-x86_64.deb`
- `RELEASE-PROVENANCE.json`

The tag, the commit, and the already-published assets were not touched. The
three missing files were taken from the same workflow run's verified
`juniper-verified-release` artifact — the exact files the publication step was
uploading, not a local rebuild — and were checked before upload:

- their SHA-256 values match the `SHA256SUMS.txt` that was already published;
- `gh attestation verify` confirms each against this repository and run.

They were then added with `gh release upload`, which refuses to overwrite an
existing asset, so no published asset was replaced. No release was deleted, no
tag was moved, and no new candidate was needed: the published artifacts are the
workflow-built ones.

## Verification of the published release

Downloaded from the release and checked locally:

| Check                                                      | Result                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Asset list vs `manifests/release-candidate.yaml`           | all 14 expected artifacts present, nothing extra                                                  |
| `sha256sum --check SHA256SUMS.txt`                         | OK for all five executable artifacts                                                              |
| `gh attestation verify` (MSI, DEB, AppImage, APK, symbols) | OK for all five                                                                                   |
| `apksigner` on the published APK                           | v2 scheme, `CN=Cinqic, OU=Juniper, O=Cinqic, C=US`                                                |
| APK certificate SHA-256                                    | `1fae65efd13fa984507231f793430b30f49db725cd6fae0f875e06d572608071`, the same certificate as rc.32 |
| `scripts/verify-android-branding.mjs apk`                  | 21 checks passed                                                                                  |
| `SIGNING-windows.txt`                                      | `AuthenticodeStatus=NotSigned`, `ProductVersion=0.3.0.33` — the MSI is unsigned, as documented    |
| `RELEASE-PROVENANCE.json`                                  | version, tag, commit `a1ecdc0`, run 35272545277, and five artifact digests                        |

## Running the published artifacts

| Artifact                                    | Result                                                                                                                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Juniper-0.3.0-rc.33-linux-x86_64.AppImage` | Launched on X11 with an isolated profile: `frontend ready`, no fatal lines; added an Ollama connection (ON DEVICE), set a default model, and received a real reply                                                                           |
| `Juniper-0.3.0-rc.33-android-universal.apk` | Installed on an Android 11 x86_64 emulator: versionName `0.3.0-rc.33`, versionCode 3033, `frontend ready`; added a LOCAL NETWORK Ollama connection, received a real reply, confirmed the delete-chat confirmation, and switched to dark mode |

Screenshots of the released builds are the ones published on
[cinqic.com/juniper/](https://cinqic.com/juniper/).

Windows was verified by the release workflow's MSI install, launch, and
uninstall smoke; that smoke does not capture window pixels, and no manual
Windows review was performed for this candidate.
