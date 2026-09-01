# Verification record — 2026-08-30/31

Scope: repository code, isolated fixtures, GitHub-hosted runners and the public `chotgpt/cursor-usage-viewer` Draft Release. Except for the explicitly user-authorized, status-only live diagnosis recorded below, no real Cursor database, token, clipboard, application data, Cursor request, user process or installed application was accessed.

## Local verification passed

### 2026-09-01 user-authorized live 403 diagnosis

- With the user's explicit authorization, one account already stored by the application was used for status-only differential probes. No token, cookie, email or response body was printed or recorded.
- With the same account, URL and application-layer request contract, the production `reqwest` client configured with `rustls` returned HTTP 403 while Windows Schannel returned HTTP 200. Adding `Origin`, `Referer` and browser fetch headers did not change the Schannel result.
- Restoring `reqwest`'s Cockpit-compatible native TLS defaults made both the minimal request and the real `CursorUsageProvider::refresh_account` chain succeed. The final live provider result reported `core_live=true`, `core_error=false`, no auxiliary errors and no Sand usage/access errors.
- This live result verifies the current saved account and Windows development environment only. It does not replace user UI acceptance or multi-platform candidate-package E2E.

### 2026-09-01 final Cockpit comparison follow-up

- Three independent read-only reviewers rechecked protocol/error ownership, engineering behavior and UI/visual behavior against Cockpit commit `a0508ae815e104e931dae515389e680840008367`, with current-project and upstream file/line evidence.
- OAuth failures now remain exclusively in auxiliary diagnostics even when `usage-summary` also fails; the core error preserves the actual core stage/status. On-Demand now preserves Cockpit's per-field team fallbacks, cents-to-dollar display, unlimited individual usage and disabled state. Imported cached usage reuses the same mapper.
- Settings load/modify/save operations are serialized in application state. Full export now has atomic saving, copied-path feedback and an explicit reveal-in-folder command limited to the most recently saved export path. English provider failures no longer expose untranslated Chinese backend diagnostics.
- Full credential exports no longer create an undisclosed adjacent `.bak`; the regression test covers overwriting an existing export while producing only the user-selected file. Remembered window coordinates are restored only when they still land on an available monitor. A failed updater "skip this version" settings write keeps the update visible and reports the persistence failure instead of silently dismissing it.
- The post-update version dialog was rebuilt on the shared modal shell after screenshot inspection exposed its missing backdrop/layout. Added visual coverage for 900×600 list scrolling, English provider errors, the version-change dialog and saved-export actions; all new screenshots were inspected before a final non-updating run.
- Final local results after the follow-up fixes: React/Vitest 57/57; Rust 45/45; Playwright visual 33/33 on the final non-updating rerun; production build, 28 release tests, version sync, Rustfmt, Clippy with `-D warnings`, credential-pattern gate for 151 tracked files and `git diff --check` passed. The added Cursor sorting contract locks Cockpit's exact option order, default direction, current-account priority, Credits comparison, cycle-end comparison and missing-reset placement, with a separately inspected expanded-menu baseline.
- These mock/static checks prove request construction and state behavior only. They do not prove that a real Cursor account or Cursor's edge/WAF accepts `usage-summary`; no real credential or Cursor request was used.

### 2026-08-31 Cockpit parity and 403 follow-up

- Mocked request-contract tests pin `usage-summary` to Cockpit's fixed `GET` method, WorkOS session Cookie, JSON Accept header and macOS browser User-Agent; Sand usage separately pins the `Cusor-bot-sand` Bearer/Connect request. These tests do not claim that a real Cursor account accepts the request.
- A two-refresh storage regression proves a persisted core HTTP 403 is cleared after the next successful core refresh. Optional OAuth/profile failures remain separately visible without turning a successful core refresh into a core failure.
- React behavior coverage includes batch deletion confirmation, persisted tag editing, tag-filtered grouping, unavailable `localStorage`, modal focus trapping/restoration and independent metadata/Sand/core outcomes.
- Visual coverage includes English, dark/light themes, 1280×800, 900×600, long Sand plans/reasons, light modal, tag editing/grouping and batch deletion. Candidate screenshots were inspected before the final non-updating visual run.

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
