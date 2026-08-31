# Strict release process

Cursor Usage Viewer has one stable channel. Automated tests, AI self-review, successful builds and complete Draft assets are necessary evidence, but none of them constitutes human product acceptance. Stable publication requires two separate owner actions bound to one exact tag and commit.

Decision basis: `docs/DECISIONS.md` §D-013–D-016 and `docs/adr/0002-github-releases-and-signed-updater.md`.

## Roles and non-delegable actions

AI agents and automation may implement changes, add tests, open a pull request, produce a signed Draft candidate and report evidence. They must not perform or claim the following owner-only actions:

- personally accepting the product's UI or behavior;
- creating, editing, checking, labeling or closing a Release Acceptance issue;
- approving or bypassing the `stable-release` environment;
- publishing a stable release through the UI, API, CLI or another workflow.

The repository owner performs the product acceptance and both release confirmations. A second human reviewer can replace the single-owner environment policy later, but weakening the gates requires a recorded decision.

## State machine

1. **Development:** changes live on a branch and enter `main` through a reviewed pull request.
2. **Automated verification:** CI, CodeQL, dependency/security gates and three-platform build smoke pass on the exact candidate commit.
3. **Human source/UI review:** the owner runs source locally, inspects the diff, reviews the 1280×800 visual-baseline change and tests user-visible behavior. Issues return to Development; this is not yet release acceptance.
4. **Frozen candidate:** version files and changelog are finalized, then one new `vX.Y.Z` tag is created on the verified `main` commit. Tag movement is prohibited.
5. **Signed Draft:** `.github/workflows/release.yml` builds all platforms, signs updater artifacts, creates target manifests and `latest.json`, writes SHA256, attests provenance and leaves the release Draft.
6. **Exact-candidate acceptance:** the owner tests the tagged source and candidate packages, including the real isolated updater E2E matrix, then completes `.github/ISSUE_TEMPLATE/release-acceptance.yml` for that exact tag and 40-character SHA. The owner adds `release-approved` and closes the issue only after every item is true.
7. **Stable preflight:** the owner manually starts `Publish stable release` with the exact tag, acceptance issue number and confirmation `PUBLISH <tag>`. The workflow verifies that no `release-blocker` is open, then verifies owner authorship, closed state, labels, all checkboxes, evidence, tag/SHA identity, required checks, Draft state, assets, signatures, manifests, downloaded SHA256 and provenance.
8. **Second confirmation:** the publish job waits at the protected `stable-release` environment. The owner reviews the pending job and explicitly approves it. Administrator bypass is disabled.
9. **Revalidation and publication:** after approval, the workflow downloads and verifies the mutable Draft again, then publishes it. Immutable releases lock the tag and assets. The published-release smoke revalidates the public updater metadata.

Any source, version, tag, artifact, manifest, checksum or acceptance change returns the release to the appropriate earlier state. Never edit an already published immutable release; ship a new patch version.

## Development and pull-request gate

Before merge:

1. explain user-visible behavior and provide a manual test script;
2. add or update boundary tests before implementation where a reliable seam exists;
3. run React tests/build, the Playwright visual regression gate, Rust fmt/test/clippy, release tests and the credential gate;
4. review dependencies, permissions, endpoint changes, bilingual copy and clean-room boundaries;
5. obtain required GitHub checks and human PR approval.

Do not create a release tag while product behavior is still expected to change.

## One-time signing and repository protection

- Keep the Tauri updater private key and password outside the repository and only in GitHub Secrets/offline backup. The public key remains embedded in the application.
- Keep `main` protected by required PR review and GitHub Actions checks.
- Protect `v*` tags against deletion and non-fast-forward updates.
- Keep Secret Scanning, Push Protection, Dependabot, CodeQL and private vulnerability reporting enabled.
- Keep GitHub Actions default permissions read-only and pin third-party Actions to full commit SHAs.
- Keep the `stable-release` environment owner-reviewed and `can_admins_bypass: false`.
- Keep immutable releases enabled. Drafts remain mutable only until the stable gate publishes them.

## Candidate commands

Set the version in `package.json`, synchronize it and complete validation:

```powershell
node scripts/sync-version.mjs
npm test
npm run test:visual
npm run test:release
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
node scripts/credential-pattern-gate.mjs
```

After the reviewed commit is on `main`, create a new version tag once. Pushing the tag starts the Draft workflow; it never publishes stable.

## Owner acceptance checklist

Open the Release Acceptance issue form only after the Draft workflow is green. Use isolated fake accounts and test updater infrastructure; never put Cursor tokens, real account exports, updater private keys or unredacted responses in an issue, log, artifact or release.

The owner must personally verify:

- the exact source diff, dependencies, permissions, network boundaries and release notes;
- UI, accessibility, compact layout, Chinese and English behavior;
- the committed 1280×800 baseline diff and a fresh screenshot of the exact candidate, including three-column cards and the current account in the first position;
- import, persistence/restart/recovery, search/filter/page, refresh, Free/non-JSON behavior, export and deletion;
- clean logs/DOM/errors and no accidental real-data access;
- old-to-new updater behavior on every required Windows, macOS and Linux package/platform, including cancel, retry, signature failure, manual fallback, restart and release notes;
- all release-blocking issues are closed and remaining limitations are explicitly accepted.

The form uses stable machine-readable checkbox IDs. Do not alter those IDs without updating `scripts/release/approval.mjs` and its tests.

## Starting stable publication

In GitHub Actions, run **Publish stable release** and enter:

- `tag`: the exact Draft tag;
- `acceptance_issue`: the closed owner acceptance issue number;
- `confirmation`: exactly `PUBLISH <tag>`.

A successful preflight does not publish. Review the pending `stable-release` deployment, compare its tag/SHA/Issue evidence and approve it as the second owner action. Reject it if anything changed or is unclear.

## Failure and rollback policy

- Before publication: leave the Release as Draft, fix on a branch, use a new candidate tag/version and repeat all gates. Never move an accepted tag.
- After publication: immutable assets cannot be replaced. Fix forward with a new patch release.
- A post-publish smoke failure opens a release blocker for immediate investigation; it is not permission to mutate the release.
- Loss or suspected compromise of the updater signing key is a security incident. Stop releases, privately report it and execute a separately reviewed key-rotation plan.

## Authoritative references

- [GitHub: Review AI-generated code](https://docs.github.com/en/enterprise-cloud@latest/copilot/tutorials/review-ai-generated-code)
- [GitHub: Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub: Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [GitHub: Artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [Tauri v2: Updater signing](https://v2.tauri.app/plugin/updater/)
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
