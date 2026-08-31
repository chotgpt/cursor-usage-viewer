import { expect, test } from "@playwright/test";

const usage = (total: number, auto: number, api: number, onDemand = false) => ({
  total: { enabled: true, used: total * 4, limit: 400, remaining: 400 - total * 4, percentUsed: total },
  autoComposer: { enabled: true, used: null, limit: null, remaining: null, percentUsed: auto },
  api: { enabled: true, used: null, limit: null, remaining: null, percentUsed: api },
  onDemand: { enabled: onDemand, used: onDemand ? 12 : 0, limit: onDemand ? 100 : null, remaining: onDemand ? 88 : null, percentUsed: onDemand ? 12 : null },
  billingCycleStart: "2026-08-20T00:00:00Z",
  billingCycleEnd: "2026-09-19T16:03:00Z",
  source: "live",
  updatedAt: 1788000000,
  error: null,
});

const sand = (percent: number, accessGranted: boolean) => ({
  usagePercent: percent,
  hasAvailableUsage: true,
  hasNonZeroIncludedLimit: true,
  grokPlanLabel: "Grok",
  currentPeriodStart: null,
  nextResetTimestampUtc: "2026-09-04T00:00:00Z",
  accessGranted,
  accessState: accessGranted ? "SAND_ACCESS_STATE_GRANTED" : "SAND_ACCESS_STATE_BLOCKED",
  blockReason: null,
  isPaidTrialPlan: false,
  proAndSuperGrokPlansGrantAccess: true,
  usageUpdatedAt: 1788000000,
  accessUpdatedAt: 1788000000,
  usageError: null,
  accessError: null,
});

const accounts = [
  {
    id: "cursor_pro",
    email: "ocean.viewer@example.invalid",
    authId: "auth0|user_8OC",
    name: null,
    tags: ["free绑定的grok", "09/05 重置"],
    membershipType: "pro",
    subscriptionStatus: "active",
    signUpType: "Auth_0",
    status: null,
    statusReason: null,
    source: "cockpit-tools",
    hasAccessToken: true,
    hasRefreshToken: true,
    isCurrent: false,
    coreUsage: usage(10, 1, 100),
    sand: sand(31, true),
    lastError: null,
    lastErrorAt: null,
    createdAt: 2,
    lastUsed: 30,
  },
  {
    id: "cursor_current",
    email: "local.current@example.invalid",
    authId: "auth0|user_N9X",
    name: null,
    tags: ["网页失效", "8月31日重置"],
    membershipType: "ultra",
    subscriptionStatus: "active",
    signUpType: "Auth_0",
    status: null,
    statusReason: null,
    source: "local-cursor",
    hasAccessToken: true,
    hasRefreshToken: true,
    isCurrent: true,
    coreUsage: usage(52, 44, 100),
    sand: sand(64.5, true),
    lastError: null,
    lastErrorAt: null,
    createdAt: 1,
    lastUsed: 20,
  },
  {
    id: "cursor_ultra",
    email: "rapid.account@example.invalid",
    authId: "auth0|user_YYS",
    name: null,
    tags: ["ultra auto 4", "09/02 重置"],
    membershipType: "ultra",
    subscriptionStatus: "active",
    signUpType: "Auth_0",
    status: null,
    statusReason: null,
    source: "cockpit-tools",
    hasAccessToken: true,
    hasRefreshToken: true,
    isCurrent: false,
    coreUsage: usage(15, 1, 100),
    sand: sand(0, false),
    lastError: null,
    lastErrorAt: null,
    createdAt: 3,
    lastUsed: 10,
  },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript((fixtureAccounts) => {
    let callbackId = 0;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        transformCallback: (callback: (...args: unknown[]) => void) => {
          const id = ++callbackId;
          Object.defineProperty(window, `_${id}`, { configurable: true, value: callback });
          return id;
        },
        invoke: async (command: string) => {
          if (command === "list_cursor_accounts") return fixtureAccounts;
          if (command === "get_update_settings") return { schemaVersion: 1, autoCheck: false, checkIntervalHours: 1, autoInstall: false, remindOnUpdate: true, lastCheckTime: 0, lastRunVersion: "", skippedVersion: "", pendingNotes: null };
          if (command === "consume_version_change") return null;
          if (command === "plugin:app|version") return "0.1.0";
          if (command === "plugin:event|listen") return 1;
          return null;
        },
      },
    });
  }, accounts);
});

test("Cursor accounts desktop visual contract", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("local.current@example.invalid")).toBeVisible();
  await expect(page.locator(".account-card")).toHaveCount(3);
  await expect(page.locator(".account-card").first()).toContainText("local.current@example.invalid");
  await expect(page).toHaveScreenshot("cursor-accounts.png", { fullPage: false });
});
