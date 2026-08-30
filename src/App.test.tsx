import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";

import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("usage query interaction", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "load_current_cursor_account") {
        return {
          id: "local-cursor",
          email: "viewer@example.com",
          membership: "pro",
          signupType: "Google",
          tags: [],
          source: "cursor",
          isActive: true,
          hasAccessToken: true,
          hasRefreshToken: true,
        };
      }
      if (command === "import_cockpit_accounts_json") {
        return [{
            id: "cursor_imported",
            email: "imported@example.com",
            membership: "pro",
            signupType: "Auth_0",
            tags: ["测试标签"],
            source: "cockpit-tools",
            isActive: true,
            hasAccessToken: true,
            hasRefreshToken: true,
          }, {
            id: "cursor_imported_two",
            email: "second@example.com",
            membership: "business",
            signupType: "Auth_0",
            tags: [],
            source: "cockpit-tools",
            isActive: false,
            hasAccessToken: true,
            hasRefreshToken: false,
          }];
      }
      if (command === "query_cursor_usage") {
        return {
          autoPercentUsed: 12.25,
          apiPercentUsed: 46.5,
          totalPercentUsed: 31.75,
          billingCycleStart: "1787875200000",
          billingCycleEnd: "1790553600000",
          usagePercent: 64.471011,
          hasAvailableUsage: true,
          hasNonZeroIncludedLimit: true,
          grokPlanLabel: "Grok Bot Plan",
          currentPeriodStart: "2026-08-28T00:00:00.000Z",
          nextResetTimestampUtc: "2026-09-04T02:36:21.032Z",
          sandAccessGranted: true,
          sandAccessState: "SAND_ACCESS_STATE_GRANTED",
          sandBlockReason: "",
          isPaidTrialPlan: false,
          proAndSuperGrokPlansGrantAccess: true,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    mockedInvoke.mockReset();
  });

  it("keeps query disabled until an account has been loaded", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "查询额度" })).toBeDisabled();
  });

  it("runs the query on the first click without a confirmation dialog", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "读取当前 Cursor" }));
    await screen.findByText("viewer@example.com");
    await user.click(screen.getByRole("button", { name: "查询额度" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("query_cursor_usage");
    });
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "query_cursor_usage"))
      .toHaveLength(1);
    expect(await screen.findByText("Grok Bot Plan")).toBeVisible();
    expect(screen.getByText("Sand 已授权")).toBeVisible();
    expect(screen.getByText("68.3% 可用")).toBeVisible();
    expect(screen.getByText("12.3%")).toBeVisible();
    expect(screen.getByText("46.5%")).toBeVisible();
    expect(screen.getByText("64.5%")).toBeVisible();
  });

  it("imports Cockpit summaries without sending credentials to the frontend", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "账号" }));
    const secret = "fake-header.fake-payload.fake-signature";
    const payload = JSON.stringify([
      { id: "cursor_imported", email: "imported@example.com", access_token: secret },
      { id: "cursor_imported_two", email: "second@example.com", access_token: "two.payload.signature" },
    ]);
    const input = screen.getByRole("textbox", { name: "Cockpit Tools JSON 数组" });
    await user.click(input);
    await user.paste(payload);
    await user.click(screen.getByRole("button", { name: "导入全部账号" }));

    expect(await screen.findByText("imported@example.com")).toBeVisible();
    expect(screen.getByText("second@example.com")).toBeVisible();
    expect(screen.getByText("测试标签")).toBeVisible();
    expect(mockedInvoke).toHaveBeenCalledWith("import_cockpit_accounts_json", { payload });
    expect(input).toHaveValue("");
    expect(document.body.textContent).not.toContain("access_token");
    expect(document.body.textContent).not.toContain("refresh_token");
    expect(document.body.textContent).not.toContain(secret);
  });

  it("keeps Free account period usage visible when Grok and Sand fields are absent", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "load_current_cursor_account") {
        return {
          id: "local-free",
          email: "free@example.com",
          membership: "free",
          signupType: "Auth_0",
          tags: [],
          source: "cursor",
          isActive: true,
          hasAccessToken: true,
          hasRefreshToken: false,
        };
      }
      if (command === "query_cursor_usage") {
        return {
          autoPercentUsed: 4.5,
          apiPercentUsed: null,
          totalPercentUsed: 4.5,
          billingCycleStart: "1787875200000",
          billingCycleEnd: "1790553600000",
          usagePercent: null,
          hasAvailableUsage: false,
          hasNonZeroIncludedLimit: false,
          grokPlanLabel: null,
          currentPeriodStart: null,
          nextResetTimestampUtc: null,
          sandAccessGranted: null,
          sandAccessState: null,
          sandBlockReason: null,
          isPaidTrialPlan: null,
          proAndSuperGrokPlansGrantAccess: null,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "读取当前 Cursor" }));
    await user.click(screen.getByRole("button", { name: "查询额度" }));

    expect(await screen.findByText("额度已更新")).toBeVisible();
    expect(screen.getByText("Grok / Sand 暂无额度")).toBeVisible();
    expect(screen.getByText("Sand 暂无数据")).toBeVisible();
    expect(screen.getAllByText("4.5%").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("查询失败");
  });
});
