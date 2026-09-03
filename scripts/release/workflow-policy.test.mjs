import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const draft = fs.readFileSync(".github/workflows/release.yml", "utf8");
const stable = fs.readFileSync(".github/workflows/publish-stable.yml", "utf8");
const publishedSmoke = fs.readFileSync(
  ".github/workflows/release-published-smoke.yml",
  "utf8",
);
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");

test("the build workflow can only create a Draft", () => {
  assert.match(draft, /releaseDraft:\s*true/);
  assert.doesNotMatch(draft, /--draft=false/);
});

test("stable publication is manual and protected by the stable-release environment", () => {
  assert.match(stable, /workflow_dispatch:/);
  assert.doesNotMatch(stable, /push:/);
  assert.match(stable, /name:\s*stable-release/);
  assert.match(stable, /--draft=false/);
});

test("stable publication revalidates after environment approval", () => {
  assert.match(stable, /Re-verify candidate after protected environment approval/);
  assert.equal((stable.match(/verify-release-candidate\.mjs/g) ?? []).length, 2);
  assert.equal((stable.match(/verify-required-checks\.mjs/g) ?? []).length, 2);
  assert.equal((stable.match(/verify-no-blockers\.mjs/g) ?? []).length, 2);
  assert.equal((stable.match(/gh attestation verify/g) ?? []).length, 2);
});

test("stable preflight can read the Draft without weakening later gates", () => {
  assert.match(
    stable,
    /verify-candidate:[\s\S]*?permissions:\s*\n\s+contents:\s*write[\s\S]*?checks:\s*read[\s\S]*?issues:\s*read[\s\S]*?attestations:\s*read/,
  );
  assert.match(stable, /publish:[\s\S]*?environment:\s*\n\s+name:\s*stable-release/);
  assert.doesNotMatch(stable, /gh attestation verify assets\/\*/);
  assert.equal(
    (stable.match(/xargs -0 -n1 gh attestation verify --repo/g) ?? []).length,
    2,
  );
});

test("stable publication explicitly dispatches a one-file-at-a-time public smoke", () => {
  assert.match(
    stable,
    /publish:[\s\S]*?permissions:[\s\S]*?actions:\s*write[\s\S]*?contents:\s*write/,
  );
  assert.match(
    stable,
    /gh workflow run release-published-smoke\.yml --ref main -f "tag=\$TAG"/,
  );
  assert.match(publishedSmoke, /workflow_dispatch:[\s\S]*?tag:/);
  assert.match(
    publishedSmoke,
    /xargs -0 -n1 gh attestation verify --repo/,
  );
  assert.doesNotMatch(publishedSmoke, /gh attestation verify assets\/\*/);
});

test("pull requests cannot bypass the deterministic visual regression gate", () => {
  assert.match(ci, /npx playwright install chromium/);
  assert.match(ci, /npm run test:visual/);
  assert.match(ci, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(ci, /playwright-report\//);
});
