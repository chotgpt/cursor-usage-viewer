import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import App from "./App";
import type { CursorAccountView } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getBundleType: vi.fn(async () => "nsis"), getVersion: vi.fn(async () => "1.1.0") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-autostart", () => ({ disable: vi.fn(), enable: vi.fn(), isEnabled: vi.fn(async () => false) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);
let versionChange: { fromVersion: string; toVersion: string; notes: string } | null = null;
let listedAccounts: CursorAccountView[] = [];

function account(id = "cursor_one", email = "one@example.invalid"): CursorAccountView {
  return { id, email, authId: `auth0|${id}`, name: null, tags: ["500 credits"], membershipType: "pro", subscriptionStatus: "active", signUpType: "Auth_0", status: null, statusReason: null, source: "cockpit-tools", hasAccessToken: true, hasRefreshToken: true, isCurrent: false,
    coreUsage: { total: { enabled: true, used: 20, limit: 100, remaining: 80, percentUsed: 20 }, autoComposer: { enabled: true, used: null, limit: null, remaining: null, percentUsed: 11 }, api: { enabled: true, used: null, limit: null, remaining: null, percentUsed: 100 }, onDemand: { enabled: false, used: 0, limit: null, remaining: null, percentUsed: null }, billingCycleStart: "2026-08-20T00:00:00Z", billingCycleEnd: "2026-09-20T00:00:00Z", source: "live", updatedAt: 1788000000, error: null },
    sand: { usagePercent: 64.5, hasAvailableUsage: true, hasNonZeroIncludedLimit: true, grokPlanLabel: "Grok Bot Plan", currentPeriodStart: null, nextResetTimestampUtc: "2026-09-04T00:00:00Z", accessGranted: true, accessState: "SAND_ACCESS_STATE_GRANTED", blockReason: null, isPaidTrialPlan: false, proAndSuperGrokPlansGrantAccess: true, usageUpdatedAt: 1788000000, accessUpdatedAt: 1788000000, usageError: null, accessError: null },
    auxiliaryErrors: [], lastError: null, lastErrorAt: null, createdAt: 1, lastUsed: 2 };
}

describe("multi-account workspace", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    versionChange = null;
    listedAccounts = [account()];
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "list_cursor_accounts") return listedAccounts;
      if (command === "get_update_settings") return { schemaVersion: 1, autoCheck: false, checkIntervalHours: 1, autoInstall: false, remindOnUpdate: true, lastCheckTime: 0, lastRunVersion: "", skippedVersion: "", pendingNotes: null };
      if (command === "get_desktop_settings") return { schemaVersion: 1, closeBehavior: "ask", startMinimized: false, rememberWindow: false, windowX: null, windowY: null, windowWidth: null, windowHeight: null };
      if (command === "consume_version_change") return versionChange;
      if (command === "get_release_history") return [{ version: "0.1.0", date: "Unreleased", items: ["Cockpit parity fixes"] }];
      if (command === "refresh_cursor_account") return { ...account(), lastUsed: 3 };
      if (command === "import_cockpit_accounts_json") return [account("cursor_imported", "imported@example.invalid")];
      if (command === "export_cursor_accounts") return JSON.stringify([{ id: "cursor_one", access_token: "fake.secret.token" }]);
      if (command === "save_cursor_accounts_export" || command === "reveal_saved_cursor_accounts_export") return null;
      if (command === "update_cursor_account_tags") {
        const values = args as { accountId: string; tags: string[] };
        return { ...(listedAccounts.find((item) => item.id === values.accountId) ?? account()), tags: values.tags, lastUsed: 3 };
      }
      if (command === "delete_cursor_account" || command === "delete_cursor_accounts") return null;
      throw new Error(`unexpected command ${command} ${JSON.stringify(args)}`);
    });
  });
  afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); Reflect.deleteProperty(window, "matchMedia"); Reflect.deleteProperty(navigator, "clipboard"); vi.restoreAllMocks(); mockedInvoke.mockReset(); mockedSave.mockReset(); });

  it("restores local accounts on startup without reading or refreshing Cursor", async () => {
    const { container } = render(<App />);
    expect(await screen.findByText("one@example.invalid")).toBeVisible();
    const commands = mockedInvoke.mock.calls.map(([command]) => String(command));
    expect(commands).toContain("list_cursor_accounts");
    expect(commands).not.toContain("load_current_cursor_account");
    expect(commands).not.toContain("refresh_cursor_account");
    expect(document.body.textContent).not.toContain("fake.secret.token");
  });

  it("still renders when WebView local storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });

    render(<App />);

    expect(await screen.findByText("one@example.invalid")).toBeVisible();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("keeps the local current account first before applying the selected sort", async () => {
    listedAccounts = [
      { ...account("cursor_newest", "zulu@example.invalid"), lastUsed: 30 },
      { ...account("cursor_current", "middle@example.invalid"), isCurrent: true, lastUsed: 10 },
      { ...account("cursor_oldest", "alpha@example.invalid"), lastUsed: 1 },
    ];

    const { container } = render(<App />);
    await screen.findByText("middle@example.invalid");

    const visibleEmails = [...container.querySelectorAll(".account-card .identity strong")].map((node) => node.textContent);
    expect(visibleEmails).toEqual(["middle@example.invalid", "zulu@example.invalid", "alpha@example.invalid"]);
  });

  it("matches Cockpit's Cursor sort options, defaults, and comparison semantics", async () => {
    const withSortValues = (
      id: string,
      createdAt: number,
      percentUsed: number,
      billingCycleEnd: string | null,
      isCurrent = false,
    ): CursorAccountView => {
      const item = account(id, `${id}@example.invalid`);
      return {
        ...item,
        createdAt,
        isCurrent,
        coreUsage: {
          ...item.coreUsage!,
          total: { ...item.coreUsage!.total, percentUsed },
          billingCycleEnd,
        },
      };
    };
    listedAccounts = [
      withSortValues("alpha", 100, 5, "2026-09-10T00:00:00Z"),
      withSortValues("bravo", 300, 90, null),
      withSortValues("charlie", 200, 50, "2026-09-30T00:00:00Z"),
      withSortValues("current", 1, 99, null, true),
    ];
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("current@example.invalid");
    const visibleEmails = () => [...container.querySelectorAll(".account-card .identity strong")].map((node) => node.textContent);

    expect(visibleEmails()).toEqual([
      "current@example.invalid",
      "bravo@example.invalid",
      "charlie@example.invalid",
      "alpha@example.invalid",
    ]);

    await user.click(screen.getByRole("button", { name: "排序" }));
    const sortOptions = screen.getAllByRole("button").filter((button) => button.closest(".single-filter-panel"));
    expect(sortOptions.map((button) => button.textContent)).toEqual([
      "按创建时间",
      "按剩余 Credits",
      "按配额周期结束时间",
    ]);

    await user.click(screen.getByRole("button", { name: "按剩余 Credits" }));
    expect(visibleEmails()).toEqual([
      "current@example.invalid",
      "alpha@example.invalid",
      "charlie@example.invalid",
      "bravo@example.invalid",
    ]);

    await user.click(screen.getByRole("button", { name: "排序" }));
    await user.click(screen.getByRole("button", { name: "按配额周期结束时间" }));
    expect(visibleEmails()).toEqual([
      "current@example.invalid",
      "charlie@example.invalid",
      "alpha@example.invalid",
      "bravo@example.invalid",
    ]);

    await user.click(screen.getByRole("button", { name: "切换排序方向" }));
    expect(visibleEmails()).toEqual([
      "current@example.invalid",
      "alpha@example.invalid",
      "charlie@example.invalid",
      "bravo@example.invalid",
    ]);
  });

  it("renders the selected B2 percentage ring and right-side Sand details", async () => {
    const { container } = render(<App />);
    await screen.findByText("one@example.invalid");

    expect(container.querySelector(".side-nav.side-nav-classic")).toBeInTheDocument();
    expect(container.querySelector(".ghcp-accounts-page.cursor-accounts-page")).toBeInTheDocument();
    expect(container.querySelector(".ghcp-account-card")).toBeInTheDocument();
    expect(container.querySelectorAll(".ghcp-account-card .quota-item")).toHaveLength(4);
    const panel = screen.getByRole("group", { name: "套餐额度状态" });
    expect(panel).toHaveClass("sand-status-panel");
    expect(within(panel).queryByText("Grok / Sand")).not.toBeInTheDocument();
    expect(panel.querySelector(".sand-quota-ring")).toHaveStyle("--sand-progress: 64.5%");
    expect(panel.querySelector(".sand-quota-ring-value")).toHaveTextContent("64.5%");
    expect(panel.querySelector(".sand-plan-row")).toHaveTextContent("套餐Grok Bot Plan可访问");
    expect(panel.querySelector(".sand-plan-row .sand-access-text")).toHaveTextContent("可访问");
    expect(panel.querySelector(".sand-plan-row .sand-access-text")).toHaveAccessibleName("资格可访问");
    expect(panel.querySelector(".sand-plan-row .sand-access-badge")).not.toBeInTheDocument();
    expect(panel.querySelector(".sand-reset-row")).toHaveTextContent("重置");
    expect(screen.getByText("PRO")).toHaveClass("tier-badge", "pro");
    expect(screen.queryByText("pro")).not.toBeInTheDocument();
  });

  it("distinguishes unlimited, team-limited, and disabled On-Demand usage", async () => {
    const withOnDemand = (id: string, enabled: boolean | null, used: number, limit: number | null, limitType: string | null) => {
      const item = account(id, `${id}@example.invalid`);
      return { ...item, coreUsage: { ...item.coreUsage!, onDemand: { enabled, used, limit, remaining: limit == null ? null : limit - used, percentUsed: null }, onDemandLimitType: limitType } };
    };
    listedAccounts = [
      withOnDemand("unlimited", true, 12, null, "individual"),
      withOnDemand("team", null, 50, 200, "team"),
      withOnDemand("disabled", false, 0, null, null),
    ];

    const user = userEvent.setup();
    render(<App />);

    const unlimited = (await screen.findByText("unlimited@example.invalid")).closest("article")!;
    const team = screen.getByText("team@example.invalid").closest("article")!;
    const disabled = screen.getByText("disabled@example.invalid").closest("article")!;
    expect(within(unlimited).getByText("无限")).toBeVisible();
    expect(within(unlimited).getByText("$0.12")).toBeVisible();
    expect(within(team).getByText("25.0%")).toBeVisible();
    expect(within(team).getByText("$0.50 / $2.00")).toBeVisible();
    expect(within(disabled).getByText("已禁用")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "列表布局" }));
    expect(screen.getByRole("table", { name: "Cursor 账号列表" })).toHaveTextContent("$0.50 / $2.00");
  });

  it("does not leak untranslated provider diagnostics into the English UI", async () => {
    localStorage.setItem("cursor-language", "en");
    listedAccounts = [{ ...account(), lastError: "核心额度（usage-summary）：Cursor 响应超过安全大小限制" }];

    render(<App />);

    expect(await screen.findByText("Core usage: Request failed")).toBeVisible();
    expect(screen.queryByText(/响应超过安全大小限制/)).not.toBeInTheDocument();
  });

  it("maps supported Cursor plans to their Cockpit badge variants", async () => {
    listedAccounts = [
      { ...account("cursor_plus", "plus@example.invalid"), membershipType: "pro_plus" },
      { ...account("cursor_enterprise", "enterprise@example.invalid"), membershipType: "enterprise" },
      { ...account("cursor_student", "student@example.invalid"), membershipType: "pro_student" },
      { ...account("cursor_business", "business@example.invalid"), membershipType: "business", isEnterprise: false },
    ];
    render(<App />);
    expect(await screen.findByText("PRO+")).toHaveClass("tier-badge", "plus");
    expect(screen.getByText("ENTERPRISE")).toHaveClass("tier-badge", "enterprise");
    expect(within(screen.getByText("student@example.invalid").closest("article")!).getByText("PRO")).toHaveClass("tier-badge", "pro");
    expect(within(screen.getByText("business@example.invalid").closest("article")!).getByText("TEAM")).toHaveClass("tier-badge", "team");
  });

  it("presents a blocked Grok plan as an independent status with a neutral reset countdown", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 7, 31, 16, 38).getTime());
    const resetAt = new Date(2026, 8, 4, 17, 38).toISOString();
    listedAccounts = [{
      ...account(),
      sand: {
        ...account().sand!,
        grokPlanLabel: "Heavy Plan",
        accessGranted: false,
        accessState: "SAND_ACCESS_STATE_BLOCKED",
        blockReason: "PAYWALL",
        nextResetTimestampUtc: resetAt,
      },
    }];
    render(<App />);
    await screen.findByText("one@example.invalid");

    const details = screen.getByRole("group", { name: "套餐额度状态" });
    expect(details).not.toHaveTextContent("Grok / Sand");
    expect(details.querySelector(".sand-plan-row")).toHaveTextContent("套餐Heavy Plan不可访问");
    expect(details).toHaveTextContent("不可访问");
    expect(details).toHaveTextContent("访问受限 PAYWALL");
    expect(details.querySelector(".sand-reset-row")).toHaveTextContent("重置09-04 17:38约 4天 1小时");
    expect(screen.queryByText("有额度")).not.toBeInTheDocument();
  });

  it("treats an expired Sand reset timestamp as stale server data", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-31T09:38:00Z").getTime());
    listedAccounts = [{
      ...account(),
      sand: {
        ...account().sand!,
        usagePercent: 100,
        grokPlanLabel: "Grok Bot Plan",
        accessGranted: true,
        accessState: "SAND_ACCESS_STATE_GRANTED",
        nextResetTimestampUtc: "2026-08-31T09:00:00Z",
      },
    }];
    render(<App />);
    await screen.findByText("one@example.invalid");

    const details = screen.getByRole("group", { name: "套餐额度状态" });
    expect(details.querySelector(".sand-quota-ring-value")).toHaveTextContent("100.0%");
    expect(details.querySelector(".sand-quota-ring")).toHaveTextContent("本周期已用");
    expect(details).toHaveTextContent("可访问");
    expect(details.querySelector(".sand-reset-row")).toHaveTextContent("重置待刷新");
    expect(details).not.toHaveTextContent("可重置");
    expect(details).not.toHaveTextContent("2026-08-31 17:00");
  });

  it("formats a seconds-based Sand reset timestamp with the same instant used by the countdown", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-31T09:38:00Z").getTime());
    const resetSeconds = String(new Date("2026-09-04T09:38:00Z").getTime() / 1000);
    listedAccounts = [{
      ...account(),
      sand: {
        ...account().sand!,
        nextResetTimestampUtc: resetSeconds,
      },
    }];
    render(<App />);
    await screen.findByText("one@example.invalid");

    const details = screen.getByRole("group", { name: "套餐额度状态" });
    expect(details.querySelector(".sand-reset-row")).toHaveTextContent("重置09-04 17:38约 4天 0小时");
    expect(details).not.toHaveTextContent("1970");
  });

  it("formats a Sand reset countdown under one day as hours and minutes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-04T03:16:00Z").getTime());
    listedAccounts = [{
      ...account(),
      sand: {
        ...account().sand!,
        nextResetTimestampUtc: "2026-09-04T09:38:00Z",
      },
    }];
    render(<App />);
    await screen.findByText("one@example.invalid");

    const reset = screen.getByRole("group", { name: "套餐额度状态" }).querySelector(".sand-reset-row");
    expect(reset).toHaveTextContent("约 6时 22分钟");
    expect(reset).not.toHaveTextContent("6小时 22分");
  });

  it("marks the failed Sand source without discarding the other source", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-31T09:38:00Z").getTime());
    listedAccounts = [{
      ...account(),
      sand: {
        ...account().sand!,
        usagePercent: 42,
        grokPlanLabel: "Grok",
        accessGranted: true,
        blockReason: "PAYWALL",
        nextResetTimestampUtc: "2026-09-04T09:38:00Z",
        accessError: "Sand 资格端点：HTTP 403",
      },
    }];
    render(<App />);
    await screen.findByText("one@example.invalid");

    const details = screen.getByRole("group", { name: "套餐额度状态" });
    expect(details.querySelector(".sand-quota-ring-value")).toHaveTextContent("42.0%");
    expect(details.querySelector(".sand-quota-ring")).toHaveTextContent("本周期已用");
    expect(details).toHaveTextContent("未更新");
    expect(details).toHaveTextContent("上次受限原因 PAYWALL");
    expect(details.querySelector(".sand-reset-row")).toHaveTextContent("重置09-04 17:38约 4天 0小时");
    expect(details).not.toHaveTextContent("访问受限 PAYWALL");
    expect(details).not.toHaveTextContent("可访问");
  });

  it("marks the cached Sand plan as stale when the usage source fails", async () => {
    listedAccounts = [{
      ...account(),
      sand: {
        ...account().sand!,
        grokPlanLabel: "Grok",
        usageError: "Sand 用量端点：HTTP 403",
      },
    }];
    render(<App />);
    await screen.findByText("one@example.invalid");

    const details = screen.getByRole("group", { name: "套餐额度状态" });
    expect(details.querySelector(".sand-plan-row")).toHaveTextContent("上次套餐Grok");
    expect(details.querySelector(".sand-quota-ring")).toHaveClass("high", "stale");
    expect(details.querySelector(".sand-quota-ring")).toHaveAttribute("aria-label", "上次已用 64.5%");
    expect(within(details).queryByText(/^套餐$/)).not.toBeInTheDocument();
  });

  it("does not present Cursor's explicit NONE sentinel as a restriction", async () => {
    listedAccounts = [{ ...account(), sand: { ...account().sand!, blockReason: "SAND_ACCESS_BLOCK_REASON_NONE" } }];
    render(<App />);
    await screen.findByText("one@example.invalid");

    const details = screen.getByRole("group", { name: "套餐额度状态" });
    expect(details).not.toHaveTextContent("受限");
    expect(details).not.toHaveTextContent("SAND_ACCESS_BLOCK_REASON_NONE");
  });

  it("does not invent a Grok plan source when Cursor omits it", async () => {
    listedAccounts = [{ ...account(), sand: { ...account().sand!, grokPlanLabel: null, accessGranted: null, accessState: null, blockReason: null } }];
    render(<App />);
    await screen.findByText("one@example.invalid");

    const details = screen.getByRole("group", { name: "套餐额度状态" });
    expect(details.querySelector(".sand-plan-row")).toHaveTextContent("套餐未知");
    expect(details).toHaveTextContent("未知");
    expect(screen.queryByText(/Heavy|Frok/i)).not.toBeInTheDocument();
  });

  it("collapses the Cockpit account notice with an accessible button", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await screen.findByText("one@example.invalid");

    expect(screen.getByRole("note")).toBeVisible();
    const toggle = screen.getByRole("button", { name: "Cursor 账号管理说明（点击展开/收起）" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("账号凭据仅用于你主动发起的读取、导入、刷新和导出操作。")).toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("账号凭据仅用于你主动发起的读取、导入、刷新和导出操作。")).not.toBeInTheDocument();
    expect(localStorage.getItem("cursor-flow-notice-collapsed")).toBe("1");

    unmount();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Cursor 账号管理说明（点击展开/收起）" })).toHaveAttribute("aria-expanded", "false");
  });

  it("uses distinct icons for local account reading and JSON import", async () => {
    render(<App />);
    await screen.findByText("one@example.invalid");

    const readLocalButton = screen.getByRole("button", { name: "读取本机账号" });
    const importButton = screen.getByRole("button", { name: "粘贴导入" });
    expect(readLocalButton.querySelector(".lucide-hard-drive-download")).toBeInTheDocument();
    expect(importButton.querySelector(".lucide-download")).toBeInTheDocument();
  });

  it("offers real local-read and paste-import actions in the empty state", async () => {
    listedAccounts = [];
    render(<App />);

    const emptyState = await screen.findByRole("region", { name: "还没有账号" });
    expect(within(emptyState).getByRole("button", { name: "读取本机账号" })).toBeVisible();
    expect(within(emptyState).getByRole("button", { name: "粘贴导入" })).toBeVisible();
  });

  it("filters memberships with the Cockpit multi-select dropdown", async () => {
    listedAccounts = [
      { ...account("cursor_pro", "pro@example.invalid"), membershipType: "pro" },
      { ...account("cursor_ultra", "ultra@example.invalid"), membershipType: "ultra" },
    ];
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("pro@example.invalid");

    await user.click(screen.getByRole("button", { name: "套餐筛选" }));
    await user.click(screen.getByRole("checkbox", { name: "PRO (1)" }));
    expect(screen.getByText("pro@example.invalid")).toBeVisible();
    expect(screen.queryByText("ultra@example.invalid")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "ULTRA (1)" }));
    expect(await screen.findByText("ultra@example.invalid")).toBeVisible();
  });

  it("groups only by tags that match the active tag filter", async () => {
    listedAccounts = [
      { ...account("cursor_work", "work@example.invalid"), tags: ["work", "paid"] },
      { ...account("cursor_paid", "paid@example.invalid"), tags: ["paid"] },
    ];
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("work@example.invalid");

    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    await user.click(screen.getByRole("checkbox", { name: "work" }));
    await user.click(screen.getByRole("checkbox", { name: "按标签分组展示" }));

    expect(screen.getByText("work", { selector: ".tag-group-title" })).toBeVisible();
    expect(screen.queryByText("paid", { selector: ".tag-group-title" })).not.toBeInTheDocument();
    expect(screen.queryByText("paid@example.invalid")).not.toBeInTheDocument();
  });

  it("normalizes tag casing before building Cockpit groups", async () => {
    listedAccounts = [
      { ...account("cursor_work_upper", "upper@example.invalid"), tags: ["Work"] },
      { ...account("cursor_work_lower", "lower@example.invalid"), tags: ["work"] },
    ];
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("upper@example.invalid");

    await user.click(screen.getByRole("button", { name: "标签筛选" }));
    await user.click(screen.getByRole("checkbox", { name: "按标签分组展示" }));

    expect(screen.getAllByText("work", { selector: ".tag-group-title" })).toHaveLength(1);
    expect(screen.getByText("work", { selector: ".tag-group-title" }).parentElement).toHaveTextContent("2");
  });

  it("does not render factual quota values when no core snapshot exists", async () => {
    listedAccounts = [{ ...account(), coreUsage: null }];
    render(<App />);
    const card = await screen.findByText("one@example.invalid");
    expect(card.closest("article")).toHaveTextContent("暂无额度数据");
    expect(card.closest("article")).not.toHaveTextContent("已禁用");
  });

  it("edits account tags through the persisted backend command", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("one@example.invalid");

    await user.click(screen.getByRole("button", { name: "编辑标签 one@example.invalid" }));
    const dialog = screen.getByRole("dialog", { name: "编辑账号标签" });
    const input = within(dialog).getByRole("textbox", { name: "账号标签" });
    await user.clear(input);
    await user.type(input, "Work, paid");
    await user.click(within(dialog).getByRole("button", { name: "保存标签" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("update_cursor_account_tags", { accountId: "cursor_one", tags: ["Work", "paid"] }));
    expect(await screen.findByText("Work")).toBeVisible();
  });

  it("confirms batch deletion before removing account files and backups", async () => {
    listedAccounts = [account("cursor_one", "one@example.invalid"), account("cursor_two", "two@example.invalid")];
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("one@example.invalid");

    await user.click(screen.getByRole("checkbox", { name: "全选当前页" }));
    await user.click(screen.getByRole("button", { name: "删除选中" }));
    const dialog = screen.getByRole("dialog", { name: "删除 2 个本地账号？" });
    expect(dialog).toHaveTextContent("对应 .bak 将从本机删除");
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("delete_cursor_accounts", { accountIds: ["cursor_one", "cursor_two"] }));
    expect(screen.queryByText("one@example.invalid")).not.toBeInTheDocument();
    expect(screen.queryByText("two@example.invalid")).not.toBeInTheDocument();
  });

  it("traps modal focus and restores it to the triggering control", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("one@example.invalid");
    const opener = screen.getByRole("button", { name: "粘贴导入" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "粘贴 Cockpit JSON" });
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    cancel.focus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "关闭" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "粘贴 Cockpit JSON" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps selection controls in one Cockpit toolbar", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("checkbox", { name: "选择 one@example.invalid" }));

    expect(container.querySelectorAll(".account-selection-toolbar")).toHaveLength(1);
    expect(container.querySelector(".list-head")).not.toBeInTheDocument();
    expect(screen.getByText("已选 1")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "全选当前页" })).toBeVisible();
  });

  it("renders the Cockpit account table in list mode", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("button", { name: "列表布局" }));

    expect(screen.getByRole("table", { name: "Cursor 账号列表" })).toBeVisible();
    expect(container.querySelector(".ghcp-account-card")).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /one@example.invalid/ })).toBeVisible();
    const updatedAt = container.querySelector(".table-updated");
    expect(updatedAt?.querySelector(".table-updated-date")?.textContent).toBeTruthy();
    expect(updatedAt?.querySelector(".table-updated-time")?.textContent).toBeTruthy();
  });

  it("uses the same quota fallback and split reset timestamp in list mode", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-31T09:38:00Z").getTime());
    const resetAt = "2026-09-04T09:38:00Z";
    listedAccounts = [{
      ...account(),
      coreUsage: {
        ...account().coreUsage!,
        total: { ...account().coreUsage!.total, percentUsed: null },
      },
      sand: { ...account().sand!, nextResetTimestampUtc: resetAt },
    }];
    const reset = new Date(resetAt);
    const pad = (value: number) => String(value).padStart(2, "0");
    const expectedDate = `${reset.getFullYear()}-${pad(reset.getMonth() + 1)}-${pad(reset.getDate())}`;
    const expectedTime = `${pad(reset.getHours())}:${pad(reset.getMinutes())}`;
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("button", { name: "列表布局" }));

    const row = screen.getByRole("row", { name: /one@example.invalid/ });
    expect(within(row).getByText("20.0%")).toBeVisible();
    const freshness = container.querySelector(".table-sand-freshness");
    expect(freshness?.querySelectorAll("span")).toHaveLength(2);
    expect(freshness).toHaveTextContent(expectedDate);
    expect(freshness).toHaveTextContent(expectedTime);
  });

  it("marks a failed core usage snapshot in list mode", async () => {
    const user = userEvent.setup();
    listedAccounts = [{
      ...account(),
      lastError: "核心额度（usage-summary）：Cursor 官方端点返回了 HTTP 403",
      coreUsage: {
        ...account().coreUsage!,
        error: "核心额度（usage-summary）：Cursor 官方端点返回了 HTTP 403",
      },
    }];
    render(<App />);
    await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("button", { name: "列表布局" }));

    expect(screen.getByText("核心额度 HTTP 403")).toBeVisible();
  });

  it("keeps the Sand block reason visible in list mode", async () => {
    const user = userEvent.setup();
    listedAccounts = [{
      ...account(),
      sand: {
        ...account().sand!,
        accessGranted: false,
        accessState: "SAND_ACCESS_STATE_BLOCKED",
        blockReason: "PAYWALL",
      },
    }];
    render(<App />);
    await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("button", { name: "列表布局" }));

    expect(screen.getByText("访问受限 PAYWALL")).toBeVisible();
  });

  it("uses the Cockpit pagination dropdown", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("one@example.invalid");

    await user.click(screen.getByRole("button", { name: "每页 20" }));
    await user.click(screen.getByRole("button", { name: "50 / 页" }));
    expect(localStorage.getItem("cursor-page-size")).toBe("50");
    expect(screen.getByText("1 - 1，共 1 个账号")).toBeVisible();
  });

  it("switches real Cockpit settings tabs", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("button", { name: /设置$/ }));
    expect(screen.getByRole("combobox", { name: "主题" })).toBeVisible();

    expect(screen.getByRole("tablist", { name: "设置类别" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "常规" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "关于" }));
    expect(screen.getByRole("tab", { name: "关于" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "关于" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "主题" })).not.toBeInTheDocument();
    expect(screen.getByText("v1.1.0 · CC BY-NC-SA 4.0")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "版本历史" }));
    const history = await screen.findByRole("dialog", { name: "版本历史" });
    expect(within(history).getByText("v0.1.0")).toBeVisible();
    expect(within(history).getByText("Cockpit parity fixes")).toBeVisible();
  });

  it("refreshes on the first click without a confirmation", async () => {
    const user = userEvent.setup(); render(<App />);
    const button = await screen.findByRole("button", { name: "刷新 one@example.invalid" });
    await user.click(button);
    expect(screen.queryByRole("dialog", { name: /刷新/ })).not.toBeInTheDocument();
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("refresh_cursor_account", { accountId: "cursor_one" }));
    expect(await screen.findByText("额度已更新")).toBeVisible();
  });

  it("does not report success when the core usage stage failed", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "list_cursor_accounts") return listedAccounts;
      if (command === "get_update_settings") return { schemaVersion: 1, autoCheck: false, checkIntervalHours: 1, autoInstall: false, remindOnUpdate: true, lastCheckTime: 0, lastRunVersion: "", skippedVersion: "", pendingNotes: null };
      if (command === "consume_version_change") return null;
      if (command === "refresh_cursor_account") return { ...account(), lastError: "核心额度（usage-summary）：Cursor 官方端点返回了 HTTP 403" };
      throw new Error(`unexpected command ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "刷新 one@example.invalid" }));

    expect(await screen.findByText("核心额度刷新失败：HTTP 403")).toBeVisible();
    expect(screen.queryByText("额度已更新")).not.toBeInTheDocument();
  });

  it("uses a warning message when only Sand data is partially refreshed", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "list_cursor_accounts") return listedAccounts;
      if (command === "get_update_settings") return { schemaVersion: 1, autoCheck: false, checkIntervalHours: 1, autoInstall: false, remindOnUpdate: true, lastCheckTime: 0, lastRunVersion: "", skippedVersion: "", pendingNotes: null };
      if (command === "consume_version_change") return null;
      if (command === "refresh_cursor_account") return { ...account(), sand: { ...account().sand!, accessError: "Sand 资格端点：HTTP 403" } };
      throw new Error(`unexpected command ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "刷新 one@example.invalid" }));

    expect(await screen.findByText("核心额度已更新，Sand 数据未完全更新")).toHaveClass("message-bar", "warning");
  });

  it("keeps core success while surfacing optional account-metadata failures", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "list_cursor_accounts") return [account()];
      if (command === "get_update_settings") return { schemaVersion: 1, autoCheck: false, checkIntervalHours: 1, autoInstall: false, remindOnUpdate: true, lastCheckTime: 0, lastRunVersion: "", skippedVersion: "", pendingNotes: null };
      if (command === "consume_version_change") return null;
      if (command === "refresh_cursor_account") return { ...account(), auxiliaryErrors: ["订阅资料（full-stripe-profile）：HTTP 403"] };
      throw new Error(`unexpected command ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("one@example.invalid");

    await user.click(screen.getByRole("button", { name: "刷新 one@example.invalid" }));

    expect(await screen.findByText("核心额度已更新，账号资料未完全更新")).toBeVisible();
    expect(screen.queryByText(/核心额度刷新失败/)).not.toBeInTheDocument();
    expect(screen.getByText(/订阅资料: HTTP 403/)).toBeVisible();
  });

  it("reports core failures and partial Sand refreshes together in a batch", async () => {
    listedAccounts = [account("cursor_core", "core@example.invalid"), account("cursor_sand", "sand@example.invalid")];
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "list_cursor_accounts") return listedAccounts;
      if (command === "get_update_settings") return { schemaVersion: 1, autoCheck: false, checkIntervalHours: 1, autoInstall: false, remindOnUpdate: true, lastCheckTime: 0, lastRunVersion: "", skippedVersion: "", pendingNotes: null };
      if (command === "consume_version_change") return null;
      if (command === "refresh_cursor_accounts") return [
        { accountId: "cursor_core", result: { ...listedAccounts[0], lastError: "核心额度（usage-summary）：HTTP 403" }, error: null },
        { accountId: "cursor_sand", result: { ...listedAccounts[1], sand: { ...listedAccounts[1].sand!, usageError: "Sand 用量（sand-usage）：HTTP 403" } }, error: null },
      ];
      throw new Error(`unexpected command ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "刷新全部" }));

    expect(await screen.findByText("刷新完成，1 个账号核心额度失败，1 个账号的 Sand 数据未完全更新")).toHaveClass("message-bar", "error");
  });

  it("keeps Cockpit refresh-all independent from a running single-account refresh", async () => {
    let finishSingle: ((value: CursorAccountView) => void) | undefined;
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "list_cursor_accounts") return listedAccounts;
      if (command === "get_update_settings") return { schemaVersion: 1, autoCheck: false, checkIntervalHours: 1, autoInstall: false, remindOnUpdate: true, lastCheckTime: 0, lastRunVersion: "", skippedVersion: "", pendingNotes: null };
      if (command === "consume_version_change") return null;
      if (command === "refresh_cursor_account") return new Promise<CursorAccountView>((resolve) => { finishSingle = resolve; });
      if (command === "refresh_cursor_accounts") return [{ accountId: "cursor_one", result: account(), error: null }];
      throw new Error(`unexpected command ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "刷新 one@example.invalid" }));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("refresh_cursor_account", { accountId: "cursor_one" }));
    await user.click(screen.getByRole("button", { name: "刷新全部" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("refresh_cursor_accounts", { accountIds: ["cursor_one"] }));
    finishSingle?.(account());
  });

  it("dismisses the Cockpit message bar", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "刷新 one@example.invalid" }));
    expect(await screen.findByText("额度已更新")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "关闭消息" }));
    expect(screen.queryByText("额度已更新")).not.toBeInTheDocument();
  });

  it("clears pasted JSON immediately after one-step multi-account import", async () => {
    const user = userEvent.setup(); render(<App />); await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("button", { name: "粘贴导入" }));
    const input = screen.getByRole("textbox", { name: "Cockpit Tools JSON" });
    const payload = '[{"email":"imported@example.invalid","access_token":"a.b.c"}]';
    await user.click(input); await user.paste(payload); await user.click(screen.getByRole("button", { name: "导入" }));
    expect(screen.queryByRole("textbox", { name: "Cockpit Tools JSON" })).not.toBeInTheDocument();
    expect(await screen.findByText("imported@example.invalid")).toBeVisible();
    expect(mockedInvoke).toHaveBeenCalledWith("import_cockpit_accounts_json", { payload });
    expect(document.body.textContent).not.toContain("a.b.c");
  });

  it("clears sensitive import text and keeps the dialog target on failure", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "list_cursor_accounts") return listedAccounts;
      if (command === "get_update_settings") return { schemaVersion: 1, autoCheck: false, checkIntervalHours: 1, autoInstall: false, remindOnUpdate: true, lastCheckTime: 0, lastRunVersion: "", skippedVersion: "", pendingNotes: null };
      if (command === "get_desktop_settings") return { schemaVersion: 1, closeBehavior: "ask", startMinimized: false, rememberWindow: false, windowX: null, windowY: null, windowWidth: null, windowHeight: null };
      if (command === "consume_version_change") return null;
      if (command === "import_cockpit_accounts_json") throw new Error("invalid account");
      throw new Error(`unexpected command ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "粘贴导入" }));
    const dialog = screen.getByRole("dialog", { name: "粘贴 Cockpit JSON" });
    const input = within(dialog).getByRole("textbox", { name: "Cockpit Tools JSON" });
    await user.type(input, "secret-token-text");
    await user.click(within(dialog).getByRole("button", { name: "导入" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("invalid account");
    expect(input).toHaveValue("");
    expect(document.body.textContent).not.toContain("secret-token-text");
  });

  it("opens a sensitive export in masked mode", async () => {
    const user = userEvent.setup(); render(<App />); await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("button", { name: "导出" }));
    const dialog = await screen.findByRole("dialog", { name: "完整账号 JSON" });
    const preview = screen.getByRole("textbox", { name: "账号 JSON 预览" });
    expect((preview as HTMLTextAreaElement).value).toContain("••••••••");
    expect((preview as HTMLTextAreaElement).value).not.toContain("fake.secret.token");
    await user.click(screen.getByRole("button", { name: "显示" }));
    expect((preview as HTMLTextAreaElement).value).toContain("fake.secret.token");
    expect(dialog).toHaveClass("export-json-modal");
  });

  it("limits saved-path actions to successful exports and resets copied feedback on resave", async () => {
    mockedSave.mockResolvedValueOnce("C:\\Exports\\first.json").mockResolvedValueOnce("C:\\Exports\\second.json");
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { container } = render(<App />);
    await screen.findByText("one@example.invalid");
    await user.click(within(container.querySelector(".toolbar-right") as HTMLElement).getByRole("button", { name: "导出" }));

    await user.click(screen.getByRole("button", { name: "保存 JSON" }));
    expect(await screen.findByText("C:\\Exports\\first.json")).toBeVisible();
    expect(mockedInvoke).toHaveBeenCalledWith("save_cursor_accounts_export", {
      accountIds: ["cursor_one"],
      path: "C:\\Exports\\first.json",
    });

    await user.click(screen.getByRole("button", { name: "复制路径" }));
    expect(writeText).toHaveBeenCalledWith("C:\\Exports\\first.json");
    expect(screen.getByRole("button", { name: "路径已复制" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "保存 JSON" }));
    expect(await screen.findByText("C:\\Exports\\second.json")).toBeVisible();
    expect(screen.getByRole("button", { name: "复制路径" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "打开保存位置" }));
    expect(mockedInvoke).toHaveBeenCalledWith("reveal_saved_cursor_accounts_export", {
      path: "C:\\Exports\\second.json",
    });
  });

  it("exports the filtered scope when selected accounts are outside that scope", async () => {
    listedAccounts = [
      { ...account("cursor_pro", "pro@example.invalid"), membershipType: "pro" },
      { ...account("cursor_ultra", "ultra@example.invalid"), membershipType: "ultra" },
    ];
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("pro@example.invalid");
    await user.click(screen.getByRole("checkbox", { name: "选择 pro@example.invalid" }));
    await user.click(screen.getByRole("button", { name: "套餐筛选" }));
    await user.click(screen.getByRole("checkbox", { name: "ULTRA (1)" }));
    await user.click(within(container.querySelector(".toolbar-right") as HTMLElement).getByRole("button", { name: "导出" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("export_cursor_accounts", { accountIds: ["cursor_ultra"] }));
  });

  it("marks destructive modal actions as the primary danger action", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "删除 one@example.invalid" }));

    const dialog = await screen.findByRole("dialog", { name: "删除本地账号？" });
    expect(within(dialog).getByRole("button", { name: "删除" })).toHaveClass("btn", "btn-danger");
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveClass("btn", "btn-secondary");
  });

  it("applies and persists the selected color theme", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("one@example.invalid");

    await user.click(screen.getByRole("button", { name: /设置$/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "主题" }), "dark");

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("cursor-theme")).toBe("dark");
  });

  it("tracks operating-system color changes while using the system theme", async () => {
    let prefersDark = false;
    let onChange: (() => void) | undefined;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        get matches() { return prefersDark; },
        addEventListener: (_type: string, listener: () => void) => { onChange = listener; },
        removeEventListener: vi.fn(),
      })),
    });
    localStorage.setItem("cursor-theme", "system");

    render(<App />);
    await screen.findByText("one@example.invalid");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    prefersDark = true;
    act(() => onChange?.());
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("shows the saved release notes once after an upgrade", async () => {
    versionChange = { fromVersion: "1.0.0", toVersion: "1.1.0", notes: "Improved signed updates" };
    const user = userEvent.setup();
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "版本更新说明" });
    expect(dialog).toHaveTextContent("1.0.0 → 1.1.0");
    expect(dialog).toHaveTextContent("Improved signed updates");
    await user.click(screen.getByRole("button", { name: "知道了" }));
    expect(screen.queryByRole("dialog", { name: "版本更新说明" })).not.toBeInTheDocument();
  });

  it("matches the five-button Cockpit toolbar contract", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText("one@example.invalid");
    expect([...container.querySelectorAll<HTMLButtonElement>(".toolbar-right > button")].map((button) => button.getAttribute("aria-label"))).toEqual(["读取本机账号", "刷新全部", "隐藏邮箱", "粘贴导入", "导出"]);
    await user.click(screen.getByRole("checkbox", { name: "选择 one@example.invalid" }));
    expect(screen.getByRole("button", { name: "导出 (1)" })).toBeVisible();
  });

  it("replaces sensitive DOM and accessible names in persisted privacy mode", async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<App />);
    await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("button", { name: "隐藏邮箱" }));
    expect(container.textContent).not.toContain("one@example.invalid");
    expect(container.textContent).not.toContain("auth0|cursor_one");
    expect(screen.queryByRole("button", { name: /one@example\.invalid/ })).not.toBeInTheDocument();
    expect(localStorage.getItem("cursor-usage-viewer.privacy-mode-enabled")).toBe("1");
    unmount();
    render(<App />);
    expect(await screen.findByRole("button", { name: "显示邮箱" })).toBeVisible();
    expect(document.body.textContent).not.toContain("one@example.invalid");
  });

  it("searches the same account id, plan and subscription fields as Cockpit", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("one@example.invalid");
    const search = screen.getByRole("textbox", { name: /搜索/ });
    await user.type(search, "cursor_one");
    expect(screen.getByText("one@example.invalid")).toBeVisible();
    await user.clear(search); await user.type(search, "active");
    expect(screen.getByText("one@example.invalid")).toBeVisible();
  });

  it("formats Total Usage cents and surfaces persisted account status", async () => {
    listedAccounts = [{ ...account(), status: "banned", statusReason: "suspended" }];
    const { container } = render(<App />);
    await screen.findByText("one@example.invalid");
    expect(screen.getByText("$0.20 / $1.00")).toBeVisible();
    expect(screen.getAllByText("已禁用").length).toBeGreaterThan(0);
    expect(container.querySelector(".account-card")).toHaveClass("disabled");
  });
});
