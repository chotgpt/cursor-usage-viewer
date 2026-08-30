import fs from "node:fs";
const [owner, publicKey] = process.argv.slice(2);
if (!owner || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) throw new Error("usage: node scripts/configure-release-identity.mjs <github-owner> <tauri-public-key>");
if (!publicKey?.trim()) throw new Error("Tauri updater public key is required");
const file = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.identifier = `io.github.${owner.toLowerCase()}.cursor-usage-viewer`;
config.plugins = config.plugins ?? {};
config.plugins.updater = { pubkey: publicKey, endpoints: [`https://github.com/${owner}/cursor-usage-viewer/releases/latest/download/latest-{{target}}.json`, `https://github.com/${owner}/cursor-usage-viewer/releases/latest/download/latest.json`] };
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
const issue = new URL("../.github/ISSUE_TEMPLATE/config.yml", import.meta.url);
fs.writeFileSync(
  issue,
  fs.readFileSync(issue, "utf8").replace("github.com/OWNER/", `github.com/${owner}/`),
);
const releaseConfig = new URL("../src/config/release.ts", import.meta.url);
fs.writeFileSync(
  releaseConfig,
  fs.readFileSync(releaseConfig, "utf8").replaceAll("OWNER", owner),
);
const capabilities = new URL("../src-tauri/capabilities/default.json", import.meta.url);
fs.writeFileSync(
  capabilities,
  fs.readFileSync(capabilities, "utf8").replaceAll("OWNER", owner),
);
console.log(`Configured io.github.${owner.toLowerCase()}.cursor-usage-viewer and fixed GitHub updater endpoints.`);
