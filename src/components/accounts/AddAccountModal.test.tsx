import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddAccountModal } from "./AddAccountModal";

describe("AddAccountModal", () => {
  it("offers the three approved account-add paths in the fixed order", () => {
    render(<AddAccountModal language="zh-CN" busy={false} onClose={vi.fn()} onOAuth={vi.fn()} onToken={vi.fn()} onLocal={vi.fn()} onJsonFile={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-controls"))).toEqual(["add-account-oauth-panel", "add-account-token-panel", "add-account-local-panel"]);
    expect(screen.getByRole("button", { name: "在浏览器中登录" })).toBeVisible();
  });

  it("clears a single-line web token before awaiting the import result", async () => {
    let finish: (() => void) | undefined;
    const onToken = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const webToken = "user_01TEST::e30.eyJzdWIiOiJhdXRoMHx1c2VyXzAxVEVTVCJ9.signature";
    const user = userEvent.setup();
    render(<AddAccountModal language="zh-CN" busy={false} onClose={vi.fn()} onOAuth={vi.fn()} onToken={onToken} onLocal={vi.fn()} onJsonFile={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "Token / JSON" }));
    expect(screen.getByText(/单行 user_…::JWT 网页 Token/)).toBeVisible();
    const input = screen.getByRole("textbox", { name: "Cursor Access Token 或 Cockpit JSON" });
    await user.click(input);
    await user.paste(webToken);
    await user.click(screen.getByRole("button", { name: "导入" }));
    expect(input).toHaveValue("");
    expect(document.body).not.toHaveTextContent(webToken);
    finish?.();
    await waitFor(() => expect(onToken).toHaveBeenCalledWith(webToken));
  });

  it("keeps JSON file and local Cursor imports inside the local tab", async () => {
    const onLocal = vi.fn().mockResolvedValue(undefined);
    const onJsonFile = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AddAccountModal language="en" busy={false} onClose={vi.fn()} onOAuth={vi.fn()} onToken={vi.fn()} onLocal={onLocal} onJsonFile={onJsonFile} />);
    await user.click(screen.getByRole("tab", { name: "Local import" }));
    const panel = screen.getByRole("tabpanel", { name: "Local import" });
    await user.click(within(panel).getByRole("button", { name: "Import current Cursor account" }));
    await user.click(within(panel).getByRole("button", { name: "Choose JSON file" }));
    expect(onLocal).toHaveBeenCalledOnce();
    expect(onJsonFile).toHaveBeenCalledOnce();
  });
});
