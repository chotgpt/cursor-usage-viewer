#!/usr/bin/env node
import path from "node:path";
import { buildReleaseDocuments } from "./manifests.mjs";
import { parseArgs, releaseOptions, required, writeJson } from "./release-files.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const output = required(args, "output-dir");
  const documents = buildReleaseDocuments(releaseOptions(args));
  for (const [target, manifest] of Object.entries(documents.targets)) {
    writeJson(path.join(output, `latest-${target}.json`), manifest);
  }
  console.log(`Generated ${Object.keys(documents.targets).length} target manifests.`);
} catch (error) {
  console.error(`Target manifest generation failed: ${error.message}`);
  process.exitCode = 1;
}
