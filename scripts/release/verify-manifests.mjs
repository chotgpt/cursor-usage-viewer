#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildReleaseDocuments, REQUIRED_TARGETS, verifyReleaseDocuments } from "./manifests.mjs";
import { parseArgs, releaseOptions, required } from "./release-files.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const output = required(args, "output-dir");
  const expected = buildReleaseDocuments(releaseOptions(args));
  const actual = { targets: {}, latest: JSON.parse(fs.readFileSync(path.join(output, "latest.json"), "utf8")) };
  for (const target of REQUIRED_TARGETS) {
    actual.targets[target] = JSON.parse(fs.readFileSync(path.join(output, `latest-${target}.json`), "utf8"));
  }
  verifyReleaseDocuments(actual);
  assert.deepEqual(actual, expected);
  console.log(`Verified ${REQUIRED_TARGETS.length} target manifests and latest.json.`);
} catch (error) {
  console.error(`Manifest verification failed: ${error.message}`);
  process.exitCode = 1;
}
