#!/usr/bin/env node
import fs from "node:fs";
import { verifyNoOpenReleaseBlockers } from "./candidate.mjs";
import { parseArgs, required } from "./release-files.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const issues = JSON.parse(fs.readFileSync(required(args, "issues-json"), "utf8"));
  verifyNoOpenReleaseBlockers({ issues });
  console.log("Verified that no open release-blocker issue exists.");
} catch (error) {
  console.error(`Release blocker verification failed: ${error.message}`);
  process.exitCode = 1;
}
