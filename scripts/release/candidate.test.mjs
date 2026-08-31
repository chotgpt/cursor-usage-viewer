import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReleaseDocuments } from "./manifests.mjs";
import { verifyAssetChecksums, verifyNoOpenReleaseBlockers, verifyRequiredChecks, verifyStableCandidate } from "./candidate.mjs";

const repo = "owner/cursor-usage-viewer";
const tag = "v0.1.0";
const tagSha = "a".repeat(40);
const signedAssets = [
  "app_x64-setup.exe", "app_x64_en-US.msi", "app_aarch64.app.tar.gz", "app_x64.app.tar.gz",
  "app_amd64.AppImage", "app_amd64.deb", "app-1.x86_64.rpm",
  "app_aarch64.AppImage", "app_arm64.deb", "app-1.aarch64.rpm",
].map((name) => ({ name, signature: `sig:${name}` }));
const documents = buildReleaseDocuments({ repo, version: "0.1.0", notes: "x", pubDate: "2026-08-30", assets: signedAssets });
const manifestNames = Object.keys(documents.targets).map((target) => `latest-${target}.json`);
const assetNames = [...signedAssets.flatMap(({ name }) => [name, `${name}.sig`]), ...manifestNames, "latest.json", "SHA256SUMS.txt"];
const checksums = assetNames.filter((name) => name !== "SHA256SUMS.txt").map((name) => `${"a".repeat(64)}  ${name}`).join("\n");

function release(overrides = {}) {
  return {
    isDraft: true,
    isPrerelease: false,
    tagName: tag,
    targetCommitish: tagSha,
    assets: assetNames.map((name) => ({ name })),
    ...overrides,
  };
}

test("a complete Draft tied to the exact tag commit passes the stable candidate gate", () => {
  assert.equal(
    verifyStableCandidate({ release: release(), repo, tag, tagSha, confirmation: `PUBLISH ${tag}`, documents, checksums }),
    true,
  );
});

test("an inexact typed confirmation blocks stable publication", () => {
  assert.throws(
    () => verifyStableCandidate({ release: release(), repo, tag, tagSha, confirmation: "yes", documents, checksums }),
    /PUBLISH v0\.1\.0/,
  );
});

test("a release that is already public cannot pass the pre-publication gate", () => {
  assert.throws(
    () => verifyStableCandidate({ release: release({ isDraft: false }), repo, tag, tagSha, confirmation: `PUBLISH ${tag}`, documents, checksums }),
    /Draft/,
  );
});

test("a Draft targeting a different commit cannot be published", () => {
  assert.throws(
    () => verifyStableCandidate({ release: release({ targetCommitish: "b".repeat(40) }), repo, tag, tagSha, confirmation: `PUBLISH ${tag}`, documents, checksums }),
    /commit/i,
  );
});

test("an incomplete signed asset set cannot be published", () => {
  const incomplete = release({ assets: assetNames.filter((name) => name !== "latest.json").map((name) => ({ name })) });
  assert.throws(
    () => verifyStableCandidate({ release: incomplete, repo, tag, tagSha, confirmation: `PUBLISH ${tag}`, documents, checksums }),
    /latest\.json/,
  );
});

test("downloaded release bytes must match SHA256SUMS before publication", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-viewer-candidate-"));
  try {
    const file = path.join(directory, "app.bin");
    fs.writeFileSync(file, "trusted");
    const hash = crypto.createHash("sha256").update("trusted").digest("hex");
    assert.equal(verifyAssetChecksums({ assetsDir: directory, checksums: `${hash}  assets/app.bin` }), true);
    fs.writeFileSync(file, "tampered");
    assert.throws(
      () => verifyAssetChecksums({ assetsDir: directory, checksums: `${hash}  assets/app.bin` }),
      /checksum/i,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed or spoofed required check blocks the release candidate", () => {
  const runs = [
    { name: "test", status: "completed", conclusion: "success", app: { slug: "github-actions" } },
    { name: "bundle-smoke (windows-latest)", status: "completed", conclusion: "failure", app: { slug: "github-actions" } },
    { name: "bundle-smoke (windows-latest)", status: "completed", conclusion: "success", app: { slug: "external-app" } },
  ];
  assert.throws(
    () => verifyRequiredChecks({ checkRuns: runs, requiredChecks: ["test", "bundle-smoke (windows-latest)"] }),
    /windows-latest/,
  );
});

test("any open release-blocker issue blocks stable publication", () => {
  assert.throws(
    () => verifyNoOpenReleaseBlockers({ issues: [{ number: 7, title: "Updater E2E missing" }] }),
    /#7/,
  );
  assert.equal(verifyNoOpenReleaseBlockers({ issues: [] }), true);
});
