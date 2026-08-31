import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const draft = fs.readFileSync(".github/workflows/release.yml", "utf8");
const stable = fs.readFileSync(".github/workflows/publish-stable.yml", "utf8");

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
