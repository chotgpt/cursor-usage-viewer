import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { useAppUpdater } from "./useAppUpdater";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@tauri-apps/api/app", () => ({ getBundleType: vi.fn(async () => "nsis"), getVersion: vi.fn(async () => "1.0.0") }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const settings = {
  schemaVersion: 1,
  autoCheck: false,
  checkIntervalHours: 1,
  autoInstall: false,
  remindOnUpdate: true,
  lastCheckTime: 0,
  lastRunVersion: "",
  skippedVersion: "",
  pendingNotes: null,
};

describe("application updater scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_update_settings") return settings;
      if (command === "consume_version_change") return null;
      throw new Error(`unexpected command ${command}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("does not contact the updater later when automatic checks are disabled", async () => {
    renderHook(() => useAppUpdater());
    await act(async () => Promise.resolve());
    await act(async () => { vi.advanceTimersByTime(3_600_000); });
    expect(check).not.toHaveBeenCalled();
  });

  it("keeps the update visible when saving a skipped version fails", async () => {
    vi.mocked(check).mockResolvedValue({
      version: "2.0.0",
      currentVersion: "1.0.0",
      body: "notes",
    } as Awaited<ReturnType<typeof check>>);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_update_settings" || command === "mark_update_checked") return settings;
      if (command === "consume_version_change") return null;
      if (command === "get_desktop_platform") return { platform: "windows", arch: "x86_64" };
      if (command === "save_update_settings") throw new Error("disk full");
      throw new Error(`unexpected command ${command}`);
    });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.settings).toEqual(settings);

    await act(async () => { await result.current.checkNow(); });
    expect(result.current.state.phase).toBe("available");
    await act(async () => { await result.current.skip(); });

    expect(result.current.state.phase).toBe("available");
    expect(result.current.state.error).toContain("无法保存跳过版本设置");
    expect(result.current.settings?.skippedVersion).toBe("");
  });
});
