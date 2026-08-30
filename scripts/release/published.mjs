import path from "node:path";
import { REQUIRED_TARGETS, verifyReleaseDocuments } from "./manifests.mjs";

export function verifyPublishedRelease({ release, repo, tag, documents, checksums }) {
  if (release.isDraft || release.isPrerelease) throw new Error("release is not stable");
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error(`invalid tag: ${tag}`);
  const version = tag.slice(1);
  verifyReleaseDocuments(documents);

  const releaseNames = new Set(release.assets.map((asset) => asset.name));
  const requiredNames = ["latest.json", "SHA256SUMS.txt", ...REQUIRED_TARGETS.map((target) => `latest-${target}.json`)];
  for (const name of requiredNames) if (!releaseNames.has(name)) throw new Error(`missing release asset: ${name}`);

  const prefix = `https://github.com/${repo}/releases/download/${tag}/`;
  for (const target of REQUIRED_TARGETS) {
    const manifest = documents.targets[target];
    if (manifest.version !== version) throw new Error(`version mismatch for ${target}`);
    if (!manifest.url.startsWith(prefix)) throw new Error(`rejected updater URL for ${target}`);
    const assetName = decodeURIComponent(manifest.url.slice(prefix.length));
    if (assetName.includes("/") || assetName.includes("\\")) throw new Error(`invalid updater asset name for ${target}`);
    if (!releaseNames.has(assetName) || !releaseNames.has(`${assetName}.sig`)) {
      throw new Error(`missing signed updater pair for ${target}`);
    }
  }

  const checksumNames = new Set(
    checksums.split(/\r?\n/).filter(Boolean).map((line) => {
      if (!/^[a-f0-9]{64}\s{2,}/i.test(line)) throw new Error("invalid SHA256SUMS line");
      return path.basename(line.trim().split(/\s+/).at(-1));
    }),
  );
  for (const name of releaseNames) {
    if (name !== "SHA256SUMS.txt" && !checksumNames.has(name)) throw new Error(`missing checksum for ${name}`);
  }
  return true;
}
