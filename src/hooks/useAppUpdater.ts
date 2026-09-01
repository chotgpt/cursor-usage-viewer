import { useCallback, useEffect, useRef, useState } from "react";
import { getBundleType, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { RELEASE_PAGE_URL, RELEASES_URL, REPOSITORY_URL } from "../config/release";
import { isTauri } from "../services/cursorService";
import { resolveUpdaterTarget, type BundleKind, type DesktopArch, type DesktopPlatform } from "../utils/updaterTarget";
import { CHECK_DELAYS, DOWNLOAD_DELAYS, withUpdaterRetry } from "../utils/updaterRetry";
import type { Language } from "../i18n";

export type PendingNotes = { fromVersion: string; toVersion: string; notes: string };
export type UpdateSettings = {
  schemaVersion: number;
  autoCheck: boolean;
  checkIntervalHours: number;
  autoInstall: boolean;
  remindOnUpdate: boolean;
  lastCheckTime: number;
  lastRunVersion: string;
  skippedVersion: string;
  pendingNotes: PendingNotes | null;
};
export type UpdaterState = {
  phase: "idle" | "checking" | "latest" | "available" | "downloading" | "downloaded" | "ready" | "error" | "cancelled";
  version: string;
  notes: string;
  progress: number | null;
  error: string;
};

const initial: UpdaterState = { phase: "idle", version: "", notes: "", progress: null, error: "" };

async function installedTarget(): Promise<{ target: string; bundle: BundleKind } | null> {
  const info = await invoke<{ platform: DesktopPlatform; arch: DesktopArch }>("get_desktop_platform");
  let bundle: BundleKind = "unknown";
  try {
    bundle = (await getBundleType()) as BundleKind;
  } catch {
    // Portable/unsupported installations may not expose a bundle type.
  }
  const target = resolveUpdaterTarget(info.platform, info.arch, bundle);
  return target ? { target, bundle } : null;
}

export function useAppUpdater(language: Language = "zh-CN") {
  const [state, setState] = useState(initial);
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(isTauri);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [installedVersion, setInstalledVersion] = useState("0.1.0");
  const [versionChange, setVersionChange] = useState<PendingNotes | null>(null);
  const updateRef = useRef<Update | null>(null);
  const cancelled = useRef(false);
  const running = useRef(false);
  const bundleRef = useRef<BundleKind>("unknown");

  const saveSettings = useCallback(async (next: UpdateSettings): Promise<boolean> => {
    const previous = settings;
    setSettings(next);
    setSettingsSaving(true);
    setSettingsError("");
    try {
      if (isTauri()) await invoke("save_update_settings", { settings: next });
      return true;
    } catch (error) {
      setSettings(previous);
      setSettingsError(String(error));
      return false;
    } finally {
      setSettingsSaving(false);
    }
  }, [settings]);

  const loadSettings = useCallback(async () => {
    if (!isTauri()) { setSettingsLoading(false); return; }
    setSettingsLoading(true);
    setSettingsError("");
    try { setSettings(await invoke<UpdateSettings>("get_update_settings")); }
    catch (error) { setSettings(null); setSettingsError(String(error)); }
    finally { setSettingsLoading(false); }
  }, []);

  const download = useCallback(async () => {
    const update = updateRef.current;
    if (!update || running.current) return;
    running.current = true;
    cancelled.current = false;
    let received = 0;
    let total = 0;
    setState((old) => ({ ...old, phase: "downloading", progress: 0, error: "" }));
    try {
      if (bundleRef.current === "deb" || bundleRef.current === "rpm") {
        await withUpdaterRetry(
          () => invoke("download_linux_package_update", { expectedVersion: update.version }),
          DOWNLOAD_DELAYS,
        );
        if (cancelled.current) {
          await invoke("discard_linux_package_update", { version: update.version });
          setState((old) => ({ ...old, phase: "cancelled" }));
          return;
        }
        await invoke("prepare_update_install", {
          fromVersion: update.currentVersion,
          toVersion: update.version,
          notes: update.body ?? "",
        });
        setState((old) => ({ ...old, phase: "downloaded", progress: 100 }));
        return;
      }
      await withUpdaterRetry(
        () => update.download((event) => {
          if (event.event === "Started") total = event.data.contentLength ?? 0;
          if (event.event === "Progress") {
            received += event.data.chunkLength;
            setState((old) => ({ ...old, progress: total ? Math.min(100, received / total * 100) : null }));
          }
        }),
        DOWNLOAD_DELAYS,
      );
      if (cancelled.current) {
        setState((old) => ({ ...old, phase: "cancelled" }));
        return;
      }
      await invoke("prepare_update_install", {
        fromVersion: update.currentVersion,
        toVersion: update.version,
        notes: update.body ?? "",
      });
      await update.install();
      setState((old) => ({ ...old, phase: "ready", progress: 100 }));
    } catch (error) {
      if (!cancelled.current) setState((old) => ({ ...old, phase: "error", error: String(error) }));
    } finally {
      running.current = false;
    }
  }, []);

  const checkNow = useCallback(async (manual = true) => {
    if (!isTauri() || running.current) return;
    running.current = true;
    let shouldDownload = false;
    setState((old) => ({ ...old, phase: "checking", error: "" }));
    try {
      const installed = await installedTarget();
      if (!installed) throw new Error(language === "en" ? "Unable to identify the installed package type. Use the browser download instead." : "无法识别当前安装包类型，请使用浏览器下载对应安装包");
      bundleRef.current = installed.bundle;
      const update = await withUpdaterRetry(() => check({ target: installed.target }), CHECK_DELAYS);
      const next = await invoke<UpdateSettings>("mark_update_checked");
      setSettings(next);
      if (!update) {
        setState({ ...initial, phase: manual ? "latest" : "idle" });
        return;
      }
      updateRef.current = update;
      if (!manual && (next.skippedVersion === update.version || !next.remindOnUpdate)) {
        setState(initial);
        return;
      }
      setState({ phase: "available", version: update.version, notes: update.body ?? "", progress: null, error: "" });
      shouldDownload = next.autoInstall;
    } catch (error) {
      setState({ ...initial, phase: manual ? "error" : "idle", error: manual ? String(error) : "" });
    } finally {
      running.current = false;
    }
    if (shouldDownload) void download();
  }, [download, language]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    void updateRef.current?.close();
    if ((bundleRef.current === "deb" || bundleRef.current === "rpm") && updateRef.current?.version) {
      void invoke("discard_linux_package_update", { version: updateRef.current.version });
    }
    setState((old) => ({ ...old, phase: "cancelled" }));
  }, []);

  const skip = useCallback(async () => {
    if (settings && state.version) {
      const saved = await saveSettings({ ...settings, skippedVersion: state.version });
      if (!saved) {
        setState((old) => ({ ...old, error: language === "en" ? "Unable to save skipped version." : "无法保存跳过版本设置。" }));
        return;
      }
    }
    setState(initial);
  }, [language, saveSettings, settings, state.version]);

  useEffect(() => {
    if (!isTauri()) return;
    void loadSettings();
    void getVersion()
      .then((currentVersion) => { setInstalledVersion(currentVersion); return invoke<PendingNotes | null>("consume_version_change", { currentVersion }); })
      .then(setVersionChange);
  }, [loadSettings]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<{ received: number; total: number | null }>("linux-update-progress", (event) => {
      const { received, total } = event.payload;
      setState((old) => ({ ...old, progress: total ? Math.min(100, received / total * 100) : null }));
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, []);

  const autoCheck = settings?.autoCheck ?? false;
  const intervalHours = settings?.checkIntervalHours ?? 1;
  useEffect(() => {
    if (!isTauri() || !autoCheck) return;
    void checkNow(false);
    const timer = window.setInterval(() => void checkNow(false), Math.max(1, intervalHours) * 3_600_000);
    return () => window.clearInterval(timer);
  }, [autoCheck, checkNow, intervalHours]);

  return {
    state,
    settings,
    settingsLoading,
    settingsSaving,
    settingsError,
    installedVersion,
    reloadSettings: loadSettings,
    versionChange,
    saveSettings,
    checkNow,
    download,
    cancel,
    skip,
    later: () => setState(initial),
    retry: () => checkNow(true),
    installLinuxPackage: async () => {
      if (!state.version || running.current) return;
      running.current = true;
      try {
        await invoke("install_linux_package_update", { version: state.version });
        setState((old) => ({ ...old, phase: "ready" }));
      } catch (error) {
        setState((old) => ({ ...old, phase: "error", error: String(error) }));
      } finally {
        running.current = false;
      }
    },
    openRelease: () => openUrl(RELEASE_PAGE_URL),
    openRepository: () => openUrl(REPOSITORY_URL),
    openReleaseVersion: (version: string) => openUrl(`${RELEASES_URL}/tag/v${encodeURIComponent(version)}`),
    dismissVersionChange: () => setVersionChange(null),
    restart: () => relaunch(),
  };
}
