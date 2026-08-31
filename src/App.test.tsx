import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { CursorAccountView } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getBundleType: vi.fn(async () => "nsis"), getVersion: vi.fn(async () => "1.1.0") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
let versionChange: { fromVersion: string; toVersion: string; notes: string } | null = null;
let listedAccounts: CursorAccountView[] = [];

function account(id = "cursor_one", email = "one@example.invalid"): CursorAccountView {
  return { id, email, authId: `auth0|${id}`, name: null, tags: ["500 credits"], membershipType: "pro", subscriptionStatus: "active", signUpType: "Auth_0", status: null, statusReason: null, source: "cockpit-tools", hasAccessToken: true, hasRefreshToken: true, isCurrent: false,
    coreUsage: { total: { enabled: true, used: 20, limit: 100, remaining: 80, percentUsed: 20 }, autoComposer: { enabled: true, used: null, limit: null, remaining: null, percentUsed: 11 }, api: { enabled: true, used: null, limit: null, remaining: null, percentUsed: 100 }, onDemand: { enabled: false, used: 0, limit: null, remaining: null, percentUsed: null }, billingCycleStart: "2026-08-20T00:00:00Z", billingCycleEnd: "2026-09-20T00:00:00Z", source: "live", updatedAt: 1788000000, error: null },
    sand: { usagePercent: 64.5, hasAvailableUsage: true, hasNonZeroIncludedLimit: true, grokPlanLabel: "Grok", currentPeriodStart: null, nextResetTimestampUtc: "2026-09-04T00:00:00Z", accessGranted: true, accessState: "SAND_ACCESS_STATE_GRANTED", blockReason: null, isPaidTrialPlan: false, proAndSuperGrokPlansGrantAccess: true, usageUpdatedAt: 1788000000, accessUpdatedAt: 1788000000, usageError: null, accessError: null },
    lastError: null, lastErrorAt: null, createdAt: 1, lastUsed: 2 };
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
      if (command === "consume_version_change") return versionChange;
      if (command === "refresh_cursor_account") return { ...account(), lastUsed: 3 };
      if (command === "import_cockpit_accounts_json") return [account("cursor_imported", "imported@example.invalid")];
      if (command === "export_cursor_accounts") return JSON.stringify([{ id: "cursor_one", access_token: "fake.secret.token" }]);
      throw new Error(`unexpected command ${command} ${JSON.stringify(args)}`);
    });
  });
  afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); Reflect.deleteProperty(window, "matchMedia"); mockedInvoke.mockReset(); });

  it("restores local accounts on startup without reading or refreshing Cursor", async () => {
    render(<App />);
    expect(await screen.findByText("one@example.invalid")).toBeVisible();
    const commands = mockedInvoke.mock.calls.map(([command]) => String(command));
    expect(commands).toContain("list_cursor_accounts");
    expect(commands).not.toContain("load_current_cursor_account");
    expect(commands).not.toContain("refresh_cursor_account");
    expect(document.body.textContent).not.toContain("fake.secret.token");
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

  it("renders the Cockpit-derived classic shell and five quota groups", async () => {
    const { container } = render(<App />);
    await screen.findByText("one@example.invalid");

    expect(container.querySelector(".side-nav.side-nav-classic")).toBeInTheDocument();
    expect(container.querySelector(".ghcp-accounts-page.cursor-accounts-page")).toBeInTheDocument();
    expect(container.querySelector(".ghcp-account-card")).toBeInTheDocument();
    expect(container.querySelectorAll(".ghcp-account-card .quota-item")).toHaveLength(5);
    expect(screen.getByText("Grok / Sand")).toBeVisible();
  });

  it("refreshes on the first click without a confirmation", async () => {
    const user = userEvent.setup(); render(<App />);
    const button = await screen.findByRole("button", { name: "刷新 one@example.invalid" });
    await user.click(button);
    expect(screen.queryByRole("dialog", { name: /刷新/ })).not.toBeInTheDocument();
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("refresh_cursor_account", { accountId: "cursor_one" }));
    expect(await screen.findByText("额度已更新")).toBeVisible();
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

  it("opens a sensitive export in masked mode", async () => {
    const user = userEvent.setup(); render(<App />); await screen.findByText("one@example.invalid");
    await user.click(screen.getByRole("button", { name: "导出" }));
    const dialog = await screen.findByRole("dialog", { name: "完整账号 JSON" });
    expect(dialog).toHaveTextContent("••••••••");
    expect(dialog).not.toHaveTextContent("fake.secret.token");
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
});
