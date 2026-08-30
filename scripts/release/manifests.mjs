const targetPatterns = Object.freeze({
  "windows-x86_64-nsis": /_x64-setup\.exe$/,
  "windows-x86_64-msi": /_x64_en-US\.msi$/,
  "darwin-aarch64-app": /_aarch64\.app\.tar\.gz$/,
  "darwin-x86_64-app": /_x64\.app\.tar\.gz$/,
  "linux-x86_64-appimage": /_amd64\.AppImage$/,
  "linux-x86_64-deb": /_amd64\.deb$/,
  "linux-x86_64-rpm": /-1\.x86_64\.rpm$/,
  "linux-aarch64-appimage": /_aarch64\.AppImage$/,
  "linux-aarch64-deb": /_arm64\.deb$/,
  "linux-aarch64-rpm": /-1\.aarch64\.rpm$/,
});

export const REQUIRED_TARGETS = Object.freeze(Object.keys(targetPatterns));

function normalizedDate(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`invalid publication date: ${value}`);
  return new Date(timestamp).toISOString();
}

function releaseUrl(repo, version, assetName) {
  return `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(assetName)}`;
}

function validateInputs({ repo, version, assets }) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/cursor-usage-viewer$/.test(repo)) {
    throw new Error(`invalid GitHub repository: ${repo}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`invalid version: ${version}`);
  if (!Array.isArray(assets)) throw new Error("assets must be an array");
  const names = new Set();
  for (const asset of assets) {
    if (!asset?.name || names.has(asset.name)) throw new Error(`ambiguous release asset: ${asset?.name ?? "<missing>"}`);
    if (!asset.signature?.trim()) throw new Error(`missing signature for ${asset.name}`);
    names.add(asset.name);
  }
}

function copyEntry(entry) {
  return { url: entry.url, signature: entry.signature };
}

export function buildReleaseDocuments(options) {
  validateInputs(options);
  const { repo, version, notes = "", assets } = options;
  const pubDate = normalizedDate(options.pubDate);
  const entries = {};
  for (const [target, pattern] of Object.entries(targetPatterns)) {
    const matches = assets.filter((asset) => pattern.test(asset.name));
    if (matches.length === 0) throw new Error(`missing updater asset for ${target}`);
    if (matches.length !== 1) throw new Error(`ambiguous updater asset for ${target}`);
    const asset = matches[0];
    entries[target] = { url: releaseUrl(repo, version, asset.name), signature: asset.signature.trim() };
  }

  const targets = {};
  for (const target of REQUIRED_TARGETS) {
    targets[target] = { version, notes, pub_date: pubDate, ...copyEntry(entries[target]) };
  }
  const platforms = Object.fromEntries(Object.entries(entries).map(([target, entry]) => [target, copyEntry(entry)]));
  platforms["windows-x86_64"] = copyEntry(entries["windows-x86_64-nsis"]);
  platforms["darwin-aarch64"] = copyEntry(entries["darwin-aarch64-app"]);
  platforms["darwin-x86_64"] = copyEntry(entries["darwin-x86_64-app"]);
  platforms["linux-x86_64"] = copyEntry(entries["linux-x86_64-appimage"]);
  platforms["linux-aarch64"] = copyEntry(entries["linux-aarch64-appimage"]);

  return {
    targets,
    latest: { version, notes, pub_date: pubDate, platforms },
  };
}

export function verifyReleaseDocuments(documents) {
  for (const target of REQUIRED_TARGETS) {
    const targetDocument = documents.targets?.[target];
    const mergedEntry = documents.latest?.platforms?.[target];
    if (!targetDocument || !mergedEntry) throw new Error(`missing target document: ${target}`);
    if (targetDocument.url !== mergedEntry.url || targetDocument.signature !== mergedEntry.signature) {
      throw new Error(`target document mismatch: ${target}`);
    }
  }
  return true;
}
