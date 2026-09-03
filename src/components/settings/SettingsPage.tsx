/*
 * Derived from Cockpit Tools at a0508ae815e104e931dae515389e680840008367.
 * Sources: src/pages/SettingsPageView.tsx, src/pages/settings/Settings.css.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { X } from "lucide-react";
import { dictionaries, type Language } from "../../i18n";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import * as cursorService from "../../services/cursorService";
import "./SettingsPage.css";

export type AppTheme = "light" | "dark" | "system";
type DesktopSettings = { schemaVersion: number; closeBehavior: "ask" | "minimize_to_tray" | "exit"; startMinimized: boolean; rememberWindow: boolean; windowX: number | null; windowY: number | null; windowWidth: number | null; windowHeight: number | null };
type ReleaseHistoryItem = { version: string; date: string; items: string[] };

export function SettingsPage({ language, setLanguage, theme, setTheme, updater }: {
  language: Language;
  setLanguage: (value: Language) => void;
  theme: AppTheme;
  setTheme: (value: AppTheme) => void;
  updater: ReturnType<typeof useAppUpdater>;
}) {
  const [activeTab, setActiveTab] = useState<"general" | "about">("general");
  const [desktop, setDesktop] = useState<DesktopSettings | null>(null);
  const [desktopLoading, setDesktopLoading] = useState(true);
  const [desktopSaving, setDesktopSaving] = useState(false);
  const [desktopError, setDesktopError] = useState("");
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [autostartSaving, setAutostartSaving] = useState(false);
  const [autostartError, setAutostartError] = useState("");
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [releaseHistoryLoading, setReleaseHistoryLoading] = useState(false);
  const [releaseHistoryError, setReleaseHistoryError] = useState("");
  const [releaseHistoryItems, setReleaseHistoryItems] = useState<ReleaseHistoryItem[]>([]);
  const [cursorSettings, setCursorSettings] = useState<cursorService.CursorSettings | null>(null);
  const [cursorSettingsLoading, setCursorSettingsLoading] = useState(true);
  const [cursorSettingsSaving, setCursorSettingsSaving] = useState(false);
  const [cursorSettingsError, setCursorSettingsError] = useState("");
  const [refreshChoice, setRefreshChoice] = useState("10");
  const [customRefreshMinutes, setCustomRefreshMinutes] = useState("30");
  const t = dictionaries[language];
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const settings = updater.settings;
  const loadDesktop = async () => { setDesktopLoading(true); setDesktopError(""); try { setDesktop(await invoke<DesktopSettings>("get_desktop_settings")); } catch (error) { setDesktop(null); setDesktopError(String(error)); } finally { setDesktopLoading(false); } };
  const loadAutostart = async () => { setAutostartLoading(true); setAutostartError(""); try { setAutostart(await isEnabled()); } catch (error) { setAutostartError(String(error)); } finally { setAutostartLoading(false); } };
  const loadCursorSettings = async () => { setCursorSettingsLoading(true); setCursorSettingsError(""); try { const value = await cursorService.getSettings(); const preset = [-1, 2, 5, 10, 15].includes(value.autoRefreshMinutes); setCursorSettings(value); setRefreshChoice(preset ? String(value.autoRefreshMinutes) : "custom"); if (!preset) setCustomRefreshMinutes(String(value.autoRefreshMinutes)); } catch (error) { setCursorSettings(null); setCursorSettingsError(String(error)); } finally { setCursorSettingsLoading(false); } };
  useEffect(() => { void loadDesktop(); void loadAutostart(); void loadCursorSettings(); }, []);
  const saveDesktop = async (next: DesktopSettings) => { const previous = desktop; setDesktop(next); setDesktopSaving(true); setDesktopError(""); try { await invoke("save_desktop_settings", { settings: next }); } catch (error) { setDesktop(previous); setDesktopError(String(error)); } finally { setDesktopSaving(false); } };
  const setAutostartEnabled = async (enabled: boolean) => { const previous = autostart; setAutostart(enabled); setAutostartSaving(true); setAutostartError(""); try { if (enabled) await enable(); else await disable(); } catch (error) { setAutostart(previous); setAutostartError(String(error)); } finally { setAutostartSaving(false); } };
  const saveCursorSettings = async (minutes: number) => { if (!cursorSettings || minutes !== -1 && (!Number.isInteger(minutes) || minutes < 2)) return; const previous = cursorSettings; const next = { ...cursorSettings, autoRefreshMinutes: minutes }; setCursorSettings(next); setCursorSettingsSaving(true); setCursorSettingsError(""); try { const saved = await cursorService.saveSettings(next); setCursorSettings(saved); setRefreshChoice([-1, 2, 5, 10, 15].includes(saved.autoRefreshMinutes) ? String(saved.autoRefreshMinutes) : "custom"); } catch (error) { setCursorSettings(previous); setRefreshChoice([-1, 2, 5, 10, 15].includes(previous.autoRefreshMinutes) ? String(previous.autoRefreshMinutes) : "custom"); setCursorSettingsError(String(error)); } finally { setCursorSettingsSaving(false); } };
  const openReleaseHistory = async () => { setReleaseHistoryOpen(true); setReleaseHistoryLoading(true); setReleaseHistoryError(""); try { setReleaseHistoryItems(await invoke<ReleaseHistoryItem[]>("get_release_history", { limit: 30 })); } catch (error) { setReleaseHistoryItems([]); setReleaseHistoryError(String(error)); } finally { setReleaseHistoryLoading(false); } };
  return <section className="settings-page">
    <div className="page-tabs-row settings-page-tabs-row"><div className="page-tabs-label">{t.settings}</div><div className="page-tabs filter-tabs" role="tablist" aria-label={l("设置类别", "Settings categories")}><button id="settings-general-tab" className={`filter-tab ${activeTab === "general" ? "active" : ""}`} role="tab" aria-selected={activeTab === "general"} aria-controls="settings-general-panel" onClick={() => setActiveTab("general")}>{t.general}</button><button id="settings-about-tab" className={`filter-tab ${activeTab === "about" ? "active" : ""}`} role="tab" aria-selected={activeTab === "about"} aria-controls="settings-about-panel" onClick={() => setActiveTab("about")}>{t.about}</button></div></div>
    <div className="settings-container"><div className="settings-content" id={`settings-${activeTab}-panel`} role="tabpanel" aria-labelledby={`settings-${activeTab}-tab`}>
      {activeTab === "general" ? <>
        <div className="group-title">{l("应用设置", "Application")}</div><div className="settings-group">
          {(desktopError || autostartError) && <div className="settings-inline-error" role="alert"><span>{l("部分桌面设置加载或保存失败。", "Some desktop settings failed to load or save.")}</span><button className="btn btn-secondary" onClick={() => { void loadDesktop(); void loadAutostart(); }}>{l("重试", "Retry")}</button></div>}
          <SettingRow title={t.language} description={l("选择界面的显示语言", "Choose the interface language")}><select aria-label={t.language} value={language} onChange={(event) => { const value = event.target.value as Language; try { localStorage.setItem("cursor-language", value); } catch { /* Keep the in-memory preference. */ } setLanguage(value); }}><option value="zh-CN">简体中文</option><option value="en">English</option></select></SettingRow>
          <SettingRow title={l("应用主题", "Theme")} description={l("切换深色、浅色或跟随系统", "Use light, dark, or the system theme")}><select aria-label={l("主题", "Theme")} value={theme} onChange={(event) => { const value = event.target.value as AppTheme; try { localStorage.setItem("cursor-theme", value); } catch { /* Keep the in-memory preference. */ } setTheme(value); }}><option value="system">{l("跟随系统", "System")}</option><option value="light">{l("浅色", "Light")}</option><option value="dark">{l("深色", "Dark")}</option></select></SettingRow>
          <SettingRow title={l("关闭窗口时", "When closing the window")} description={l("每次询问、最小化到托盘或直接退出", "Ask, minimize to tray, or exit")}><select aria-label={l("关闭窗口时", "When closing the window")} disabled={desktopLoading || desktopSaving || !desktop} value={desktop?.closeBehavior ?? "ask"} onChange={(event) => desktop && void saveDesktop({ ...desktop, closeBehavior: event.target.value as DesktopSettings["closeBehavior"] })}><option value="ask">{l("每次询问", "Ask every time")}</option><option value="minimize_to_tray">{l("最小化到托盘", "Minimize to tray")}</option><option value="exit">{l("直接退出", "Exit")}</option></select></SettingRow>
          <SettingRow title={l("开机启动", "Launch at login")} description={l("登录系统后自动启动应用", "Start the app after signing in") }><label className="switch"><input aria-label={l("开机启动", "Launch at login")} type="checkbox" disabled={autostartLoading || autostartSaving || Boolean(autostartError)} checked={autostart} onChange={(event) => void setAutostartEnabled(event.target.checked)}/><span className="slider"/></label></SettingRow>
          <SettingRow title={l("启动后最小化", "Start minimized")} description={l("启动应用后保持在系统托盘", "Keep the app in the system tray after launch")}><label className="switch"><input aria-label={l("启动后最小化", "Start minimized")} type="checkbox" disabled={desktopLoading || desktopSaving || !desktop} checked={desktop?.startMinimized ?? false} onChange={(event) => desktop && void saveDesktop({ ...desktop, startMinimized: event.target.checked })}/><span className="slider"/></label></SettingRow>
          <SettingRow title={l("记忆窗口位置", "Remember window position")} description={l("退出时保存窗口位置和尺寸", "Save the window position and size on exit")}><label className="switch"><input aria-label={l("记忆窗口位置", "Remember window position")} type="checkbox" disabled={desktopLoading || desktopSaving || !desktop} checked={desktop?.rememberWindow ?? false} onChange={(event) => desktop && void saveDesktop({ ...desktop, rememberWindow: event.target.checked })}/><span className="slider"/></label></SettingRow>
        </div>
        <div className="group-title">{l("Cursor 额度", "Cursor usage")}</div><div className="settings-group">
          {cursorSettingsError && <div className="settings-inline-error" role="alert"><span>{l("自动刷新设置加载或保存失败。", "Automatic refresh settings failed to load or save.")}</span><button className="btn btn-secondary" onClick={() => void loadCursorSettings()}>{l("重试", "Retry")}</button></div>}
          <SettingRow title={l("自动刷新额度", "Automatically refresh usage")} description={l("在应用运行（包括隐藏到托盘）期间按所选间隔刷新；与应用更新检查相互独立。", "Refreshes at the selected interval while the app is running, including in the tray. This is independent of update checks.")}><div className="cursor-refresh-control"><select aria-label={l("自动刷新额度", "Automatically refresh usage")} disabled={cursorSettingsLoading || cursorSettingsSaving || !cursorSettings} value={refreshChoice} onChange={(event) => { const value = event.target.value; setRefreshChoice(value); if (value !== "custom") void saveCursorSettings(Number(value)); }}><option value="-1">{l("关闭", "Off")}</option><option value="2">2 {l("分钟", "minutes")}</option><option value="5">5 {l("分钟", "minutes")}</option><option value="10">10 {l("分钟（默认）", "minutes (default)")}</option><option value="15">15 {l("分钟", "minutes")}</option><option value="custom">{l("自定义", "Custom")}</option></select>{cursorSettings && refreshChoice === "custom" && <><input className="cursor-refresh-custom" aria-label={l("自定义刷新分钟数", "Custom refresh minutes")} type="number" min={2} step={1} value={customRefreshMinutes} onChange={(event) => setCustomRefreshMinutes(event.target.value)}/><button className="btn btn-secondary" disabled={cursorSettingsSaving || !/^\d+$/.test(customRefreshMinutes) || Number(customRefreshMinutes) < 2} onClick={() => void saveCursorSettings(Number(customRefreshMinutes))}>{l("保存", "Save")}</button></>}</div></SettingRow>
        </div>
        <div className="group-title">{l("应用更新", "Updates")}</div><div className="settings-group">
          {updater.settingsError && <div className="settings-inline-error" role="alert"><span>{l("更新设置加载或保存失败。", "Update settings failed to load or save.")}</span><button className="btn btn-secondary" onClick={() => void updater.reloadSettings()}>{l("重试", "Retry")}</button></div>}
          <SettingRow title={l("自动检查更新", "Automatically check for updates")} description={l("按设置访问本项目固定 GitHub 更新源，不刷新 Cursor 额度", "Checks this project's fixed GitHub update source; never refreshes Cursor usage")}><label className="switch"><input aria-label={l("自动检查更新", "Automatically check for updates")} type="checkbox" disabled={updater.settingsLoading || updater.settingsSaving || !settings} checked={settings?.autoCheck ?? false} onChange={(event) => settings && void updater.saveSettings({ ...settings, autoCheck: event.target.checked })}/><span className="slider"/></label></SettingRow>
          <SettingRow title={l("自动安装", "Automatically install")} description={l("下载完成后等待你选择重启", "Wait for you to restart after the download")}><label className="switch"><input aria-label={l("自动安装", "Automatically install")} type="checkbox" disabled={updater.settingsLoading || updater.settingsSaving || !settings} checked={settings?.autoInstall ?? false} onChange={(event) => settings && void updater.saveSettings({ ...settings, autoInstall: event.target.checked })}/><span className="slider"/></label></SettingRow>
          <SettingRow title={l("更新提醒", "Update notifications")} description={l("发现新版本时显示更新提示", "Show a notification when an update is available")}><label className="switch"><input aria-label={l("更新提醒", "Update notifications")} type="checkbox" disabled={updater.settingsLoading || updater.settingsSaving || !settings} checked={settings?.remindOnUpdate ?? false} onChange={(event) => settings && void updater.saveSettings({ ...settings, remindOnUpdate: event.target.checked })}/><span className="slider"/></label></SettingRow>
        </div>
      </> : <><div className="group-title">{t.about}</div><div className="settings-group about-settings-group"><div className="settings-about-product"><strong>Cursor Usage Viewer</strong><span>v{updater.installedVersion} · CC BY-NC-SA 4.0</span><p>{t.unofficial}</p><div className="settings-about-actions"><button className="btn btn-secondary" disabled={updater.state.phase === "checking"} onClick={() => void updater.checkNow(true)}>{updater.state.phase === "checking" ? l("检查中…", "Checking…") : l("检查更新", "Check for updates")}</button><button className="btn btn-secondary" onClick={() => void updater.openRepository()}>{l("项目仓库", "Repository")}</button><button className="btn btn-secondary" onClick={() => void openReleaseHistory()}>{l("版本历史", "Release history")}</button></div></div></div></>}
    </div></div>
    {releaseHistoryOpen && <ReleaseHistoryDialog language={language} loading={releaseHistoryLoading} error={releaseHistoryError} items={releaseHistoryItems} onRetry={() => void openReleaseHistory()} onOpenRelease={(version) => void updater.openReleaseVersion(version)} onClose={() => setReleaseHistoryOpen(false)}/>}
  </section>;
}

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="settings-row"><div className="row-label"><div className="row-title">{title}</div><div className="row-desc">{description}</div></div><div className="row-control">{children}</div></div>; }

function ReleaseHistoryDialog({ language, loading, error, items, onRetry, onOpenRelease, onClose }: { language: Language; loading: boolean; error: string; items: ReleaseHistoryItem[]; onRetry: () => void; onOpenRelease: (version: string) => void; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="modal release-history-modal" role="dialog" aria-modal="true" aria-label={l("版本历史", "Release history")} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><h2>{l("版本历史", "Release history")}</h2><button className="modal-close" aria-label={l("关闭", "Close")} onClick={onClose}><X size={18}/></button></div><div className="modal-body">{loading ? <p>{l("加载中…", "Loading…")}</p> : error ? <div className="settings-inline-error" role="alert"><span>{l("版本历史加载失败。", "Release history failed to load.")}</span><button className="btn btn-secondary" onClick={onRetry}>{l("重试", "Retry")}</button></div> : items.length === 0 ? <p>{l("暂无版本历史", "No release history")}</p> : <div className="release-history-list">{items.map((item) => <article className="release-history-item" key={item.version}><header><div><strong>v{item.version}</strong>{item.date && <span>{item.date}</span>}</div><button className="btn btn-secondary" onClick={() => onOpenRelease(item.version)}>{l("查看版本", "View release")}</button></header><ul>{item.items.map((line, index) => <li key={`${item.version}-${index}`}>{line}</li>)}</ul></article>)}</div>}</div></section></div>;
}
