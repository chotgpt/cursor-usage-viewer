import fs from "node:fs";
import path from "node:path";

export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${token}`);
    values[token.slice(2)] = value;
    index += 1;
  }
  return values;
}

export function required(args, name) {
  if (!args[name]) throw new Error(`missing --${name}`);
  return args[name];
}

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

export function loadSignedAssets(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`assets directory not found: ${root}`);
  const files = filesUnder(root);
  const byName = new Map();
  for (const file of files) {
    const name = path.basename(file);
    if (byName.has(name)) throw new Error(`duplicate asset filename: ${name}`);
    byName.set(name, file);
  }
  return files
    .filter((file) => !file.endsWith(".sig"))
    .map((file) => {
      const name = path.basename(file);
      const signatureFile = byName.get(`${name}.sig`);
      return signatureFile ? { name, signature: fs.readFileSync(signatureFile, "utf8").trim() } : null;
    })
    .filter(Boolean);
}

export function releaseOptions(args) {
  return {
    assets: loadSignedAssets(required(args, "assets-dir")),
    repo: required(args, "repo"),
    version: required(args, "version"),
    notes: fs.readFileSync(required(args, "notes-file"), "utf8").trim(),
    pubDate: required(args, "pub-date"),
  };
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
