import test from "node:test";
import assert from "node:assert/strict";
import { buildReleaseDocuments } from "./manifests.mjs";
import { verifyPublishedRelease } from "./published.mjs";

const signedAssets = [
  "app_x64-setup.exe", "app_x64_en-US.msi", "app_aarch64.app.tar.gz", "app_x64.app.tar.gz",
  "app_amd64.AppImage", "app_amd64.deb", "app-1.x86_64.rpm",
  "app_aarch64.AppImage", "app_arm64.deb", "app-1.aarch64.rpm",
].map((name) => ({ name, signature: `sig:${name}` }));
const documents = buildReleaseDocuments({ repo: "owner/cursor-usage-viewer", version: "0.1.0", notes: "x", pubDate: "2026-08-30", assets: signedAssets });
const manifestNames = Object.keys(documents.targets).map((target) => `latest-${target}.json`);
const assetNames = [...signedAssets.flatMap(({ name }) => [name, `${name}.sig`]), ...manifestNames, "latest.json", "SHA256SUMS.txt"];
const checksums = assetNames.filter((name) => name !== "SHA256SUMS.txt").map((name) => `${"a".repeat(64)}  ${name}`).join("\n");

test("published verification accepts only a complete stable release", () => {
  assert.equal(verifyPublishedRelease({ release: { isDraft: false, isPrerelease: false, assets: assetNames.map((name) => ({ name })) }, repo: "owner/cursor-usage-viewer", tag: "v0.1.0", documents, checksums }), true);
  assert.throws(() => verifyPublishedRelease({ release: { isDraft: false, isPrerelease: false, assets: assetNames.slice(1).map((name) => ({ name })) }, repo: "owner/cursor-usage-viewer", tag: "v0.1.0", documents, checksums }), /missing/i);
});
