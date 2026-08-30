import test from "node:test";
import assert from "node:assert/strict";
import { buildReleaseDocuments, REQUIRED_TARGETS } from "./manifests.mjs";

const names = [
  "Cursor_Usage_Viewer_0.1.0_x64-setup.exe",
  "Cursor_Usage_Viewer_0.1.0_x64_en-US.msi",
  "Cursor_Usage_Viewer_0.1.0_aarch64.app.tar.gz",
  "Cursor_Usage_Viewer_0.1.0_x64.app.tar.gz",
  "Cursor_Usage_Viewer_0.1.0_amd64.AppImage",
  "Cursor_Usage_Viewer_0.1.0_amd64.deb",
  "Cursor-Usage-Viewer-0.1.0-1.x86_64.rpm",
  "Cursor_Usage_Viewer_0.1.0_aarch64.AppImage",
  "Cursor_Usage_Viewer_0.1.0_arm64.deb",
  "Cursor-Usage-Viewer-0.1.0-1.aarch64.rpm",
];
const assets = names.map((name) => ({ name, signature: `test-signature:${name}` }));

test("complete release assets produce target and merged updater documents", () => {
  const documents = buildReleaseDocuments({
    repo: "example/cursor-usage-viewer",
    version: "0.1.0",
    notes: "Signed test release",
    pubDate: "2026-08-30T00:00:00Z",
    assets,
  });
  assert.deepEqual(Object.keys(documents.targets).sort(), [...REQUIRED_TARGETS].sort());
  assert.equal(documents.targets["windows-x86_64-nsis"].url.endsWith("_x64-setup.exe"), true);
  assert.equal(documents.latest.platforms["linux-aarch64-deb"].signature.includes("arm64.deb"), true);
  assert.equal(documents.latest.platforms["darwin-aarch64"].url, documents.latest.platforms["darwin-aarch64-app"].url);
});

test("release documents fail closed when a target is missing or ambiguous", () => {
  const options = { repo: "example/cursor-usage-viewer", version: "0.1.0", notes: "x", pubDate: "2026-08-30", assets };
  assert.throws(() => buildReleaseDocuments({ ...options, assets: assets.slice(1) }), /missing/i);
  assert.throws(() => buildReleaseDocuments({ ...options, assets: [...assets, assets[0]] }), /ambiguous/i);
});
