# Local verification — 2026-08-30

Scope: repository code and isolated fixtures only. No real Cursor database, token, clipboard, application data, Cursor request, user process or installed application was accessed.

## Passed

- React/Vitest: 9 tests across account workspace, one-click refresh, paste import, masked export, version-change notes, updater scheduling, retry and target selection.
- Rust: 21 tests across storage/recovery/deletion, Cockpit-compatible import, three-platform Cursor DB paths, fixed Cursor refresh chain, Free/non-JSON behavior, desktop settings, updater settings and Linux package safety.
- The updater signature fixture accepts the signed fake package and rejects tampered bytes.
- `npm run build`, `npm run check:version`, `npm run test:release`, `cargo fmt --check`, and Clippy with `-D warnings` pass.
- An isolated Windows bundle smoke generated NSIS and MSI installers plus both updater `.sig` files with an ignored test keypair. The test key is not production material and is not tracked.
- Four workflow YAML files parse successfully. Release-script tests prove missing/duplicate targets fail closed and complete assets generate ten target manifests plus merged `latest.json`.
- Credential-pattern scans report `WORKTREE_CLEAN` and `HISTORY_CLEAN`; only tracked and non-ignored repository files were scanned, and matching secret contents would not have been printed.

## Deliberately pending external evidence

- GitHub owner, production updater public/private key material and GitHub CLI/login are not available.
- Repository creation/push/settings/secrets, visibility change and `v0.1.0` Draft/stable publication require current user authorization.
- macOS Intel/Apple Silicon/Universal and Linux x86_64/aarch64 bundles, three-platform installation checks and old-test-version updater E2E require their GitHub runners or platform machines.

Decision basis: `docs/DECISIONS.md` §D-011–D-014 and `docs/adr/0002-github-releases-and-signed-updater.md`.
