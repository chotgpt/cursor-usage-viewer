import { describe, expect, it } from "vitest";
import { decodeJwtPayload, normalizeWebUserId, webSessionToken, webSessionTokensFromExport } from "./webToken";

function jwt(payload: Record<string, unknown>) {
  const encode = (value: string) => btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode(JSON.stringify({ alg: "RS256" }))}.${encode(JSON.stringify(payload))}.signature`;
}

describe("webToken", () => {
  it("decodes a base64url JWT payload", () => {
    expect(decodeJwtPayload(jwt({ sub: "auth0|user_01ABC", exp: 1 }))).toEqual({ sub: "auth0|user_01ABC", exp: 1 });
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("a.%%%.c")).toBeNull();
  });

  it("extracts the user id after the last pipe and rejects non user_ ids", () => {
    expect(normalizeWebUserId("auth0|user_01ABC-def")).toBe("user_01ABC-def");
    expect(normalizeWebUserId("user_01ABC")).toBe("user_01ABC");
    expect(normalizeWebUserId("auth0|someone")).toBeNull();
    expect(normalizeWebUserId("user_01/../x")).toBeNull();
    expect(normalizeWebUserId("")).toBeNull();
  });

  it("builds the url-encoded web session token from the access token sub claim", () => {
    const token = jwt({ sub: "auth0|user_01ABC" });
    expect(webSessionToken({ accessToken: token })).toBe(`user_01ABC%3A%3A${token}`);
    expect(webSessionToken({ access_token: token })).toBe(`user_01ABC%3A%3A${token}`);
    expect(webSessionToken({ cursorAuthRaw: { accessToken: token } })).toBe(`user_01ABC%3A%3A${token}`);
  });

  it("falls back to workosId or authId when the sub claim is unusable", () => {
    const token = jwt({ sub: "service" });
    expect(webSessionToken({ accessToken: token, workosId: "user_01XYZ" })).toBe(`user_01XYZ%3A%3A${token}`);
    expect(webSessionToken({ accessToken: token, authId: "auth0|user_01XYZ" })).toBe(`user_01XYZ%3A%3A${token}`);
    expect(webSessionToken({ accessToken: token, cursorAuthRaw: { workosId: "user_01XYZ" } })).toBe(`user_01XYZ%3A%3A${token}`);
    expect(webSessionToken({ accessToken: "opaque", workosId: "not-user" })).toBeNull();
    expect(webSessionToken({ workosId: "user_01XYZ" })).toBeNull();
    expect(webSessionToken(null)).toBeNull();
  });

  it("converts an exported array line by line and counts skipped accounts", () => {
    const one = jwt({ sub: "auth0|user_01ONE" });
    const two = jwt({ sub: "auth0|user_01TWO" });
    const result = webSessionTokensFromExport(JSON.stringify([{ accessToken: one }, { email: "no-token@example.invalid" }, { accessToken: two }]));
    expect(result).toEqual({ tokens: [`user_01ONE%3A%3A${one}`, `user_01TWO%3A%3A${two}`], skipped: 1 });
  });

  it("accepts a single exported object and tolerates invalid json", () => {
    const one = jwt({ sub: "auth0|user_01ONE" });
    expect(webSessionTokensFromExport(JSON.stringify({ accessToken: one }))).toEqual({ tokens: [`user_01ONE%3A%3A${one}`], skipped: 0 });
    expect(webSessionTokensFromExport("{not json")).toEqual({ tokens: [], skipped: 0 });
  });
});
