import type { AccountSummary } from "./types";

export const mockAccount: AccountSummary = {
  id: "local-cursor",
  email: "you@example.com",
  membership: "Pro",
  signupType: "个人账号",
  tags: [],
  source: "cursor",
  isActive: true,
  hasAccessToken: true,
  hasRefreshToken: true,
};
