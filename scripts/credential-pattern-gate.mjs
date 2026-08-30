#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const patterns = [
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp|github_pat)_[A-Za-z0-9_]{30,}/,
  /WorkosCursorSessionToken=[A-Za-z0-9._~-]{24,}/,
];
const hits = [];
for (const file of files) {
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  if (patterns.some((pattern) => pattern.test(text))) hits.push(file);
}
if (hits.length) {
  console.error(`Credential-like material detected in ${hits.length} tracked file(s):`);
  for (const file of hits) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  console.log(`Credential pattern gate passed for ${files.length} tracked files.`);
}
