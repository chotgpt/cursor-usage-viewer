import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const license = fs.readFileSync("LICENSE", "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const notices = fs.readFileSync("THIRD_PARTY_NOTICES.md", "utf8");

test("the distributed project consistently declares its noncommercial share-alike derivative license", () => {
  assert.equal(packageJson.license, "CC-BY-NC-SA-4.0");
  assert.equal(packageLock.packages[""].license, "CC-BY-NC-SA-4.0");
  assert.match(cargoToml, /^license\s*=\s*"CC-BY-NC-SA-4\.0"$/m);
  assert.match(license, /^Attribution-NonCommercial-ShareAlike 4\.0 International/m);
  assert.match(readme, /CC BY-NC-SA 4\.0/);
  assert.match(readme, /non-commercial|非商业/i);
  assert.match(notices, /jlcodes99\/cockpit-tools/);
  assert.match(notices, /a0508ae815e104e931dae515389e680840008367/);
  assert.match(notices, /CC BY-NC-SA 4\.0/);
});
