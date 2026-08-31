#!/usr/bin/env node
import fs from "node:fs";
import { REQUIRED_RELEASE_CHECKS, verifyRequiredChecks } from "./candidate.mjs";
import { parseArgs, required } from "./release-files.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const checkRuns = JSON.parse(fs.readFileSync(required(args, "checks-json"), "utf8"));
  verifyRequiredChecks({ checkRuns, requiredChecks: REQUIRED_RELEASE_CHECKS });
  console.log(`Verified ${REQUIRED_RELEASE_CHECKS.length} required checks on the candidate commit.`);
} catch (error) {
  console.error(`Required check verification failed: ${error.message}`);
  process.exitCode = 1;
}
