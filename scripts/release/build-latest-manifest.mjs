#!/usr/bin/env node
import path from "node:path";
import { buildReleaseDocuments } from "./manifests.mjs";
import { parseArgs, releaseOptions, required, writeJson } from "./release-files.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const output = required(args, "output-dir");
  const documents = buildReleaseDocuments(releaseOptions(args));
  writeJson(path.join(output, "latest.json"), documents.latest);
  console.log(`Generated merged manifest with ${Object.keys(documents.latest.platforms).length} platform entries.`);
} catch (error) {
  console.error(`Merged manifest generation failed: ${error.message}`);
  process.exitCode = 1;
}
