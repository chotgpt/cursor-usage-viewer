# Verification record — 2026-08-30/31

Scope: repository code, isolated fixtures, GitHub-hosted runners and the public `chotgpt/cursor-usage-viewer` Draft Release only. No real Cursor database, token, clipboard, application data, Cursor request, user process or installed application was accessed.

## Local verification passed

- React/Vitest: 9 tests across account workspace, one-click refresh, paste import, masked export, version-change notes, updater scheduling, retry and target selection.
- Rust: 21 tests across storage/recovery/deletion, Cockpit-compatible import, three-platform Cursor DB paths, fixed Cursor refresh chain, Free/non-JSON behavior, desktop settings, updater settings and Linux package safety.
- The updater signature fixture accepts the signed fake package and rejects tampered bytes.
- `npm run build`, `npm run check:version`, `npm run test:release`, `cargo fmt --check`, and Clippy with `-D warnings` pass.
- An isolated Windows bundle smoke generated NSIS and MSI installers plus both updater `.sig` files with an ignored test keypair. The test key is not production material and is not tracked.
- Four workflow YAML files parse successfully. Release-script tests prove missing/duplicate targets fail closed and complete assets generate ten target manifests plus merged `latest.json`.
- Credential-pattern scans passed for 134 tracked files. The public-bound `main` and `v0.1.0` histories contain 14 commits and 176 unique blobs; path, content and commit-metadata gates report clean without printing candidate secret contents.

## Private GitHub rehearsal evidence

- Repository: private `chotgpt/cursor-usage-viewer`; default branch `main`; production updater key is held outside the repository and injected through GitHub Secrets.
- CI run [`33321844363`](https://github.com/chotgpt/cursor-usage-viewer/actions/runs/33321844363) passed the complete test job and `--no-bundle` smoke on macOS, Windows and Ubuntu. This includes version sync, 9 React tests, 3 release tests, production frontend build, Rust formatting, 21 Rust tests, Clippy `-D warnings`, credential gate and three runner builds.
- Draft run [`33324854984`](https://github.com/chotgpt/cursor-usage-viewer/actions/runs/33324854984) passed all six signed bundle jobs: Windows NSIS/MSI; macOS Intel, Apple Silicon and Universal; Linux x86_64/aarch64 AppImage, deb and rpm. Its asset/signature, ten target manifest, merged manifest, SHA256 and Draft-state checks passed. The final attestation step was rejected because GitHub does not offer attestations for user-owned private repositories.
- Final workflow run [`33325646227`](https://github.com/chotgpt/cursor-usage-viewer/actions/runs/33325646227) again passed all six bundle jobs. Its gate generated and verified 10 target manifests and 15 merged platform entries; the run then exposed a rerun-only same-name upload conflict, fixed by commit `86d8379` using derived-file cleanup and `--clobber`.
- Because GitHub stopped allocating private runners after the above builds, run [`33326429688`](https://github.com/chotgpt/cursor-usage-viewer/actions/runs/33326429688) had zero executed steps. Its check annotation says account payments failed or the Actions spending limit must be increased. This is an external billing block, not a test or build failure.
- The idempotent gate was therefore executed once from an isolated local temporary directory against the six-runner Draft assets: 25 installer/signature inputs, 10 target manifests, 15 merged platform entries, and 36 SHA256 lines were generated and verified, then uploaded with overwrite semantics.
- At the end of the private rehearsal, `v0.1.0` was Draft `true`, prerelease `false`, with tag target `5280be2a65ad53d949537bae2375e4b2f86f0057`, 37 assets, 10 target manifests, `latest.json` and `SHA256SUMS.txt` present. The release was not published.

## Public transition and final hosted verification

- Before changing visibility, all 14 reachable commits were found to share one valid non-noreply commit email that was not public on the GitHub account. With explicit user authorization, only author/committer email metadata was rewritten to the account's GitHub noreply identity. The `main` and `v0.1.0` file trees were identical before and after rewriting; `refs/original` were removed, the outgoing history gate passed, and the remote refs were updated with exact `--force-with-lease` expectations.
- Repository [`chotgpt/cursor-usage-viewer`](https://github.com/chotgpt/cursor-usage-viewer) is public. Secret scanning, push protection, Dependabot security updates and private vulnerability reporting are enabled; secret-scanning and CodeQL APIs report zero open alerts after the transition. Issues and forks remain enabled, Discussions remain disabled, merge policy is squash-only with merged-branch deletion, and Actions default permissions are read-only.
- Public CI run [`33349008691`](https://github.com/chotgpt/cursor-usage-viewer/actions/runs/33349008691) passed the complete test job and Windows/macOS/Ubuntu `--no-bundle` smoke jobs on rewritten head `b4e3724a9c342816a31ad7184d5f53e1c5785e45`.
- Public CodeQL run [`33349008689`](https://github.com/chotgpt/cursor-usage-viewer/actions/runs/33349008689) completed successfully, resolving the private-repository code-scanning limitation.
- Public Draft run [`33349141609`](https://github.com/chotgpt/cursor-usage-viewer/actions/runs/33349141609) passed validation, all six signed bundle jobs, signed-asset/manifest/checksum gate and public build-provenance attestation. The workflow explicitly confirmed that it never publishes the release.
- Current `v0.1.0` release state remains Draft `true`, prerelease `false`, with 37 assets. Its rewritten tag/target is `a54e81fcf5a3711b7bf074ab24736e22d904cc6f`; no stable Release was published.

## GitHub platform limitations and resolution

- During the private rehearsal, CodeQL upload, build-provenance attestation, branch rulesets and secret scanning were unavailable on the account tier. After the user-authorized public transition, CodeQL upload, public attestation, secret scanning and push protection all succeeded or were enabled; no fake attestation was generated.
- Dependabot alert 1 is the upstream `glib 0.18.5` soundness advisory (moderate; patched in 0.20). `cargo tree --target all -i glib` shows it is pinned by the Tauri 2.11.5 GTK/WebKit/tray stack rather than directly depended upon; a standalone major upgrade would split the GTK ABI and is not included in this release rehearsal.

## Remaining plan-matrix evidence

- Plan §17.1–17.3 and the build portion of §18 are covered by the local and GitHub evidence above.
- Plan §17.4 still requires installation/update E2E from an old isolated test build on actual Windows NSIS/MSI, macOS Intel/Apple Silicon, and Linux AppImage/deb/rpm environments, including cancel/retry/signature-failure/manual-download/restart/release-notes behavior. Successful package generation is not claimed as installation E2E.
- Plan §18 public attestation is now covered by run `33349141609`. Stable publication remains a separate user-authorized action and was not performed.
- The earlier GitHub Actions billing/spending-limit block no longer applies to the standard hosted runners after the repository became public; the final CI, CodeQL and idempotent Draft workflow runs are green.

Decision basis: `docs/DECISIONS.md` §D-011–D-014 and `docs/adr/0002-github-releases-and-signed-updater.md`.
