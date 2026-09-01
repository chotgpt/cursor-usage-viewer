import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Cursor requests retain Cockpit-compatible native TLS defaults", async () => {
  const cargo = await readFile(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
  const declaration = cargo.match(/^reqwest\s*=\s*\{[^\n]+\}$/m)?.[0] ?? "";

  assert.match(declaration, /features\s*=\s*\[[^\]]*"json"/);
  assert.doesNotMatch(declaration, /default-features\s*=\s*false/);
  assert.doesNotMatch(declaration, /rustls-tls/);
});

test("About links stay inside the fixed project opener allowlist", async () => {
  const capability = JSON.parse(await readFile(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
  const opener = capability.permissions.find((permission) => permission?.identifier === "opener:allow-open-url");
  const urls = opener?.allow?.map((entry) => entry.url) ?? [];

  assert.ok(urls.includes("https://github.com/chotgpt/cursor-usage-viewer"));
  assert.ok(urls.includes("https://github.com/chotgpt/cursor-usage-viewer/releases"));
  assert.ok(urls.includes("https://github.com/chotgpt/cursor-usage-viewer/releases/*"));
});
