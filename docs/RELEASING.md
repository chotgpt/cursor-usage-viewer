# Strict release process

Cursor Usage Viewer has one stable channel. Automated tests, AI self-review, successful builds and complete Draft assets are necessary evidence, but none of them constitutes human product acceptance. Stable publication requires two separate confirmations bound to one exact tag and commit; both rest on the owner's explicit acceptance and publish authorization.

Decision basis: `docs/DECISIONS.md` §D-013–D-016, §D-024 and `docs/adr/0002-github-releases-and-signed-updater.md`.

## Roles: owner judgment versus delegated execution

AI agents and automation may implement changes, add tests, open a pull request, produce a signed Draft candidate and report evidence.

**Judgment stays with the owner and cannot be delegated.** Only the owner can state that the exact candidate was reviewed, installed and tested, and only the owner can decide that it ships. Each item of the acceptance checklist must be explicitly confirmed by the owner for the exact tag/SHA; automated results, screenshots, a green Draft or an agent's own testing never substitute for that confirmation. Vague statements ("looks fine", "build passed", "make the Draft") are not acceptance and not authorization.

**Execution may be delegated (§D-024).** After the owner has explicitly confirmed the checklist and explicitly authorized publishing the exact tag (for example "同意发布 v0.1.2" / "PUBLISH v0.1.2"), an agent acting with the owner's credentials may perform the mechanical steps on the owner's behalf:

- create and fill the Release Acceptance issue with the tag, SHA, evidence and all checklist items, add `release-approved` and close it;
- start `Publish stable release` with the exact tag, issue number and `PUBLISH <tag>`;
- approve the pending `stable-release` deployment.

The agent must record in the issue's evidence that it acted as executor under the owner's authorization given on a stated date, quoting or summarizing the owner's confirmation. It must stop and ask instead of proceeding when the owner confirmed only part of the checklist, when the consent does not name the exact tag, when the candidate, checks, Draft or `release-blocker` state changed since the authorization, or when any gate rejects the request. Agents must never edit `scripts/release/approval.mjs`, the template checkbox IDs or workflow gates to make a publication pass.

A second human reviewer can replace the single-owner environment policy later, but weakening the gates requires a recorded decision.

## State machine

1. **Development:** changes live on a branch and enter `main` through an owner-reviewed pull request after all required checks pass.
2. **Automated verification:** CI, CodeQL, dependency/security gates and three-platform build smoke pass on the exact candidate commit.
3. **Human source/UI review:** the owner runs source locally, inspects the diff, reviews both dark and light 1280×800 visual-baseline changes (including the fifth Grok/Sand quota and current-account-first ordering) and tests user-visible behavior. Issues return to Development; this is not yet release acceptance.
4. **Frozen candidate:** version files and changelog are finalized, then one new `vX.Y.Z` tag is created on the verified `main` commit. Tag movement is prohibited.
5. **Signed Draft:** `.github/workflows/release.yml` builds all platforms, signs updater artifacts, creates target manifests and `latest.json`, writes SHA256, attests provenance and leaves the release Draft.
6. **Exact-candidate acceptance:** the owner tests the tagged source and candidate packages, including the real isolated updater E2E matrix, and explicitly confirms every checklist item plus the publish authorization for that exact tag and 40-character SHA. The owner, or an agent executing under §D-024, then completes `.github/ISSUE_TEMPLATE/release-acceptance.yml`, adds `release-approved` and closes the issue only after every item is true.
7. **Stable preflight:** the owner or the authorized agent starts `Publish stable release` with the exact tag, acceptance issue number and confirmation `PUBLISH <tag>`. The workflow verifies that no `release-blocker` is open, then verifies owner authorship, closed state, labels, all checkboxes, evidence, tag/SHA identity, required checks, Draft state, assets, signatures, manifests, downloaded SHA256 and provenance.
8. **Second confirmation:** the publish job waits at the protected `stable-release` environment. The owner, or the authorized agent on the owner's behalf, compares the pending job's tag/SHA/issue with the authorization and approves it. Administrator bypass is disabled.
9. **Revalidation and publication:** after approval, the workflow downloads and verifies the mutable Draft again, then publishes it. Immutable releases lock the tag and assets. The published-release smoke revalidates the public updater metadata.

Any source, version, tag, artifact, manifest, checksum or acceptance change returns the release to the appropriate earlier state. Never edit an already published immutable release; ship a new patch version.

## Development and pull-request gate

Before merge:

1. explain user-visible behavior and provide a manual test script;
2. add or update boundary tests before implementation where a reliable seam exists;
3. run React tests/build, the Playwright visual regression gate, Rust fmt/test/clippy, release tests and the credential gate;
4. review dependencies, permissions, endpoint changes, bilingual copy, CC BY-NC-SA consistency and Cockpit derivative provenance;
5. obtain all required GitHub checks, resolve review conversations and have the owner review the final diff before squash merge.

Do not create a release tag while product behavior is still expected to change.

## One-time signing and repository protection

- Keep the Tauri updater private key and password outside the repository and only in GitHub Secrets/offline backup. The public key remains embedded in the application.
- Keep `main` protected by a required pull request, strict GitHub Actions checks, conversation resolution, linear history, and blocked deletions/force pushes.
- Protect `v*` tags against deletion and non-fast-forward updates.
- Keep Secret Scanning, Push Protection, Dependabot, CodeQL and private vulnerability reporting enabled.
- Keep GitHub Actions default permissions read-only and pin third-party Actions to full commit SHAs.
- Keep the `stable-release` environment owner-reviewed and `can_admins_bypass: false`.
- Keep immutable releases enabled. Drafts remain mutable only until the stable gate publishes them.

### Solo-maintainer pull-request design

The repository currently has one identity with merge permission. GitHub does not allow a pull-request author to approve their own pull request, so requiring one approval would make every owner-authored change impossible to merge without weakening the rules ad hoc or using an administrator bypass. The branch gate therefore separates an auditable pull-request/check gate from the independent-review gate that only becomes meaningful when a second maintainer exists.

Configure the `main` ruleset as follows:

- require a pull request, squash merge, resolved conversations and strict required status checks;
- set required approving reviews to `0`;
- disable stale-approval dismissal, latest-push approval and extra approval for unattributed changes;
- require linear history and block deletion and non-fast-forward updates;
- do not keep an administrator in the always-bypass list.

External contributors can still open pull requests and respond to review feedback. They cannot merge without write permission; the owner reviews the final diff and performs the merge after the required checks pass. Before granting write access to a second independent maintainer, reassess this decision and normally restore at least one required approval.

This source-merge design does not weaken the stable-release gates. Exact-candidate acceptance and the protected `stable-release` environment remain two separate confirmations; both rest on the owner's own explicit acceptance and authorization even when an agent executes them under §D-024.

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

When an agent fills the form under §D-024, every checkbox it ticks must correspond to an explicit owner confirmation for this exact candidate; the evidence field must name the authorization date and summarize the owner's statements.

The owner must personally verify:

- the exact source diff, dependencies, permissions, network boundaries and release notes;
- UI, accessibility, compact layout, Chinese and English behavior;
- the committed 1280×800 baseline diff and a fresh screenshot of the exact candidate, including three-column cards and the current account in the first position;
- all four add-account actions (web login, access token, JSON paste/file and current local account), persistence/restart/recovery, search/filter/page, manual refresh, Free/non-JSON behavior, export and deletion;
- Cursor auto-refresh off/default/preset/custom behavior, hot-setting changes, manual/automatic single-concurrency, and continued refresh while the window is hidden to the tray; also verify that quitting stops the scheduler and that the tray icon/menu restore the window;
- web-login success, cancellation, timeout and retry without Token, PKCE verifier or full polling URLs appearing in logs, errors, DOM or screenshots;
- clean logs/DOM/errors and no accidental real-data access;
- old-to-new updater behavior on every required Windows, macOS and Linux package/platform, including cancel, retry, signature failure, manual fallback, restart and release notes;
- all release-blocking issues are closed and remaining limitations are explicitly accepted.

The form uses stable machine-readable checkbox IDs. Do not alter those IDs without updating `scripts/release/approval.mjs` and its tests.

## Starting stable publication

In GitHub Actions, run **Publish stable release** and enter:

- `tag`: the exact Draft tag;
- `acceptance_issue`: the closed owner acceptance issue number;
- `confirmation`: exactly `PUBLISH <tag>`.

A successful preflight does not publish. Review the pending `stable-release` deployment, compare its tag/SHA/Issue evidence and approve it as the second confirmation. Reject it if anything changed or is unclear. An agent may perform both steps only under a §D-024 authorization that names this exact tag.

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
