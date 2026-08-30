# Release process

This project has one stable channel. A `v*` tag creates or updates a Draft Release; automation never publishes it. The repository must remain private until the complete `v0.1.0` Draft has passed review.

## One-time identity and signing setup

1. Confirm the personal GitHub owner and create a long-lived Tauri updater keypair offline.
2. Keep the encrypted private key and password outside the repository. Add their contents as `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets.
3. Run `node scripts/configure-release-identity.mjs <owner> <public-key>` once, review the identifier, updater endpoints, opener scope and private-report link, then commit the result.
4. Create the private `<owner>/cursor-usage-viewer` repository and apply the rules and security settings specified in the final implementation plan.

The production public key and owner are intentionally not guessed. Without them, `tauri build` fails closed before producing updater artifacts.

## Draft release

1. Set the version in `package.json`; run `node scripts/sync-version.mjs` and commit all synchronized files.
2. Run the complete local validation matrix and the worktree/history credential scan.
3. Push `v<version>`. The release workflow builds Windows NSIS/MSI, macOS Intel/Apple Silicon updater archives plus a Universal manual bundle, and Linux x86_64/aarch64 AppImage/deb/rpm assets.
4. The gate downloads the Draft assets, pairs every updater asset with its `.sig`, generates ten `latest-<target>.json` files and merged `latest.json`, creates SHA256 checksums and attestations, and fails if anything is missing or ambiguous.
5. Inspect the Draft and complete the three-platform old-version-to-new-version update tests with isolated manifests, test credentials and isolated application data.

## Public release

Changing repository visibility and publishing the Draft are separate user-authorized actions. After both approvals, make the repository public, re-check security settings, then publish the already verified Draft manually. The published-release workflow revalidates target manifests, signed asset pairs, fixed GitHub URLs and SHA256 coverage.

Never put Cursor credentials, updater private keys, real account exports or unredacted responses in GitHub, Actions logs, artifacts or Releases.
