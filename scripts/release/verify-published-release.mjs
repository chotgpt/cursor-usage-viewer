#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { REQUIRED_TARGETS } from "./manifests.mjs";
import { verifyPublishedRelease } from "./published.mjs";
import { parseArgs, required } from "./release-files.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const assetsDir = required(args, "assets-dir");
  const targets = {};
  for (const target of REQUIRED_TARGETS) {
    targets[target] = JSON.parse(fs.readFileSync(path.join(assetsDir, `latest-${target}.json`), "utf8"));
  }
  verifyPublishedRelease({
    release: JSON.parse(fs.readFileSync(required(args, "release-json"), "utf8")),
    repo: required(args, "repo"),
    tag: required(args, "tag"),
    documents: { targets, latest: JSON.parse(fs.readFileSync(path.join(assetsDir, "latest.json"), "utf8")) },
    checksums: fs.readFileSync(path.join(assetsDir, "SHA256SUMS.txt"), "utf8"),
  });
  console.log("Published release manifests, signatures, URLs, and checksums are complete.");
} catch (error) {
  console.error(`Published release verification failed: ${error.message}`);
  process.exitCode = 1;
}
