/* Derived from Cockpit Tools src/utils/privacy.ts at a0508ae815e104e931dae515389e680840008367. */
const PRIVACY_MODE_STORAGE_KEY = "cursor-usage-viewer.privacy-mode-enabled";

function maskSegment(value: string, keepStart = 2, keepEnd = 2) {
  const raw = value.trim();
  if (!raw) return raw;
  if (raw.length <= 2) return `${raw.charAt(0)}*`;
  if (raw.length <= keepStart + keepEnd) return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
  return `${raw.slice(0, keepStart)}***${raw.slice(-keepEnd)}`;
}

function maskEmail(value: string) {
  const [localPart = "", domainPart = ""] = value.split("@");
  const localMasked = maskSegment(localPart, 2, 1);
  if (!domainPart) return `${localMasked}@***`;
  const domainTokens = domainPart.split(".").filter(Boolean);
  if (domainTokens.length === 0) return `${localMasked}@***`;
  if (domainTokens.length === 1) return `${localMasked}@${maskSegment(domainTokens[0], 1, 1)}`;
  const tld = domainTokens.at(-1);
  const host = domainTokens.slice(0, -1).map((item) => maskSegment(item, 1, 1)).join(".");
  return `${localMasked}@${host}.${tld}`;
}

function maskGeneric(value: string) {
  const raw = value.trim();
  if (!raw) return raw;
  if (raw.length <= 3) return `${raw.charAt(0)}**`;
  if (raw.length <= 6) return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
  if (raw.length <= 10) return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  return `${raw.slice(0, 3)}***${raw.slice(-3)}`;
}

export function initialPrivacyMode() {
  try { return localStorage.getItem(PRIVACY_MODE_STORAGE_KEY) === "1"; } catch { return false; }
}

export function persistPrivacyMode(enabled: boolean) {
  try { localStorage.setItem(PRIVACY_MODE_STORAGE_KEY, enabled ? "1" : "0"); } catch { /* Keep the in-memory preference. */ }
}

export function maskSensitiveValue(value: string | null | undefined, enabled: boolean) {
  const raw = (value ?? "").trim();
  if (!raw || !enabled) return raw;
  return raw.includes("@") ? maskEmail(raw) : maskGeneric(raw);
}
