import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifyReleaseIntegrity } from "./published.mjs";

export const REQUIRED_RELEASE_CHECKS = [
  "test",
  "bundle-smoke (windows-latest)",
  "bundle-smoke (macos-latest)",
  "bundle-smoke (ubuntu-22.04)",
  "analyze (javascript-typescript)",
];

export function verifyAssetChecksums({ assetsDir, checksums }) {
  for (const line of checksums.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})\s{2,}(.+)$/i);
    if (!match) throw new Error("invalid checksum line");
    const file = path.join(assetsDir, path.basename(match[2]));
    if (!fs.existsSync(file)) throw new Error(`checksum asset is missing: ${path.basename(file)}`);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== match[1].toLowerCase()) throw new Error(`checksum mismatch: ${path.basename(file)}`);
  }
  return true;
}

export function verifyRequiredChecks({ checkRuns, requiredChecks }) {
  for (const name of requiredChecks) {
    const passed = checkRuns.some((run) =>
      run.name === name
      && run.status === "completed"
      && run.conclusion === "success"
      && run.app?.slug === "github-actions"
    );
    if (!passed) throw new Error(`required GitHub Actions check did not pass: ${name}`);
  }
  return true;
}

export function verifyNoOpenReleaseBlockers({ issues }) {
  if (issues.length) {
    const issue = issues[0];
    throw new Error(`open release blocker #${issue.number}: ${issue.title}`);
  }
  return true;
}

export function verifyStableCandidate({ release, repo, tag, tagSha, confirmation, documents, checksums }) {
  const expected = `PUBLISH ${tag}`;
  if (confirmation !== expected) throw new Error(`typed confirmation must equal: ${expected}`);
  if (!release.isDraft || release.isPrerelease) {
    throw new Error("stable candidate must be a non-prerelease Draft");
  }
  if (release.tagName !== tag || release.targetCommitish !== tagSha) {
    throw new Error("Draft tag or target commit does not match the candidate");
  }
  verifyReleaseIntegrity({ release, repo, tag, documents, checksums });
  return true;
}
