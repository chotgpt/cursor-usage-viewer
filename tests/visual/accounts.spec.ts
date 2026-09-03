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

const sand = (percent: number, accessGranted: boolean | null, grokPlanLabel: string | null, blockReason: string | null = null, periodSpendCents: number | null = null) => ({
  usagePercent: percent,
  hasAvailableUsage: true,
  hasNonZeroIncludedLimit: true,
  grokPlanLabel,
  currentPeriodStart: periodSpendCents == null ? null : "2026-08-25T09:00:00Z",
  periodSpendCents,
  periodSpendUpdatedAt: periodSpendCents == null ? null : 1788000000,
  periodSpendError: null,
  nextResetTimestampUtc: "2026-09-04T00:00:00Z",
  accessGranted,
  accessState: accessGranted === true ? "SAND_ACCESS_STATE_GRANTED" : accessGranted === false ? "SAND_ACCESS_STATE_BLOCKED" : null,
  blockReason,
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
    sand: sand(0, false, "Heavy Plan", "PAYWALL", 123456),
    auxiliaryErrors: [],
    lastError: null,
    lastErrorAt: null,
    createdAt: 6,
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
    sand: { ...sand(100, true, "Grok Bot Plan", null, 1234), nextResetTimestampUtc: "2026-08-31T09:00:00Z" },
    auxiliaryErrors: [],
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
    sand: { ...sand(0, null, null), nextResetTimestampUtc: null },
    auxiliaryErrors: [],
    lastError: null,
    lastErrorAt: null,
    createdAt: 5,
    lastUsed: 10,
  },
  {
    id: "cursor_usage_stale",
    email: "previous.usage.snapshot@example.invalid",
    authId: "auth0|user_STALE_USAGE",
    name: null,
    tags: ["Sand 用量请求失败后保留上次成功值"],
    membershipType: "pro_plus",
    subscriptionStatus: "active",
    signUpType: "Auth_0",
    status: null,
    statusReason: null,
    source: "cockpit-tools",
    hasAccessToken: true,
    hasRefreshToken: true,
    isCurrent: false,
    coreUsage: usage(36, 28, 14),
    sand: {
      ...sand(42, true, "Super Grok Long Plan Label For Layout Verification"),
      usageError: "Sand 用量（sand-usage）：HTTP 403",
    },
    auxiliaryErrors: [],
    lastError: null,
    lastErrorAt: null,
    createdAt: 4,
    lastUsed: 9,
  },
  {
    id: "cursor_access_stale",
    email: "access.status.not-updated@example.invalid",
    authId: "auth0|user_STALE_ACCESS",
    name: null,
    tags: ["资格端点部分失败"],
    membershipType: "pro",
    subscriptionStatus: "active",
    signUpType: "Auth_0",
    status: null,
    statusReason: null,
    source: "cockpit-tools",
    hasAccessToken: true,
    hasRefreshToken: true,
    isCurrent: false,
    coreUsage: usage(48, 31, 22),
    sand: {
      ...sand(65, true, "Grok Plan", null, 250),
      accessError: "Sand 资格（sand-access）：HTTP 403",
      periodSpendError: "周期消费（aggregated-usage）：HTTP 500",
    },
    auxiliaryErrors: [],
    lastError: null,
    lastErrorAt: null,
    createdAt: 3,
    lastUsed: 8,
  },
  {
    id: "cursor_core_403",
    email: "core.usage.failed@example.invalid",
    authId: "auth0|user_CORE_403",
    name: null,
    tags: ["核心额度失败，Sand 独立成功"],
    membershipType: "free",
    subscriptionStatus: "active",
    signUpType: "Auth_0",
    status: null,
    statusReason: null,
    source: "cockpit-tools",
    hasAccessToken: true,
    hasRefreshToken: true,
    isCurrent: false,
    coreUsage: { ...usage(18, 12, 8), error: "核心额度（usage-summary）：HTTP 403" },
    sand: sand(24, true, "Grok Plan"),
    auxiliaryErrors: [],
    lastError: "核心额度（usage-summary）：HTTP 403",
    lastErrorAt: 1788000000,
    createdAt: 2,
    lastUsed: 7,
  },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript((fixtureAccounts) => {
    Date.now = () => Date.parse("2026-08-31T09:38:00Z");
    let callbackId = 0;
    Object.defineProperty(window, "__VISUAL_ACCOUNTS__", { configurable: true, writable: true, value: fixtureAccounts });
    Object.defineProperty(window, "__VISUAL_MODE__", { configurable: true, writable: true, value: "success" });
    Object.defineProperty(window, "__VISUAL_VERSION_CHANGE__", { configurable: true, writable: true, value: null });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        transformCallback: (callback: (...args: unknown[]) => void) => {
          const id = ++callbackId;
          Object.defineProperty(window, `_${id}`, { configurable: true, value: callback });
          return id;
        },
        invoke: async (command: string, args?: { accountId?: string }) => {
          const currentAccounts = (window as typeof window & { __VISUAL_ACCOUNTS__: typeof fixtureAccounts }).__VISUAL_ACCOUNTS__;
          const mode = (window as typeof window & { __VISUAL_MODE__: string }).__VISUAL_MODE__;
          if (command === "list_cursor_accounts") return currentAccounts;
          if (command === "get_cursor_settings") return { schemaVersion: 1, autoRefreshMinutes: 10 };
          if (command === "get_update_settings") return { schemaVersion: 1, autoCheck: false, checkIntervalHours: 1, autoInstall: false, remindOnUpdate: true, lastCheckTime: 0, lastRunVersion: "", skippedVersion: "", pendingNotes: null };
          if (command === "consume_version_change") return (window as typeof window & { __VISUAL_VERSION_CHANGE__: unknown }).__VISUAL_VERSION_CHANGE__;
          if (command === "plugin:app|version") return "0.1.0";
           if (command === "plugin:event|listen") return 1;
           if (command === "plugin:dialog|save" && mode === "export_saved") return "C:\\Exports\\cursor-accounts.json";
          if (command === "refresh_cursor_account") {
            if (mode === "error") throw new Error("mock Cursor refresh failure");
            const account = currentAccounts.find((item) => item.id === args?.accountId) ?? currentAccounts[0];
            return mode === "partial" ? { ...account, sand: account.sand ? { ...account.sand, accessError: "Sand 资格（sand-access）：HTTP 403" } : null } : account;
          }
          if (command === "export_cursor_accounts") return JSON.stringify([{ id: "cursor_current", access_token: "visual.mock.token" }]);
          return null;
        },
      },
    });
  }, accounts);
});

test("bundles the Cockpit account-page typefaces", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  const loadedFontFamilies = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.status === "loaded")
      .map((face) => face.family.replaceAll('"', "").replaceAll("'", "")),
  );
  expect(loadedFontFamilies).toEqual(expect.arrayContaining(["Inter", "JetBrains Mono"]));
});

test("account cards use the Cockpit typography hierarchy", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("local.current@example.invalid")).toBeVisible();
  const typography = await page.locator(".ghcp-account-card").first().evaluate((card) => {
    const styleFor = (selector: string) => getComputedStyle(card.querySelector(selector)!);
    const email = styleFor(".account-email");
    const emailText = styleFor(".account-email > *");
    const percentage = styleFor(".quota-pct");
    const metadata = styleFor(".windsurf-credit-used");
    const date = styleFor(".card-date");
    const tag = styleFor(".tag-pill");
    const sandResetRelative = getComputedStyle(document.querySelector(".sand-reset-relative")!);
    return {
      email: [email.fontSize, email.fontWeight],
      emailTextWeight: emailText.fontWeight,
      percentage: [percentage.fontSize, percentage.fontWeight],
      metadata: [metadata.fontSize, metadata.fontFamily],
      date: [date.fontSize, date.color],
      tag: [tag.fontSize, tag.fontWeight],
      sandResetRelative: [sandResetRelative.fontSize, sandResetRelative.lineHeight],
    };
  });
  expect(typography).toEqual({
    email: ["14px", "600"],
    emailTextWeight: "600",
    percentage: ["13px", "700"],
    metadata: ["11px", expect.stringContaining("JetBrains Mono")],
    date: ["11px", "rgb(148, 163, 184)"],
    tag: ["11px", "500"],
    sandResetRelative: ["10.5px", "14px"],
  });
});

test("Cursor accounts dark desktop visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await expect(page.getByText("local.current@example.invalid")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".ghcp-account-card")).toHaveCount(6);
  await expect(page.locator(".ghcp-account-card").first()).toContainText("local.current@example.invalid");
  await expect(page.locator(".ghcp-account-card").first().locator(".quota-item")).toHaveCount(4);
  await expect(page.locator(".ghcp-account-card").first().locator(".sand-status-panel")).toHaveCount(1);
  await expect(page.locator(".ghcp-account-card").nth(0).locator(".sand-quota-ring-value")).toHaveText("100%");
  await expect(page.locator(".ghcp-account-card").nth(0).locator(".sand-quota-ring")).toContainText("本周期已用");
  await expect(page.locator(".ghcp-account-card").nth(0).locator(".sand-spend-row")).toHaveText("消费$12.34全模型");
  await expect(page.locator(".ghcp-account-card").nth(1).locator(".sand-spend-row")).toHaveText("消费$1234.56全模型");
  await expect(page.locator(".ghcp-account-card").nth(2).locator(".sand-spend-row")).toHaveText("消费—全模型");
  await expect(page.locator(".ghcp-account-card").nth(4).locator(".sand-spend-row")).toHaveText("上次消费$2.50全模型");
  await expect(page.locator(".ghcp-account-card").nth(0).locator(".sand-access-text")).toHaveText("可访问");
  await expect(page.locator(".ghcp-account-card").nth(0).locator(".sand-reset-row")).toContainText("重置待刷新");
  await expect(page.locator(".ghcp-account-card").nth(1).locator(".sand-access-text")).toHaveText("不可访问");
  await expect(page.locator(".ghcp-account-card").nth(1)).toContainText("访问受限 PAYWALL");
  const futureReset = page.locator(".ghcp-account-card").nth(1).locator(".sand-reset-row .sand-detail-value");
  expect(await futureReset.evaluate((element) => element.scrollWidth === element.clientWidth)).toBe(true);
  await expect(page.locator(".ghcp-account-card").nth(2).locator(".sand-plan-row")).toContainText("套餐未知");
  await expect(page.locator(".ghcp-account-card").nth(2).locator(".sand-access-text")).toHaveText("未知");
  await expect(page.locator(".ghcp-account-card").nth(3).locator(".sand-quota-ring-value")).toHaveText("42.0%");
  await expect(page.locator(".ghcp-account-card").nth(3).locator(".sand-quota-ring")).toContainText("上次已用");
  await expect(page.locator(".ghcp-account-card").nth(3)).toContainText("用量未更新");
  await expect(page.locator(".ghcp-account-card").nth(4).locator(".sand-access-text")).toHaveText("未更新");
  await expect(page.locator(".ghcp-account-card").nth(5)).toContainText("核心额度: HTTP 403");
  await expect(page).toHaveScreenshot("cursor-accounts-dark.png", { fullPage: true });
});

test("Cursor sort dropdown matches the Cockpit contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await expect(page.getByText("local.current@example.invalid")).toBeVisible();
  await page.getByRole("button", { name: "排序", exact: true }).click();
  const panel = page.locator(".single-filter-panel");
  await expect(panel.getByRole("button")).toHaveText([
    "按创建时间",
    "按剩余 Credits",
    "按配额周期结束时间",
  ]);
  await expect(page).toHaveScreenshot("cursor-accounts-sort-menu-dark.png", { fullPage: true });
});

test("Cursor Grok partial-failure and core-403 visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await expect(page.getByText("local.current@example.invalid")).toBeVisible();
  await page.locator(".main-wrapper").evaluate((main) => { main.scrollTop = main.scrollHeight; });
  await expect(page.getByText("previous.usage.snapshot@example.invalid")).toBeVisible();
  await expect(page.getByText("access.status.not-updated@example.invalid")).toBeVisible();
  await expect(page.getByText("core.usage.failed@example.invalid")).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-accounts-status-failures-dark.png", { fullPage: false });
});

test("Cursor Grok partial-failure light visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "light"));
  await page.goto("/");
  await page.locator(".main-wrapper").evaluate((main) => { main.scrollTop = main.scrollHeight; });
  await expect(page.getByText("previous.usage.snapshot@example.invalid")).toBeVisible();
  await expect(page.getByText("access.status.not-updated@example.invalid")).toBeVisible();
  await expect(page.getByText("core.usage.failed@example.invalid")).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-accounts-status-failures-light.png", { fullPage: false });
});

test("Cursor accounts light desktop visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "light"));
  await page.goto("/");
  await expect(page.getByText("local.current@example.invalid")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".ghcp-account-card")).toHaveCount(6);
  await expect(page.locator(".ghcp-account-card").first()).toContainText("local.current@example.invalid");
  await expect(page.locator(".ghcp-account-card").first().locator(".quota-item")).toHaveCount(4);
  await expect(page.locator(".sand-status-panel.incomplete")).toHaveCount(2);
  await expect(page).toHaveScreenshot("cursor-accounts-light.png", { fullPage: true });
});

test("Cursor accounts English dark visual contract", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __VISUAL_ACCOUNTS__: typeof accounts };
    state.__VISUAL_ACCOUNTS__ = state.__VISUAL_ACCOUNTS__.slice(0, 3).map((item, index) => ({
      ...item,
      tags: index === 0 ? ["work", "September reset"] : ["personal"],
    }));
    localStorage.setItem("cursor-language", "en");
    localStorage.setItem("cursor-theme", "dark");
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan filter" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Plan quota status" }).first().locator(".sand-reset-row")).toContainText("Needs refresh");
  const futureReset = page.getByRole("group", { name: "Plan quota status" }).nth(1).locator(".sand-reset-row");
  expect(await futureReset.locator(".sand-reset-relative").evaluate((element) => element.scrollWidth === element.clientWidth)).toBe(true);
  expect(await futureReset.locator(".sand-detail-value").evaluate((element) => getComputedStyle(element).fontSize)).toBe("13px");
  expect(await page.getByRole("group", { name: "Plan quota status" }).nth(1).locator(".sand-plan-row .sand-detail-value").evaluate((element) => getComputedStyle(element).fontSize)).toBe("14px");
  await expect(page).toHaveScreenshot("cursor-accounts-english-dark.png", { fullPage: true });
});

test("Cursor On-Demand cents render as dollars", async ({ page }) => {
  await page.addInitScript((fixtureAccounts) => {
    localStorage.setItem("cursor-theme", "dark");
    const first = fixtureAccounts[0];
    (window as typeof window & { __VISUAL_ACCOUNTS__: typeof fixtureAccounts }).__VISUAL_ACCOUNTS__ = [
      {
        ...first,
        coreUsage: {
          ...first.coreUsage,
          onDemand: { enabled: true, used: 12, limit: 100, remaining: 88, percentUsed: 12 },
        },
      },
    ];
  }, accounts);
  await page.goto("/");
  const card = page.locator(".ghcp-account-card").first();
  await expect(card).toContainText("$0.12 / $1.00");
  await expect(page).toHaveScreenshot("cursor-accounts-on-demand-currency-dark.png", { fullPage: false });
});

test("Cursor accounts 900 by 600 long Sand content remains readable", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.addInitScript(() => {
    const state = window as typeof window & { __VISUAL_ACCOUNTS__: typeof accounts };
    const narrowAccounts = state.__VISUAL_ACCOUNTS__.slice(3, 4);
    narrowAccounts[0] = { ...narrowAccounts[0], sand: { ...narrowAccounts[0].sand!, blockReason: "PAYWALL", accessError: "Sand 资格（sand-access）：HTTP 403" } };
    state.__VISUAL_ACCOUNTS__ = narrowAccounts;
    localStorage.setItem("cursor-theme", "dark");
  });
  await page.goto("/");
  const longPlan = page.getByText(/Super Grok Long Plan Label For Layout Verification/);
  await expect(longPlan).toBeVisible();
  await expect(page.getByText("上次受限原因 PAYWALL")).toBeVisible();
  await longPlan.scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot("cursor-accounts-900x600-long-sand-dark.png", { fullPage: false });
});

test("Cursor accounts list desktop visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "列表布局" }).click();
  await expect(page.getByRole("table", { name: "Cursor 账号列表" })).toBeVisible();
  await expect(page.locator(".table-sand-status")).toHaveCount(6);
  await expect(page.locator(".table-sand-status").first()).toContainText("100%");
  await expect(page.locator(".table-sand-status").first().locator(".table-sand-spend")).toHaveText("消费 $12.34 · 全模型");
  await expect(page.locator(".table-sand-status").nth(4).locator(".table-sand-spend")).toHaveText("上次消费 $2.50 · 全模型");
  await expect(page.locator(".table-sand-status").nth(3)).toContainText("用量未更新");
  await expect(page.locator(".table-sand-status").nth(4)).toContainText("资格未更新");
  const tableOverflow = await page.locator(".account-table-container").evaluate((container) => getComputedStyle(container).overflowX);
  expect(tableOverflow).toBe("auto");
  const longPlanLayout = await page.locator(".table-sand-plan").nth(3).evaluate((element) => ({
    fontSize: getComputedStyle(element).fontSize,
    whiteSpace: getComputedStyle(element).whiteSpace,
    lines: Math.round(element.scrollHeight / Number.parseFloat(getComputedStyle(element).lineHeight)),
    fullyVisible: element.clientHeight === element.scrollHeight,
  }));
  expect(longPlanLayout).toEqual({ fontSize: "10px", whiteSpace: "normal", lines: 3, fullyVisible: true });
  await expect(page).toHaveScreenshot("cursor-accounts-list-dark.png", { fullPage: true });
});

test("Cursor accounts 900 by 600 list keeps the Sand and action columns reachable", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "列表布局" }).click();
  const container = page.locator(".account-table-container");
  await expect(page.getByRole("table", { name: "Cursor 账号列表" })).toBeVisible();
  const dimensions = await container.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  await container.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(page.getByRole("button", { name: "删除 local.current@example.invalid" })).toBeVisible();
  await expect(page.locator(".table-sand-status").first()).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-accounts-900x600-list-dark.png", { fullPage: false });
});

test("Cursor English provider error visual contract", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __VISUAL_ACCOUNTS__: typeof accounts };
    state.__VISUAL_ACCOUNTS__ = [{ ...state.__VISUAL_ACCOUNTS__[0], lastError: "核心额度（usage-summary）：Cursor 响应超过安全大小限制" }];
    localStorage.setItem("cursor-language", "en");
    localStorage.setItem("cursor-theme", "dark");
  });
  await page.goto("/");
  await expect(page.getByText("Core usage: Request failed")).toBeVisible();
  await expect(page.getByText(/响应超过安全大小限制/)).toHaveCount(0);
  await expect(page).toHaveScreenshot("cursor-accounts-english-error-dark.png", { fullPage: false });
});

test("Cursor version-change dialog visual and keyboard contract", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __VISUAL_VERSION_CHANGE__: unknown }).__VISUAL_VERSION_CHANGE__ = {
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      notes: "Improved Cursor quota refresh diagnostics.",
    };
    localStorage.setItem("cursor-theme", "dark");
  });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "版本更新说明" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await expect(page).toHaveScreenshot("cursor-version-change-dialog-dark.png", { fullPage: false });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Cursor settings general dark visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("complementary").getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("combobox", { name: "主题" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "自动刷新额度" })).toHaveValue("10");
  await expect(page).toHaveScreenshot("cursor-settings-general-dark.png", { fullPage: false });
});

test("Cursor settings general light visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "light"));
  await page.goto("/");
  await page.getByRole("complementary").getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("combobox", { name: "主题" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "自动刷新额度" })).toHaveValue("10");
  await expect(page).toHaveScreenshot("cursor-settings-general-light.png", { fullPage: false });
});

test("Cursor settings about visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("complementary").getByRole("button", { name: "设置" }).click();
  await page.getByRole("tab", { name: "关于" }).click();
  await expect(page.getByText("v0.1.0 · CC BY-NC-SA 4.0")).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-settings-about-dark.png", { fullPage: false });
});

test("Cursor empty state visual contract", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __VISUAL_ACCOUNTS__: unknown[] }).__VISUAL_ACCOUNTS__ = [];
    localStorage.setItem("cursor-theme", "dark");
  });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "还没有账号" })).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-accounts-empty-dark.png", { fullPage: false });
});

test("Cursor no-match state visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "搜索邮箱、账号 ID、Auth ID、套餐、状态或标签" })
    .fill("no-such-account");
  await expect(page.getByText("没有匹配的账号")).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-accounts-no-match-dark.png", { fullPage: false });
});

test("Cursor success message visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "刷新 local.current@example.invalid" }).click();
  await expect(page.getByText("额度已更新")).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-accounts-success-dark.png", { fullPage: false, maxDiffPixels: 9_000, maxDiffPixelRatio: 0.009 });
});

test("Cursor Sand partial warning message visual contract", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __VISUAL_MODE__: string }).__VISUAL_MODE__ = "partial";
    localStorage.setItem("cursor-theme", "dark");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "刷新 local.current@example.invalid" }).click();
  await expect(page.getByText("核心额度已更新，Sand 数据未完全更新")).toBeVisible();
  await expect(page.locator(".message-bar.warning")).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-accounts-partial-warning-dark.png", { fullPage: false });
});

test("Cursor Sand partial warning message light visual contract", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __VISUAL_MODE__: string }).__VISUAL_MODE__ = "partial";
    localStorage.setItem("cursor-theme", "light");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "刷新 local.current@example.invalid" }).click();
  await expect(page.getByText("核心额度已更新，Sand 数据未完全更新")).toBeVisible();
  await expect(page.locator(".message-bar.warning")).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-accounts-partial-warning-light.png", { fullPage: false, maxDiffPixels: 7_000, maxDiffPixelRatio: 0.007 });
});

test("Cursor error message visual contract", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __VISUAL_MODE__: string }).__VISUAL_MODE__ = "error";
    localStorage.setItem("cursor-theme", "dark");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "刷新 local.current@example.invalid" }).click();
  await expect(page.getByText(/mock Cursor refresh failure/)).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-accounts-error-dark.png", { fullPage: false });
});

test("Cursor add-account web-login modal visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "添加账号" }).click();
  const dialog = page.getByRole("dialog", { name: "添加 Cursor 账号" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab")).toHaveText(["网页登录", "Token / JSON", "本机导入"]);
  await expect(dialog.getByRole("tab", { name: "网页登录" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveScreenshot("cursor-add-account-web-login-dark.png", { fullPage: false });
});

test("Cursor add-account token modal visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "添加账号" }).click();
  const dialog = page.getByRole("dialog", { name: "添加 Cursor 账号" });
  await dialog.getByRole("tab", { name: "Token / JSON" }).click();
  await expect(dialog.getByRole("textbox", { name: "Cursor Access Token 或 Cockpit JSON" })).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-add-account-token-dark.png", { fullPage: false });
});

test("Cursor export modal visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.locator(".toolbar-right").getByRole("button", { name: "导出" }).click();
  await expect(page.getByRole("dialog", { name: "完整账号 JSON" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "账号 JSON 预览" })).toHaveValue(/\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022/);
  await expect(page).toHaveScreenshot("cursor-export-modal-dark.png", { fullPage: false });
});

test("Cursor saved export actions visual contract", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cursor-theme", "dark");
    (window as typeof window & { __VISUAL_MODE__: string }).__VISUAL_MODE__ = "export_saved";
  });
  await page.goto("/");
  await page.locator(".toolbar-right").getByRole("button", { name: "导出" }).click();
  await page.getByRole("button", { name: "保存 JSON" }).click();
  await expect(page.getByText("C:\\Exports\\cursor-accounts.json")).toBeVisible();
  await expect(page.getByRole("button", { name: "打开保存位置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "复制路径" })).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-export-saved-modal-dark.png", { fullPage: false });
});

test("Cursor delete modal visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "删除 local.current@example.invalid" }).click();
  await expect(page.getByRole("dialog", { name: "删除本地账号？" })).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-delete-modal-dark.png", { fullPage: false });
});

test("Cursor add-account local-import modal light visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "light"));
  await page.goto("/");
  await page.getByRole("button", { name: "添加账号" }).click();
  const dialog = page.getByRole("dialog", { name: "添加 Cursor 账号" });
  await dialog.getByRole("tab", { name: "本机导入" }).click();
  await expect(dialog.getByRole("button", { name: "导入本机当前 Cursor 账号" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "选择 JSON 文件" })).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-add-account-local-light.png", { fullPage: false });
});

test("Cursor add-account English 900 by 600 visual contract", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.addInitScript(() => {
    localStorage.setItem("cursor-language", "en");
    localStorage.setItem("cursor-theme", "dark");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Add account" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Cursor account" });
  await dialog.getByRole("tab", { name: "Local import" }).click();
  await expect(dialog.getByRole("button", { name: "Import current Cursor account" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Choose JSON file" })).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-add-account-english-900x600-dark.png", { fullPage: false });
});

test("Cursor tag edit modal visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "编辑标签 local.current@example.invalid" }).click();
  await expect(page.getByRole("dialog", { name: "编辑账号标签" })).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-tag-edit-modal-dark.png", { fullPage: false });
});

test("Cursor batch delete modal visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("checkbox", { name: "全选当前页" }).click();
  await page.getByRole("button", { name: "删除选中" }).click();
  await expect(page.getByRole("dialog", { name: "删除 6 个本地账号？" })).toBeVisible();
  await expect(page).toHaveScreenshot("cursor-batch-delete-modal-dark.png", { fullPage: false });
});

test("Cursor tag-filtered grouping visual contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cursor-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "标签筛选" }).click();
  await page.getByRole("checkbox", { name: "网页失效" }).click();
  await page.getByRole("checkbox", { name: "按标签分组展示" }).click();
  await expect(page.locator(".tag-group-title", { hasText: "网页失效" })).toBeVisible();
  await expect(page.locator(".tag-group-title", { hasText: "8月31日重置" })).toHaveCount(0);
  await expect(page).toHaveScreenshot("cursor-accounts-tag-group-dark.png", { fullPage: false });
});

test("Cursor five-button toolbar matches Cockpit after capability mapping", async ({ page }) => {
  await page.addInitScript((fixtureAccounts) => {
    localStorage.setItem("cursor-theme", "dark");
    (window as typeof window & { __VISUAL_ACCOUNTS__: typeof fixtureAccounts }).__VISUAL_ACCOUNTS__ = [fixtureAccounts[0]];
  }, accounts);
  await page.goto("/");
  const buttons = page.locator(".toolbar-right > button");
  await expect(buttons).toHaveCount(5);
  expect(await buttons.evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")))).toEqual(["添加账号", "刷新全部", "隐藏邮箱", "导出", "设置"]);
  await expect(page).toHaveScreenshot("cursor-accounts-five-button-toolbar-dark.png", { fullPage: false });
});

test("Cursor account refresh keeps its rotating progress indicator visible while busy", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((fixtureAccounts) => {
    localStorage.setItem("cursor-theme", "dark");
    (window as typeof window & { __VISUAL_ACCOUNTS__: typeof fixtureAccounts }).__VISUAL_ACCOUNTS__ = [fixtureAccounts[0]];
  }, accounts);
  await page.goto("/");
  await page.evaluate(() => {
    const internals = (window as typeof window & {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command, args) => {
      if (command === "refresh_cursor_account") {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return (window as typeof window & { __VISUAL_ACCOUNTS__: typeof accounts }).__VISUAL_ACCOUNTS__[0];
      }
      return invoke(command, args);
    };
  });

  const refresh = page.getByRole("button", { name: "刷新 ocean.viewer@example.invalid" });
  await refresh.click();
  const spinner = refresh.locator(".loading-spinner");
  await expect(refresh).toBeDisabled();
  await expect(spinner).toHaveCSS("animation-name", "loading-spin");
  await expect(spinner).toHaveCSS("width", "20px");
  await expect(spinner).toHaveCSS("height", "20px");
  await expect(spinner).toHaveCSS("border-top-width", "2px");
  await page.waitForTimeout(300);
  expect(await refresh.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await spinner.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error("refresh spinner animation is missing");
    animation.pause();
    animation.currentTime = 200;
  });
  await expect(refresh).toHaveScreenshot("cursor-account-refresh-busy-dark.png");
});

test("Cursor privacy mode removes sensitive DOM and accessible names", async ({ page }) => {
  await page.addInitScript((fixtureAccounts) => {
    localStorage.setItem("cursor-theme", "dark");
    (window as typeof window & { __VISUAL_ACCOUNTS__: typeof fixtureAccounts }).__VISUAL_ACCOUNTS__ = [fixtureAccounts[0]];
  }, accounts);
  await page.goto("/");
  await page.getByRole("button", { name: "隐藏邮箱" }).click();
  await expect(page.locator("body")).not.toContainText("local.current@example.invalid");
  await expect(page.locator("body")).not.toContainText("auth0|user_N9X");
  await expect(page.getByRole("button", { name: /local\.current@example\.invalid/ })).toHaveCount(0);
  await expect(page).toHaveScreenshot("cursor-accounts-privacy-dark.png", { fullPage: false });
});
