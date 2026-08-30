import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { CursorAccountView } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

function account(id = "cursor_one", email = "one@example.invalid"): CursorAccountView {
  return { id, email, authId: `auth0|${id}`, name: null, tags: ["500 credits"], membershipType: "pro", subscriptionStatus: "active", signUpType: "Auth_0", status: null, statusReason: null, source: "cockpit-tools", hasAccessToken: true, hasRefreshToken: true, isCurrent: false,
    coreUsage: { total: { enabled: true, used: 20, limit: 100, remaining: 80, percentUsed: 20 }, autoComposer: { enabled: true, used: null, limit: null, remaining: null, percentUsed: 11 }, api: { enabled: true, used: null, limit: null, remaining: null, percentUsed: 100 }, onDemand: { enabled: false, used: 0, limit: null, remaining: null, percentUsed: null }, billingCycleStart: "2026-08-20T00:00:00Z", billingCycleEnd: "2026-09-20T00:00:00Z", source: "live", updatedAt: 1788000000, error: null },
    sand: { usagePercent: 64.5, hasAvailableUsage: true, hasNonZeroIncludedLimit: true, grokPlanLabel: "Grok", currentPeriodStart: null, nextResetTimestampUtc: "2026-09-04T00:00:00Z", accessGranted: true, accessState: "SAND_ACCESS_STATE_GRANTED", blockReason: null, isPaidTrialPlan: false, proAndSuperGrokPlansGrantAccess: true, usageUpdatedAt: 1788000000, accessUpdatedAt: 1788000000, usageError: null, accessError: null },
    lastError: null, lastErrorAt: null, createdAt: 1, lastUsed: 2 };
}

describe("multi-account workspace", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "list_cursor_accounts") return [account()];
      if (command === "refresh_cursor_account") return { ...account(), lastUsed: 3 };
      if (command === "import_cockpit_accounts_json") return [account("cursor_imported", "imported@example.invalid")];
      if (command === "export_cursor_accounts") return JSON.stringify([{ id: "cursor_one", access_token: "fake.secret.token" }]);
      throw new Error(`unexpected command ${command} ${JSON.stringify(args)}`);
    });
  });
  afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); mockedInvoke.mockReset(); });

  it("restores local accounts on startup without reading or refreshing Cursor", async () => {
    render(<App />);
    expect(await screen.findByText("one@example.invalid")).toBeVisible();
    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual(["list_cursor_accounts"]);
    expect(document.body.textContent).not.toContain("fake.secret.token");
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
});
