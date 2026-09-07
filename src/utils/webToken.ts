/* Mirrors build_session_cookie in src-tauri/src/provider.rs: `<user_id>%3A%3A<accessToken>` is the value of the WorkosCursorSessionToken cookie. */
const USER_ID_PATTERN = /^user_[A-Za-z0-9_-]+$/;
const ACCESS_TOKEN_KEYS = ["accessToken", "access_token", "jwt", "token"];
const USER_ID_KEYS = ["workosId", "workos_id", "authId", "auth_id"];

export type WebTokenResult = { tokens: string[]; skipped: number };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }

function firstString(object: JsonObject | undefined, keys: string[]) {
  if (!object) return null;
  for (const key of keys) { const value = object[key]; if (typeof value === "string" && value.trim()) return value.trim(); }
  return null;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function decodeJwtPayload(token: string): JsonObject | null {
  const segment = token.split(".")[1];
  if (!segment) return null;
  try { const payload: unknown = JSON.parse(decodeBase64Url(segment)); return isObject(payload) ? payload : null; } catch { return null; }
}

export function normalizeWebUserId(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  const candidate = raw.slice(raw.lastIndexOf("|") + 1);
  return USER_ID_PATTERN.test(candidate) ? candidate : null;
}

export function webSessionToken(account: unknown) {
  if (!isObject(account)) return null;
  const authRaw = isObject(account.cursorAuthRaw) ? account.cursorAuthRaw : undefined;
  const accessToken = firstString(account, ACCESS_TOKEN_KEYS) ?? firstString(authRaw, ["accessToken"]);
  if (!accessToken) return null;
  const sub = decodeJwtPayload(accessToken)?.sub;
  const userId = normalizeWebUserId(typeof sub === "string" ? sub : null)
    ?? normalizeWebUserId(firstString(account, USER_ID_KEYS))
    ?? normalizeWebUserId(firstString(authRaw, USER_ID_KEYS));
  return userId ? `${userId}%3A%3A${accessToken}` : null;
}

export function webSessionTokensFromExport(json: string): WebTokenResult {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { tokens: [], skipped: 0 }; }
  const accounts = Array.isArray(parsed) ? parsed : [parsed];
  const tokens: string[] = [];
  let skipped = 0;
  for (const account of accounts) { const token = webSessionToken(account); if (token) tokens.push(token); else skipped += 1; }
  return { tokens, skipped };
}
