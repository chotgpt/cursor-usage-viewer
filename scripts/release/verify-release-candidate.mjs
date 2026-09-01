#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { verifyReleaseApproval } from "./approval.mjs";
import { REQUIRED_TARGETS } from "./manifests.mjs";
import { verifyAssetChecksums, verifyStableCandidate } from "./candidate.mjs";
import { parseArgs, required } from "./release-files.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const assetsDir = required(args, "assets-dir");
  const repo = required(args, "repo");
  const tag = required(args, "tag");
  const tagSha = required(args, "tag-sha");
  const release = JSON.parse(fs.readFileSync(required(args, "release-json"), "utf8"));
  const issue = JSON.parse(fs.readFileSync(required(args, "issue-json"), "utf8"));
  const checksums = fs.readFileSync(path.join(assetsDir, "SHA256SUMS.txt"), "utf8");
  const targets = Object.fromEntries(REQUIRED_TARGETS.map((target) => [
    target,
    JSON.parse(fs.readFileSync(path.join(assetsDir, `latest-${target}.json`), "utf8")),
  ]));

  verifyReleaseApproval({ issue, repositoryOwner: repo.split("/", 1)[0], tag, tagSha });
  verifyStableCandidate({
    release,
    repo,
    tag,
    tagSha,
    confirmation: process.env.RELEASE_CONFIRMATION,
    documents: { targets, latest: JSON.parse(fs.readFileSync(path.join(assetsDir, "latest.json"), "utf8")) },
    checksums,
  });
  verifyAssetChecksums({ assetsDir, checksums });
  console.log(`Release candidate ${tag} passed human acceptance, identity, asset and checksum gates.`);
} catch (error) {
  console.error(`Release candidate verification failed: ${error.message}`);
  process.exitCode = 1;
}
