import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { dictionaries, initialLanguage, type Language } from "./i18n";
import { PAGE_SIZES, usePagination } from "./hooks/usePagination";
import * as cursor from "./services/cursorService";
import type { CursorAccountView, UsageAmount } from "./types";
import { useAppUpdater } from "./hooks/useAppUpdater";
import UpdateDialog from "./components/updater/UpdateDialog";
import VersionChangedDialog from "./components/updater/VersionChangedDialog";
import { MultiSelectFilterDropdown } from "./components/accounts/MultiSelectFilterDropdown";
import { SingleSelectFilterDropdown } from "./components/accounts/SingleSelectFilterDropdown";
import { AccountTagFilterDropdown } from "./components/accounts/AccountTagFilterDropdown";
import { AccountSelectionToolbar } from "./components/accounts/AccountSelectionToolbar";
import { PaginationControls } from "./components/accounts/PaginationControls";
import { SettingsPage, type AppTheme } from "./components/settings/SettingsPage";
import { useDialogFocus } from "./hooks/useDialogFocus";
import { initialPrivacyMode, maskSensitiveValue, persistPrivacyMode } from "./utils/privacy";
import { save } from "@tauri-apps/plugin-dialog";
import { ArrowDownWideNarrow, ChevronDown, CircleAlert, Download, Eye, EyeOff, Gauge, HardDriveDownload, LayoutGrid, List, Lock, RefreshCw, RotateCw, Search, Settings as SettingsIcon, Tag, Trash2, Upload, X } from "lucide-react";

type Page = "cursor" | "settings";
type Layout = "grid" | "list";
type AccountSort = "created_at" | "credits" | "plan_end";
type Theme = AppTheme;
type MessageTone = "success" | "warning" | "error";
type AppMessage = { text: string; tone: MessageTone };
type ExportState = { json: string; ids: string[]; revealed: boolean; copied: boolean; pathCopied: boolean; saving: boolean; savedPath: string };
type AccountGroup = { label: string; accounts: CursorAccountView[]; totalCount: number };
const FLOW_NOTICE_COLLAPSED_KEY = "cursor-flow-notice-collapsed";
const QUOTA_FAILED_FILTER = "__quota_failed__";
const VALID_ACCOUNT_FILTER = "__valid_account__";
const KNOWN_PLAN_KEYS = ["FREE", "PRO", "PRO_PLUS", "ENTERPRISE", "FREE_TRIAL", "ULTRA"];

export default function App() {
  const [page, setPage] = useState<Page>("cursor");
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const t = dictionaries[language];
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const updater = useAppUpdater(language);
  const [accounts, setAccounts] = useState<CursorAccountView[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [message, setMessage] = useState<AppMessage | null>(null);
  const [busyCounts, setBusyCounts] = useState<Map<string, number>>(new Map());
  const busyRef = useRef<Map<string, number>>(new Map());
  const busy = useMemo(() => new Set(busyCounts.keys()), [busyCounts]);
  const [search, setSearch] = useState("");
  const [membershipFilters, setMembershipFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [groupByTag, setGroupByTag] = useState(false);
  const [sort, setSort] = useState<AccountSort>("created_at");
  const [ascending, setAscending] = useState(false);
  const [layout, setLayout] = useState<Layout>("grid");
  const [privacy, setPrivacy] = useState(initialPrivacyMode);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [exportState, setExportState] = useState<ExportState | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<string[]>([]);
  const [tagTarget, setTagTarget] = useState<CursorAccountView | null>(null);
  const [tagText, setTagText] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [tagError, setTagError] = useState("");
  const [closePrompt, setClosePrompt] = useState(false);
  const [rememberClose, setRememberClose] = useState(false);
  const [noticeCollapsed, setNoticeCollapsed] = useState(() => {
    try { return localStorage.getItem(FLOW_NOTICE_COLLAPSED_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => { setAccountsLoading(true); void cursor.listAccounts().then(setAccounts).catch((error) => setMessage({ text: `${language === "en" ? "Load failed" : "加载失败"}: ${readableForLanguage(error, language)}`, tone: "error" })).finally(() => setAccountsLoading(false)); }, [language]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => { persistPrivacyMode(privacy); }, [privacy]);
  useEffect(() => {
    if (theme !== "system" || typeof window.matchMedia !== "function") {
      document.documentElement.setAttribute("data-theme", theme === "system" ? "light" : theme);
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = () => document.documentElement.setAttribute("data-theme", mediaQuery.matches ? "dark" : "light");
    applySystemTheme();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", applySystemTheme);
      return () => mediaQuery.removeEventListener("change", applySystemTheme);
    }
    mediaQuery.addListener(applySystemTheme);
    return () => mediaQuery.removeListener(applySystemTheme);
  }, [theme]);
  useEffect(() => {
    if (!cursor.isTauri()) return;
    const subscriptions = Promise.all([
      listen("close-requested", () => setClosePrompt(true)),
      listen("manual-update-requested", () => { setPage("settings"); setMessage({ text: l("正在检查应用更新…", "Checking for application updates…"), tone: "success" }); void updater.checkNow(true); }),
    ]);
    return () => { void subscriptions.then((items) => items.forEach((unlisten) => unlisten())); };
  }, [language, updater.checkNow]);
  useEffect(() => {
    try { localStorage.setItem(FLOW_NOTICE_COLLAPSED_KEY, noticeCollapsed ? "1" : "0"); } catch { /* Ignore unavailable WebView storage. */ }
  }, [noticeCollapsed]);
  const membershipOptions = useMemo(() => {
    const counts = new Map<string, number>();
    accounts.forEach((account) => counts.set(planKey(account), (counts.get(planKey(account)) ?? 0) + 1));
    const extraKeys = [...counts.keys()].filter((key) => !KNOWN_PLAN_KEYS.includes(key)).sort();
    const options = [...KNOWN_PLAN_KEYS, ...extraKeys].map((key) => ({ value: key, label: `${planFilterLabel(key)} (${counts.get(key) ?? 0})` }));
    const failed = accounts.filter(hasCoreError).length;
    if (failed) options.push({ value: QUOTA_FAILED_FILTER, label: `${l("配额查询失败", "Quota query failed")} (${failed})` });
    options.push({ value: VALID_ACCOUNT_FILTER, label: `${l("有效账号", "Valid accounts")} (${accounts.filter((account) => !isAbnormalAccount(account)).length})` });
    return options;
  }, [accounts, language]);
  useEffect(() => {
    const available = new Set(membershipOptions.map((option) => option.value));
    setMembershipFilters((current) => current.filter((value) => available.has(value)));
  }, [membershipOptions]);
  const tags = useMemo(() => normalizedTags(accounts.flatMap((item) => item.tags)), [accounts]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return accounts.filter((item) => {
      const matchesQuery = !query || [displayIdentity(item), item.id, item.authId, item.membershipType, planDisplay(item), item.subscriptionStatus, ...item.tags].some((value) => value?.toLocaleLowerCase().includes(query));
      const requireValid = membershipFilters.includes(VALID_ACCOUNT_FILTER);
      const selectedPlans = membershipFilters.filter((value) => value !== VALID_ACCOUNT_FILTER);
      const matchesValid = !requireValid || !isAbnormalAccount(item);
      const matchesMembership = selectedPlans.length === 0 || selectedPlans.some((value) => value === QUOTA_FAILED_FILTER ? hasCoreError(item) : planKey(item) === value);
      const accountTags = item.tags.map(normalizeTag);
      const matchesTags = tagFilters.length === 0 || tagFilters.some((value) => accountTags.includes(normalizeTag(value)));
      return matchesQuery && matchesValid && matchesMembership && matchesTags;
    }).sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      if (sort === "plan_end") {
        const leftReset = billingCycleEndTimestamp(left);
        const rightReset = billingCycleEndTimestamp(right);
        if (leftReset == null && rightReset == null) return 0;
        if (leftReset == null) return 1;
        if (rightReset == null) return -1;
        const result = rightReset - leftReset;
        return ascending ? -result : result;
      }
      const result = sort === "credits"
        ? remainingCreditsPercent(right) - remainingCreditsPercent(left)
        : right.createdAt - left.createdAt;
      return ascending ? -result : result;
    });
  }, [accounts, search, membershipFilters, tagFilters, sort, ascending]);
  const pagination = usePagination(filtered);
  const allGroups = useMemo(() => groupAccounts(filtered, groupByTag, tagFilters, language), [filtered, groupByTag, tagFilters, language]);
  const pageGroups = useMemo(() => buildPaginatedGroups(allGroups, pagination.pageItems), [allGroups, pagination.pageItems]);
  const currentPageIds = pagination.pageItems.map((item) => item.id);
  const allPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selected.has(id));

  const replaceAccount = (updated: CursorAccountView) => setAccounts((items) => items.some((item) => item.id === updated.id) ? items.map((item) => item.id === updated.id ? updated : item) : [updated, ...items]);
  const withBusy = async (ids: string[], action: () => Promise<void>) => {
    if (ids.some((id) => busyRef.current.has(id))) return;
    const started = new Map(busyRef.current); ids.forEach((id) => started.set(id, (started.get(id) ?? 0) + 1)); busyRef.current = started; setBusyCounts(started);
    try { await action(); } finally { const finished = new Map(busyRef.current); ids.forEach((id) => { const count = (finished.get(id) ?? 1) - 1; if (count > 0) finished.set(id, count); else finished.delete(id); }); busyRef.current = finished; setBusyCounts(finished); }
  };

  async function readLocal() { await withBusy(["local"], async () => { try { replaceAccount(await cursor.readLocalAccount()); setMessage({ text: l("已读取并保存本机 Cursor 账号", "Local Cursor account read and saved"), tone: "success" }); } catch (error) { setMessage({ text: `${l("读取失败", "Read failed")}: ${readableForLanguage(error, language)}`, tone: "error" }); } }); }
  async function refreshOne(id: string) { await withBusy([id], async () => { try { const updated = await cursor.refreshAccount(id); replaceAccount(updated); const coreError = updated.lastError ?? updated.coreUsage?.error; setMessage(coreError ? { text: `${l("核心额度刷新失败：", "Core usage refresh failed: ")}${providerErrorSummary(coreError, language)}`, tone: "error" } : updated.sand?.usageError || updated.sand?.accessError ? { text: l("核心额度已更新，Sand 数据未完全更新", "Core usage updated; Sand data is incomplete"), tone: "warning" } : updated.auxiliaryErrors.length ? { text: l("核心额度已更新，账号资料未完全更新", "Core usage updated; account metadata is incomplete"), tone: "warning" } : { text: l("额度已更新", "Usage updated"), tone: "success" }); } catch (error) { setMessage({ text: `${l("查询失败", "Refresh failed")}: ${readableForLanguage(error, language)}`, tone: "error" }); } }); }
  async function refreshMany(ids: string[]) { if (!ids.length || busy.has("refresh-all")) return; await withBusy(["refresh-all"], async () => { try { const results = await cursor.refreshAccounts(ids); for (const item of results) if (item.result) replaceAccount(item.result); const failures = results.filter((item) => item.error || item.result?.lastError || item.result?.coreUsage?.error).length; const partials = results.filter((item) => item.result?.sand?.usageError || item.result?.sand?.accessError).length; const auxiliary = results.filter((item) => item.result?.auxiliaryErrors.length).length; setMessage(failures ? { text: language === "en" ? `Refresh complete: ${failures} core failure(s)${partials ? `; ${partials} account(s) have incomplete Sand data` : ""}${auxiliary ? `; ${auxiliary} account(s) have incomplete metadata` : ""}` : `刷新完成，${failures} 个账号核心额度失败${partials ? `，${partials} 个账号的 Sand 数据未完全更新` : ""}${auxiliary ? `，${auxiliary} 个账号资料未完全更新` : ""}`, tone: "error" } : partials || auxiliary ? { text: language === "en" ? `Core usage updated${partials ? `; ${partials} account(s) have incomplete Sand data` : ""}${auxiliary ? `; ${auxiliary} account(s) have incomplete metadata` : ""}` : `核心额度已更新${partials ? `，${partials} 个账号的 Sand 数据未完全更新` : ""}${auxiliary ? `，${auxiliary} 个账号资料未完全更新` : ""}`, tone: "warning" } : { text: language === "en" ? `Refreshed ${results.length} account(s)` : `已刷新 ${results.length} 个账号`, tone: "success" }); } catch (error) { setMessage({ text: `${l("刷新失败", "Refresh failed")}: ${readableForLanguage(error, language)}`, tone: "error" }); } }); }
  async function submitImport() { if (busy.has("import")) return; const payload = importText; if (!payload.trim()) return; setImportText(""); setImportError(""); await withBusy(["import"], async () => { try { setAccounts(await cursor.importAccounts(payload)); setShowImport(false); setMessage({ text: l("账号已导入并保存到本机", "Accounts imported and saved locally"), tone: "success" }); } catch (error) { setImportError(readableForLanguage(error, language)); } }); }
  async function openExport(ids?: string[]) { if (busy.has("export")) return; const filteredIds = filtered.map((item) => item.id); const selectedFilteredIds = filteredIds.filter((id) => selected.has(id)); const scope = ids ?? (selectedFilteredIds.length ? selectedFilteredIds : filteredIds); if (!scope.length) return; await withBusy(["export"], async () => { try { setExportState({ json: await cursor.exportAccounts(scope), ids: scope, revealed: false, copied: false, pathCopied: false, saving: false, savedPath: "" }); } catch (error) { setMessage({ text: `${l("导出失败", "Export failed")}: ${readableForLanguage(error, language)}`, tone: "error" }); } }); }
  async function copyExport() { if (!exportState) return; try { await navigator.clipboard.writeText(exportState.json); setExportState({ ...exportState, copied: true }); } catch (error) { setMessage({ text: `${l("复制失败", "Copy failed")}: ${readableForLanguage(error, language)}`, tone: "error" }); } }
  async function saveExportFile() { if (!exportState || exportState.saving) return; if (!cursor.isTauri()) { downloadJson(exportState.json); setExportState({ ...exportState, pathCopied: false, savedPath: "cursor-accounts.json" }); return; } const path = await save({ defaultPath: "cursor-accounts.json", filters: [{ name: "JSON", extensions: ["json"] }] }); if (!path) return; setExportState({ ...exportState, pathCopied: false, saving: true }); try { await cursor.saveExport(exportState.ids, path); setExportState((value) => value ? { ...value, pathCopied: false, saving: false, savedPath: path } : value); } catch (error) { setExportState((value) => value ? { ...value, saving: false } : value); setMessage({ text: `${l("保存失败", "Save failed")}: ${readableForLanguage(error, language)}`, tone: "error" }); } }
  async function copySavedPath() { if (!exportState?.savedPath) return; try { await navigator.clipboard.writeText(exportState.savedPath); setExportState((value) => value ? { ...value, pathCopied: true } : value); window.setTimeout(() => setExportState((value) => value ? { ...value, pathCopied: false } : value), 1200); } catch (error) { setMessage({ text: `${l("复制路径失败", "Failed to copy path")}: ${readableForLanguage(error, language)}`, tone: "error" }); } }
  async function revealSavedFile() { if (!exportState?.savedPath || !cursor.isTauri()) return; try { await cursor.revealSavedExport(exportState.savedPath); } catch (error) { setMessage({ text: `${l("打开保存位置失败", "Failed to open saved location")}: ${readableForLanguage(error, language)}`, tone: "error" }); } }
  async function confirmDelete() { if (!deleteTargets.length || busy.has("delete")) return; const ids = deleteTargets; setDeleteError(""); await withBusy(["delete"], async () => { try { if (ids.length === 1) await cursor.deleteAccount(ids[0]); else await cursor.deleteAccounts(ids); setDeleteTargets([]); setAccounts((items) => items.filter((item) => !ids.includes(item.id))); setSelected((items) => { const next = new Set(items); ids.forEach((id) => next.delete(id)); return next; }); setMessage({ text: language === "en" ? `Deleted ${ids.length} local account(s) and credential backups` : `已删除 ${ids.length} 个本地账号及凭据备份`, tone: "success" }); } catch (error) { setDeleteError(readableForLanguage(error, language)); } }); }
  async function saveTags() { if (!tagTarget || busy.has("tags")) return; const tags = inputTags(tagText); if (tags.length > 32) { setTagError(l("最多只能保存 32 个标签", "You can save at most 32 tags")); return; } if (tags.some((tag) => tag.length > 128)) { setTagError(l("单个标签不能超过 128 个字符", "Each tag must be at most 128 characters")); return; } setTagError(""); await withBusy(["tags"], async () => { try { replaceAccount(await cursor.updateAccountTags(tagTarget.id, tags)); setTagTarget(null); setTagText(""); setMessage({ text: l("账号标签已更新", "Account tags updated"), tone: "success" }); } catch (error) { setTagError(readableForLanguage(error, language)); } }); }

  return <div className="app-container app-container-side-nav-classic">
    <aside className="side-nav side-nav-classic">
      <div className="nav-brand"><div className="side-nav-brand-main"><span className="brand-logo"><Gauge size={22}/></span><strong className="side-nav-brand-title">Usage Viewer</strong></div></div>
      <div className="nav-items nav-items-no-scroll">
        <button className={page === "cursor" ? "nav-item active" : "nav-item"} onClick={() => setPage("cursor")}><LayoutGrid className="nav-item-icon"/><span className="nav-item-text">{t.cursor}</span><b className="nav-count">{accounts.length}</b></button>
      </div>
      <div className="nav-bottom-actions">
        <button className={page === "settings" ? "nav-item active" : "nav-item"} aria-label={t.settings} onClick={() => setPage("settings")}><SettingsIcon className="nav-item-icon"/><span className="nav-item-text">{t.settings}</span></button>
        <div className="side-nav-version">v{updater.installedVersion} · CC BY-NC-SA<br/><span>UNOFFICIAL</span></div>
      </div>
    </aside>
    <main className="main-wrapper"><div className="main-content">
      {page === "settings" ? <SettingsPage language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} updater={updater} /> : <>
        <div className="ghcp-accounts-page cursor-accounts-page">
        <div className={`ghcp-flow-notice ${noticeCollapsed ? "collapsed" : ""}`} role="note" aria-live="polite">
          <button type="button" className="ghcp-flow-notice-toggle" aria-expanded={!noticeCollapsed} onClick={() => setNoticeCollapsed((value) => !value)}><span className="ghcp-flow-notice-title"><CircleAlert size={16}/><span>{l("Cursor 账号管理说明（点击展开/收起）", "Cursor account management (expand/collapse)")}</span></span><ChevronDown className={`ghcp-flow-notice-arrow ${noticeCollapsed ? "collapsed" : ""}`} size={16}/></button>
          {!noticeCollapsed && <div className="ghcp-flow-notice-body"><p className="ghcp-flow-notice-desc">{t.localNotice}</p><ul className="ghcp-flow-notice-list"><li>{l("账号凭据仅用于你主动发起的读取、导入、刷新和导出操作。", "Credentials are used only for actions you explicitly start: read, import, refresh, and export.")}</li><li>{l("启动应用不会读取 Cursor 数据库，也不会自动查询 Cursor 额度。", "Starting the app does not read the Cursor database or refresh Cursor usage.")}</li></ul></div>}
        </div>
        {message && <div className={`message-bar ${message.tone}`}>{message.text}<button type="button" aria-label={l("关闭消息", "Dismiss message")} onClick={() => setMessage(null)}><X size={14}/></button></div>}
        <section className="toolbar">
          <div className="toolbar-left">
            <label className="search-box"><Search size={16} className="search-icon"/><input aria-label={t.search} placeholder={t.search} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <div className="view-switcher" aria-label={l("布局选择", "Layout")}><button className={`view-btn ${layout === "list" ? "active" : ""}`} title={l("列表布局", "List view")} aria-label={l("列表布局", "List view")} onClick={() => setLayout("list")}><List size={16}/></button><button className={`view-btn ${layout === "grid" ? "active" : ""}`} title={l("网格布局", "Grid view")} aria-label={l("网格布局", "Grid view")} onClick={() => setLayout("grid")}><LayoutGrid size={16}/></button></div>
             <MultiSelectFilterDropdown options={membershipOptions} selectedValues={membershipFilters} allLabel={`ALL (${accounts.length})`} filterLabel={l("套餐", "Plan")} clearLabel={l("清空筛选", "Clear filter")} emptyLabel={l("暂无套餐", "No plans")} ariaLabel={l("套餐筛选", "Plan filter")} onToggleValue={(value) => setMembershipFilters((current) => toggleValue(current, value))} onClear={() => setMembershipFilters([])}/>
             <AccountTagFilterDropdown language={language} availableTags={tags} selectedTags={tagFilters} groupByTag={groupByTag} onToggleTag={(value) => setTagFilters((current) => toggleValue(current, value))} onToggleGrouping={() => setGroupByTag((value) => !value)} onClear={() => setTagFilters([])}/>
             <SingleSelectFilterDropdown value={sort} options={[{ value: "created_at", label: l("按创建时间", "By creation time") }, { value: "credits", label: l("按剩余 Credits", "By remaining credits") }, { value: "plan_end", label: l("按配额周期结束时间", "By cycle end time") }]} ariaLabel={l("排序", "Sort")} icon={<ArrowDownWideNarrow size={14}/>} onChange={(value) => setSort(value as AccountSort)}/>
            <button className="sort-direction-btn" title={ascending ? l("当前：升序，点击切换为降序", "Current: ascending; click for descending") : l("当前：降序，点击切换为升序", "Current: descending; click for ascending")} aria-label={l("切换排序方向", "Toggle sort direction")} onClick={() => setAscending((value) => !value)}>{ascending ? "⬆" : "⬇"}</button>
          </div>
          <div className="toolbar-right">
             <button className="btn btn-primary icon-only" title={t.readLocal} aria-label={t.readLocal} onClick={() => void readLocal()} disabled={busy.has("local")}><HardDriveDownload size={14} className={busy.has("local") ? "loading-spinner" : ""}/></button>
            <button className="btn btn-secondary icon-only" title={t.refreshAll} aria-label={t.refreshAll} onClick={() => void refreshMany(accounts.map((item) => item.id))} disabled={!accounts.length || busy.has("refresh-all")}><RefreshCw size={14} className={busy.has("refresh-all") ? "loading-spinner" : ""}/></button>
            <button className="btn btn-secondary icon-only" title={privacy ? l("显示邮箱", "Show email") : l("隐藏邮箱", "Hide email")} aria-label={privacy ? l("显示邮箱", "Show email") : l("隐藏邮箱", "Hide email")} onClick={() => setPrivacy((value) => !value)}>{privacy ? <EyeOff size={14}/> : <Eye size={14}/>}</button>
            <button className="btn btn-secondary icon-only" title={t.import} aria-label={t.import} onClick={() => { setImportError(""); setShowImport(true); }} disabled={busy.has("import")}><Download size={14}/></button>
            <button className="btn btn-secondary icon-only" title={exportButtonLabel(selected, filtered, language)} aria-label={exportButtonLabel(selected, filtered, language)} onClick={() => void openExport()} disabled={!filtered.length || busy.has("export")}><Upload size={14}/></button>
            {accounts.some(hasCoreError) && <button className="btn btn-danger icon-only" title={language === "en" ? `Delete quota-failed accounts (${accounts.filter(hasCoreError).length})` : `删除配额查询失败账号 (${accounts.filter(hasCoreError).length})`} aria-label={language === "en" ? `Delete quota-failed accounts (${accounts.filter(hasCoreError).length})` : `删除配额查询失败账号 (${accounts.filter(hasCoreError).length})`} onClick={() => { setDeleteError(""); setDeleteTargets(accounts.filter(hasCoreError).map((account) => account.id)); }}><CircleAlert size={14}/></button>}
          </div>
        </section>
        {filtered.length > 0 && (
          <AccountSelectionToolbar
            language={language}
            selectedCount={selected.size}
            allSelected={allPageSelected}
            disabled={currentPageIds.length === 0}
            onToggleSelectAll={() => setSelected((old) => {
              const next = new Set(old);
              currentPageIds.forEach((id) => allPageSelected ? next.delete(id) : next.add(id));
              return next;
            })}
            onClearSelection={() => setSelected(new Set())}
            actions={<><button className="btn btn-secondary" onClick={() => void refreshMany([...selected])}>{l("刷新选中", "Refresh selected")}</button><button className="btn btn-secondary" onClick={() => void openExport()}>{t.export}</button><button className="btn btn-danger" onClick={() => setDeleteTargets([...selected])}>{l("删除选中", "Delete selected")}</button></>}
          />
        )}
        {accountsLoading && accounts.length === 0 ? <div className="loading-container"><RefreshCw size={24} className="loading-spinner"/><p>{l("加载中...", "Loading...")}</p></div> : accounts.length === 0 ? <div className="empty-state" role="region" aria-label={t.empty}><LayoutGrid size={48}/><h3>{t.empty}</h3><p>{l("读取本机账号，或粘贴 Cockpit JSON 批量导入。", "Read the local account or paste Cockpit JSON to import accounts.")}</p><div className="empty-state-actions"><button className="btn btn-primary" aria-label={t.readLocal} onClick={() => void readLocal()} disabled={busy.has("local")}><HardDriveDownload size={16}/>{t.readLocal}</button><button className="btn btn-secondary" aria-label={t.import} onClick={() => setShowImport(true)} disabled={busy.has("import")}><Download size={16}/>{t.import}</button></div></div> : pagination.pageItems.length === 0 ? <div className="empty-state"><h3>{l("没有匹配的账号", "No matching accounts")}</h3><p>{l("请尝试调整搜索或筛选条件", "Try changing the search or filters")}</p></div> : layout === "grid" ? <div className={groupByTag ? "tag-group-list" : "grid-view-container"}>{pageGroups.map((group, index) => <section className={groupByTag ? "tag-group-section" : ""} key={group.label || `all-${index}`}>{group.label && <div className="tag-group-header"><span className="tag-group-title">{group.label}</span><span className="tag-group-count">{group.totalCount}</span></div>}<div className="ghcp-accounts-grid">{group.accounts.map((account) => <AccountCard key={`${group.label}-${account.id}`} language={language} account={account} privacy={privacy} selected={selected.has(account.id)} busy={busy.has(account.id)} onSelect={() => setSelected((old) => { const next = new Set(old); next.has(account.id) ? next.delete(account.id) : next.add(account.id); return next; })} onRefresh={() => void refreshOne(account.id)} onExport={() => void openExport([account.id])} onEditTags={() => { setTagError(""); setTagTarget(account); setTagText(account.tags.join(", ")); }} onDelete={() => { setDeleteError(""); setDeleteTargets([account.id]); }} />)}</div></section>)}</div> : <AccountTable language={language} groups={pageGroups} grouped={groupByTag} privacy={privacy} selected={selected} busy={busy} allPageSelected={allPageSelected} onToggleSelectAll={() => setSelected((old) => { const next = new Set(old); currentPageIds.forEach((id) => allPageSelected ? next.delete(id) : next.add(id)); return next; })} onSelect={(id) => setSelected((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; })} onRefresh={(id) => void refreshOne(id)} onExport={(id) => void openExport([id])} onEditTags={(id) => { const account = accounts.find((item) => item.id === id); if (account) { setTagError(""); setTagTarget(account); setTagText(account.tags.join(", ")); } }} onDelete={(id) => { setDeleteError(""); setDeleteTargets([id]); }}/>}
        <PaginationControls language={language} totalItems={filtered.length} currentPage={pagination.page} totalPages={pagination.pageCount} pageSize={pagination.pageSize} pageSizeOptions={PAGE_SIZES} rangeStart={(pagination.page - 1) * pagination.pageSize + 1} rangeEnd={Math.min(pagination.page * pagination.pageSize, filtered.length)} onPageSizeChange={pagination.setPageSize} onPreviousPage={() => pagination.setPage(pagination.page - 1)} onNextPage={() => pagination.setPage(pagination.page + 1)}/>
        </div>
      </>}
    </div></main>
    <UpdateDialog language={language} updater={updater}/>
    {updater.versionChange && (
      <VersionChangedDialog
        language={language}
        change={updater.versionChange}
        onClose={updater.dismissVersionChange}
      />
    )}
    {showImport && <Modal language={language} title={l("粘贴 Cockpit JSON", "Paste Cockpit JSON")} className="ghcp-add-modal" overlayClassName="account-add-modal-overlay" footer={<><button className="btn btn-secondary" disabled={busy.has("import")} onClick={() => { setImportError(""); setShowImport(false); setImportText(""); }}>{l("取消", "Cancel")}</button><button className="btn btn-primary" disabled={!importText.trim() || busy.has("import")} onClick={() => void submitImport()}>{busy.has("import") ? l("导入中…", "Importing…") : l("导入", "Import")}</button></>} onClose={() => { if (!busy.has("import")) { setImportError(""); setShowImport(false); setImportText(""); } }}><p className="sensitive-warning">{l("支持单对象、数组、accounts/items 包装；提交后立即清空。Token 将明文保存在本机。", "Supports a single object, array, or accounts/items wrapper. The input is cleared immediately after submission. Tokens are stored locally in plaintext.")}</p><textarea data-dialog-autofocus aria-label="Cockpit Tools JSON" value={importText} onChange={(event) => { setImportError(""); setImportText(event.target.value); }} />{importError && <p className="modal-inline-error" role="alert">{l("导入失败：", "Import failed: ")}{importError}</p>}</Modal>}
    {exportState && <Modal language={language} title={l("完整账号 JSON", "Full account JSON")} className="export-json-modal" onClose={() => setExportState(null)}><p className="sensitive-warning">{l("包含明文 Access / Refresh Token。预览默认遮罩，请谨慎复制或保存。", "Contains plaintext access and refresh tokens. The preview is masked by default; copy or save it carefully.")}</p><div className="export-json-actions"><button className="btn btn-secondary" onClick={() => setExportState({ ...exportState, revealed: !exportState.revealed })}>{exportState.revealed ? l("隐藏", "Hide") : l("显示", "Reveal")}</button><button className="btn btn-secondary" onClick={() => void copyExport()}>{exportState.copied ? l("已复制", "Copied") : l("复制完整 JSON", "Copy full JSON")}</button><button className="btn btn-primary" disabled={exportState.saving} onClick={() => void saveExportFile()}>{exportState.saving ? l("保存中…", "Saving…") : l("保存 JSON", "Save JSON")}</button></div>{exportState.savedPath && <div className="export-saved-path"><strong>{l("已保存到", "Saved to")}</strong><code>{exportState.savedPath}</code><div className="export-saved-actions">{cursor.isTauri() && <button className="btn btn-secondary" onClick={() => void revealSavedFile()}>{l("打开保存位置", "Open location")}</button>}<button className="btn btn-secondary" onClick={() => void copySavedPath()}>{exportState.pathCopied ? l("路径已复制", "Path copied") : l("复制路径", "Copy path")}</button></div></div>}<textarea className="export-json-textarea" aria-label={l("账号 JSON 预览", "Account JSON preview")} readOnly spellCheck={false} value={exportState.revealed ? exportState.json : maskJson(exportState.json)}/></Modal>}
    {deleteTargets.length > 0 && <Modal language={language} title={deleteTargets.length === 1 ? l("删除本地账号？", "Delete local account?") : language === "en" ? `Delete ${deleteTargets.length} local accounts?` : `删除 ${deleteTargets.length} 个本地账号？`} footer={<><button className="btn btn-secondary" disabled={busy.has("delete")} onClick={() => { setDeleteError(""); setDeleteTargets([]); }}>{l("取消", "Cancel")}</button><button className="btn btn-danger" disabled={busy.has("delete")} onClick={() => void confirmDelete()}>{busy.has("delete") ? l("删除中…", "Deleting…") : l("删除", "Delete")}</button></>} onClose={() => { if (!busy.has("delete")) { setDeleteError(""); setDeleteTargets([]); } }}><p>{l("账号明细、凭据和对应 .bak 将从本机删除，无法撤销。", "Account details, credentials, and matching .bak files will be deleted locally. This cannot be undone.")}</p>{deleteError && <p className="modal-inline-error" role="alert">{l("删除失败：", "Delete failed: ")}{deleteError}</p>}</Modal>}
    {tagTarget && <Modal language={language} title={l("编辑账号标签", "Edit account tags")} footer={<><button className="btn btn-secondary" disabled={busy.has("tags")} onClick={() => { setTagError(""); setTagTarget(null); }}>{l("取消", "Cancel")}</button><button className="btn btn-primary" disabled={busy.has("tags")} onClick={() => void saveTags()}>{busy.has("tags") ? l("保存中…", "Saving…") : l("保存标签", "Save tags")}</button></>} onClose={() => { if (!busy.has("tags")) { setTagError(""); setTagTarget(null); } }}><p>{l("使用逗号或换行分隔标签，最多 32 个。", "Separate tags with commas or line breaks. Maximum 32 tags.")}</p><textarea data-dialog-autofocus aria-label={l("账号标签", "Account tags")} value={tagText} onChange={(event) => { setTagError(""); setTagText(event.target.value); }}/>{tagError && <p className="modal-inline-error" role="alert">{tagError}</p>}</Modal>}
    {closePrompt && <Modal language={language} title={l("关闭 Cursor Usage Viewer", "Close Cursor Usage Viewer")} footer={<><button className="btn btn-secondary" onClick={() => { setClosePrompt(false); void cursor.performClose("tray", rememberClose); }}>{l("最小化到托盘", "Minimize to tray")}</button><button className="btn btn-danger" onClick={() => void cursor.performClose("exit", rememberClose)}>{l("退出", "Exit")}</button></>} onClose={() => setClosePrompt(false)}><p>{l("选择最小化到系统托盘继续运行，或完全退出应用。托盘不会后台刷新 Cursor 额度。", "Keep the app running in the system tray or exit completely. The tray never refreshes Cursor usage in the background.")}</p><label className="remember-close"><input type="checkbox" checked={rememberClose} onChange={(event) => setRememberClose(event.target.checked)}/>{l("记住选择", "Remember choice")}</label></Modal>}
  </div>;
}

function AccountCard({ language, account, privacy, selected, busy, onSelect, onRefresh, onExport, onEditTags, onDelete }: { language: Language; account: CursorAccountView; privacy: boolean; selected: boolean; busy: boolean; onSelect: () => void; onRefresh: () => void; onExport: () => void; onEditTags: () => void; onDelete: () => void }) {
  const usage = account.coreUsage; const sand = account.sand;
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const identity = maskSensitiveValue(displayIdentity(account), privacy);
  const authId = maskSensitiveValue(account.authId ?? l("未知", "Unknown"), privacy);
  const coreError = account.lastError ?? usage?.error;
  const banned = isBannedAccount(account);
  const statusError = account.status?.trim().toLocaleLowerCase() === "error";
  return <article className={`ghcp-account-card account-card ${selected ? "selected" : ""} ${account.isCurrent ? "current is-current" : ""} ${banned ? "disabled" : ""}`}>
    <div className="card-top"><span className="card-select"><input type="checkbox" aria-label={`${l("选择", "Select")} ${identity}`} checked={selected} onChange={onSelect}/></span><span className="account-email identity" title={identity}><strong>{identity}</strong></span>{account.isCurrent && <span className="current-tag">{l("当前", "Current")}</span>}{statusError && <span className="status-pill warning" title={account.statusReason ?? l("账号刷新失败", "Account refresh failed")}><CircleAlert size={12}/>{l("刷新失败", "Refresh failed")}</span>}{coreError && <span className="status-pill warning" title={coreError}><CircleAlert size={12}/>{l("配额查询失败", "Quota query failed")}</span>}{banned && <span className="status-pill forbidden" title={account.statusReason ?? l("账号不可用", "Account unavailable")}><Lock size={12}/>{l("已禁用", "Forbidden")}</span>}<span className={`tier-badge ${planTone(account.membershipType, account)}`}>{planDisplay(account)}</span></div>
    <div className="account-sub-line"><span className="kiro-table-subline" title={`Auth ID: ${authId}`}>Auth ID: {authId}</span></div>
    {account.tags.length > 0 && <div className="card-tags">{account.tags.slice(0,2).map((tag) => <span className="tag-pill" key={tag}>{tag}</span>)}{account.tags.length > 2 && <span className="tag-pill more">+{account.tags.length - 2}</span>}</div>}
    <div className="ghcp-quota-section">{usage ? <><Quota language={language} label="Total Usage" value={usage.total} reset={usage.billingCycleEnd} currency/><Quota language={language} label="Auto + Composer" value={usage.autoComposer}/><Quota language={language} label="API Usage" value={usage.api}/><OnDemandQuota language={language} usage={usage}/></> : <QuotaEmpty language={language}/>}<SandQuota language={language} sand={sand}/></div>
    {coreError && <p className="account-error" title={coreError}>{l("核心额度", "Core usage")}: {providerErrorSummary(coreError, language)}</p>}
    {account.auxiliaryErrors.length > 0 && <p className="account-warning">{l("账号资料未完全更新", "Account metadata incomplete")}: {account.auxiliaryErrors.map((error) => providerDiagnosticSummary(error, language)).join(" · ")}</p>}
    <footer className="card-footer"><span className="card-date">{usage ? `${usage.source === "live" ? l("实时查询", "Live") : l("导入缓存", "Imported cache")} · ${dateTime(usage.updatedAt)}` : l("暂无额度数据", "No usage data")}</span><div className="card-actions"><button className="card-action-btn" title={l("编辑标签", "Edit tags")} aria-label={`${l("编辑标签", "Edit tags")} ${identity}`} onClick={onEditTags}><Tag size={14}/></button><button className="card-action-btn" title={l("刷新", "Refresh")} aria-label={`${l("刷新", "Refresh")} ${identity}`} onClick={onRefresh} disabled={busy}><RotateCw size={14} className={busy ? "loading-spinner" : ""}/></button><button className="card-action-btn" title={l("导出", "Export")} aria-label={`${l("导出", "Export")} ${identity}`} onClick={onExport}><Upload size={14}/></button><button className="card-action-btn danger" title={l("删除", "Delete")} aria-label={`${l("删除", "Delete")} ${identity}`} onClick={onDelete}><Trash2 size={14}/></button></div></footer>
  </article>;
}

function AccountTable({ language, groups, grouped, privacy, selected, busy, allPageSelected, onToggleSelectAll, onSelect, onRefresh, onExport, onEditTags, onDelete }: { language: Language; groups: AccountGroup[]; grouped: boolean; privacy: boolean; selected: Set<string>; busy: Set<string>; allPageSelected: boolean; onToggleSelectAll: () => void; onSelect: (id: string) => void; onRefresh: (id: string) => void; onExport: (id: string) => void; onEditTags: (id: string) => void; onDelete: (id: string) => void }) {
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const renderRow = (account: CursorAccountView, groupLabel = "") => { const updatedAt = account.coreUsage ? dateTimeParts(account.coreUsage.updatedAt) : null; const coreError = account.lastError ?? account.coreUsage?.error; const identity = maskSensitiveValue(displayIdentity(account), privacy); const authId = maskSensitiveValue(account.authId ?? l("未知", "Unknown"), privacy); const banned = isBannedAccount(account); const statusError = account.status?.trim().toLocaleLowerCase() === "error"; return <tr key={`${groupLabel}-${account.id}`} className={`${account.isCurrent ? "current" : ""} ${selected.has(account.id) ? "selected" : ""} ${banned ? "disabled" : ""}`}>
    <td><input type="checkbox" aria-label={`${l("选择", "Select")} ${identity}`} checked={selected.has(account.id)} onChange={() => onSelect(account.id)}/></td>
    <td><div className="table-account-identity"><strong title={identity}>{identity}</strong>{account.isCurrent && <span className="current-tag">{l("当前", "Current")}</span>}<span className="table-auth-id">Auth ID: {authId}</span>{(statusError || banned) && <span className="account-status-line">{statusError && <span className="status-pill warning" title={account.statusReason ?? l("账号刷新失败", "Account refresh failed")}><CircleAlert size={12}/>{l("刷新失败", "Refresh failed")}</span>}{banned && <span className="status-pill forbidden" title={account.statusReason ?? l("账号不可用", "Account unavailable")}><Lock size={12}/>{l("已禁用", "Forbidden")}</span>}</span>}{coreError && <span className="table-account-error" title={coreError}>{l("核心额度", "Core usage")} {providerErrorSummary(coreError, language)}</span>}{account.tags.length > 0 && <span className="account-tags-inline">{account.tags.slice(0,3).map((tag) => <span className="tag-pill" key={tag}>{tag}</span>)}{account.tags.length > 3 && <span className="tag-pill more">+{account.tags.length - 3}</span>}</span>}{account.auxiliaryErrors.length > 0 && <span className="table-account-warning">{l("账号资料未完全更新", "Metadata incomplete")}</span>}</div></td>
    <td><span className={`tier-badge ${planTone(account.membershipType, account)}`}>{planDisplay(account)}</span></td>
    <td>{account.coreUsage ? <TableQuota language={language} value={account.coreUsage.total} reset={account.coreUsage.billingCycleEnd} currency/> : <TableQuotaEmpty language={language}/>}</td><td>{account.coreUsage ? <TableQuota language={language} value={account.coreUsage.autoComposer}/> : <TableQuotaEmpty language={language}/>}</td><td>{account.coreUsage ? <TableQuota language={language} value={account.coreUsage.api}/> : <TableQuotaEmpty language={language}/>}</td><td>{account.coreUsage ? <TableOnDemandQuota language={language} usage={account.coreUsage}/> : <TableQuotaEmpty language={language}/>}</td><td><TableSand language={language} sand={account.sand}/></td>
    <td className="table-updated">{updatedAt ? <><span className="table-updated-date">{updatedAt.date}</span><span className="table-updated-time">{updatedAt.time}</span></> : l("暂无数据", "No data")}</td>
    <td><div className="table-actions"><button className="action-btn" title={l("编辑标签", "Edit tags")} aria-label={`${l("编辑标签", "Edit tags")} ${identity}`} onClick={() => onEditTags(account.id)}><Tag size={14}/></button><button className="action-btn" title={l("刷新", "Refresh")} aria-label={`${l("刷新", "Refresh")} ${identity}`} onClick={() => onRefresh(account.id)} disabled={busy.has(account.id)}><RotateCw size={14} className={busy.has(account.id) ? "loading-spinner" : ""}/></button><button className="action-btn" title={l("导出", "Export")} aria-label={`${l("导出", "Export")} ${identity}`} onClick={() => onExport(account.id)}><Upload size={14}/></button><button className="action-btn danger" title={l("删除", "Delete")} aria-label={`${l("删除", "Delete")} ${identity}`} onClick={() => onDelete(account.id)}><Trash2 size={14}/></button></div></td>
  </tr>; };
  return <div className={`account-table-container ${grouped ? "grouped" : ""}`}><table className="account-table" aria-label={l("Cursor 账号列表", "Cursor account list")}><thead><tr><th><input type="checkbox" aria-label={l("选择当前页全部账号", "Select all accounts on this page")} checked={allPageSelected} onChange={onToggleSelectAll}/></th><th>{l("账号", "Account")}</th><th>{l("套餐", "Plan")}</th><th>Total</th><th>Auto + Composer</th><th>API</th><th>On-Demand</th><th>Grok / Sand</th><th>{l("更新时间", "Updated")}</th><th>{l("操作", "Actions")}</th></tr></thead><tbody>{groups.map((group, index) => <Fragment key={group.label || `all-${index}`}>{grouped && <tr className="tag-group-row"><td colSpan={10}><div className="tag-group-header"><span className="tag-group-title">{group.label}</span><span className="tag-group-count">{group.totalCount}</span></div></td></tr>}{group.accounts.map((account) => renderRow(account, group.label))}</Fragment>)}</tbody></table></div>;
}

function TableQuota({ language, value, reset, currency = false }: { language: Language; value?: UsageAmount; reset?: string | null; currency?: boolean }) { const p = usagePercent(value); const tone = quotaTone(p, value?.enabled); return <div className="table-quota"><span className={`quota-value ${tone}`}>{value?.enabled === false ? localized(language, "已禁用", "Disabled") : percent(p, language)}</span>{currency && value?.used != null && <span className="quota-cost">{dollarsFromCents(value.used)} / {value.limit == null ? "—" : dollarsFromCents(value.limit)}</span>}{reset && <span className="quota-reset">{localized(language, "重置", "Reset")}: {dateTime(new Date(reset).getTime())}</span>}<span className="quota-progress-track"><span className={`quota-progress-bar ${tone}`} style={{ width: `${p ?? 0}%` }}/></span></div>; }
function TableOnDemandQuota({ language, usage }: { language: Language; usage: CursorAccountView["coreUsage"] }) { const presentation = onDemandPresentation(usage, language); return <div className="table-quota"><span className={`quota-value ${presentation.tone}`}>{presentation.valueText}</span>{presentation.costText && <span className="quota-cost">{presentation.costText}</span>}<span className="quota-progress-track"><span className={`quota-progress-bar ${presentation.tone}`} style={{ width: `${presentation.percent}%` }}/></span></div>; }
function TableQuotaEmpty({ language }: { language: Language }) { return <span className="quota-empty">{localized(language, "暂无额度数据", "No usage data")}</span>; }
function TableSand({ language, sand }: { language: Language; sand: CursorAccountView["sand"] }) {
  const presentation = sandPresentation(sand, language);
  const reset = sand?.usageError ? null : sandTableReset(sand?.nextResetTimestampUtc, language);
  return <div className="table-sand-status" aria-label={localized(language, "Grok / Sand 状态", "Grok / Sand status")}>
    <div className="table-sand-primary"><strong title={presentation.usage}>{presentation.compactUsage}</strong><span className={`sand-access-badge ${presentation.accessTone}`}>{presentation.access}</span></div>
    <span className="table-sand-plan" title={`${presentation.planLabel} ${presentation.plan}`}>{presentation.planStale ? `${presentation.planLabel} ${presentation.plan}` : presentation.plan}</span>
    {presentation.blockReason && <span className={`table-sand-reason ${sand?.accessError ? "warning-text" : "danger-text"}`} title={`${presentation.blockReasonLabel} ${presentation.blockReason}`}>{presentation.blockReasonLabel} {presentation.blockReason}</span>}
    <span className={`table-sand-freshness ${presentation.incomplete ? "warning-text" : ""}`} title={presentation.freshness}>{reset ? <><span>{localized(language, "重置", "Reset")} {reset.date}</span><span>{reset.time} ({reset.relative}){sand?.accessError ? ` · ${localized(language, "资格未更新", "Access not updated")}` : ""}</span></> : presentation.freshness}</span>
  </div>;
}

function Quota({ language, label, value, reset, currency = false }: { language: Language; label: string; value?: UsageAmount; reset?: string | null; currency?: boolean }) { const p = usagePercent(value); const tone = quotaTone(p, value?.enabled); const valueText = value?.enabled === false ? localized(language, "已禁用", "Disabled") : percent(p, language); return <div className="quota-item windsurf-credit-item"><div className="quota-header"><span className="quota-label">{label}</span><span className={`quota-pct ${tone}`}>{valueText}</span></div>{value?.enabled !== false && value?.used != null && <div className="windsurf-credit-meta-row"><span className="windsurf-credit-used">{currency ? dollarsFromCents(value.used) : number(value.used)} / {value.limit == null ? "—" : currency ? dollarsFromCents(value.limit) : number(value.limit)}</span></div>}{reset && <div className="windsurf-credit-meta-row"><span className="windsurf-credit-used">{localized(language, "重置", "Reset")}: {dateTime(new Date(reset).getTime())}</span></div>}<div className="quota-bar-track"><div className={`quota-bar ${tone}`} style={{ width: `${p ?? 0}%` }}/></div></div>; }
function QuotaEmpty({ language }: { language: Language }) { return <div className="quota-empty-card"><Gauge size={18}/><span>{localized(language, "暂无额度数据", "No usage data")}</span></div>; }
function OnDemandQuota({ language, usage }: { language: Language; usage: CursorAccountView["coreUsage"] }) { const presentation = onDemandPresentation(usage, language); return <div className="quota-item windsurf-credit-item"><div className="quota-header"><span className="quota-label">On-Demand</span><span className={`quota-pct ${presentation.tone}`}>{presentation.valueText}</span></div>{presentation.costText && <div className="windsurf-credit-meta-row"><span className="windsurf-credit-used">{presentation.costText}</span></div>}<div className="quota-bar-track"><div className={`quota-bar ${presentation.tone}`} style={{ width: `${presentation.percent}%` }}/></div></div>; }
function SandQuota({ language, sand }: { language: Language; sand: CursorAccountView["sand"] }) {
  const presentation = sandPresentation(sand, language);
  const reset = sandCardReset(sand?.nextResetTimestampUtc, language, Boolean(sand?.usageError));
  const usageLabel = sand?.usageError ? (presentation.usagePercent == null ? localized(language, "未更新", "Not updated") : localized(language, "上次已用", "Last used")) : localized(language, "本周期已用", "Period used");
  const usageValue = presentation.usagePercent == null ? "—" : percent(presentation.usagePercent, language);
  const usageNumber = presentation.usagePercent == null ? "—" : presentation.usagePercent.toFixed(1);
  const usageTone = quotaTone(presentation.usagePercent);
  const accessText = sand?.accessError ? localized(language, "未更新", "Not updated") : sand?.accessGranted === true ? localized(language, "可访问", "Granted") : sand?.accessGranted === false ? localized(language, "不可访问", "Blocked") : localized(language, "未知", "Unknown");
  return <div className={`sand-status-panel ${presentation.incomplete ? "incomplete" : ""}`} role="group" aria-label={localized(language, "套餐额度状态", "Plan quota status")}>
    <div
      className={`sand-quota-ring ${usageTone} ${sand?.usageError ? "stale" : ""}`}
      style={{ "--sand-progress": `${presentation.usagePercent ?? 0}%` } as CSSProperties}
      title={presentation.usage}
      aria-label={`${usageLabel} ${usageValue}`}
    >
      <svg className="sand-quota-ring-svg" viewBox="0 0 82 82" aria-hidden="true">
        <circle className="sand-quota-track" cx="41" cy="41" r="34" pathLength="100"/>
        {(presentation.usagePercent ?? 0) > 0 && <circle
          className="sand-quota-progress"
          cx="41"
          cy="41"
          r="34"
          pathLength="100"
          style={{ strokeDasharray: `${presentation.usagePercent} 100` }}
        />}
      </svg>
      <div className="sand-quota-ring-content">
        <strong className="sand-quota-ring-value">{usageNumber}{presentation.usagePercent != null && <span className="sand-quota-ring-unit">%</span>}</strong>
        <span>{usageLabel}</span>
      </div>
    </div>
    <div className="sand-status-details">
      <div className="sand-detail-row sand-plan-row">
        <span className="sand-detail-label">{presentation.planLabel}</span>
        <strong className="sand-detail-value" title={presentation.plan}>{presentation.plan}</strong>
        <span className={`sand-access-text ${presentation.accessTone}`} title={presentation.access} aria-label={presentation.access}>{accessText}</span>
      </div>
      <div className="sand-detail-row sand-reset-row">
        <span className="sand-detail-label">{reset.label}</span>
        <strong className="sand-detail-value" title={reset.title}>{reset.value}</strong>
        {reset.relative && <span className="sand-reset-relative">{reset.relative}</span>}
      </div>
      {presentation.blockReason && <div className={`sand-status-alert ${sand?.accessError ? "stale" : ""}`}>{presentation.blockReasonLabel} <code>{presentation.blockReason}</code></div>}
      {presentation.incomplete && <div className="sand-status-note warning-text">{localized(language, "Sand 数据未完全更新", "Sand data is incomplete")} · {presentation.failures}</div>}
    </div>
  </div>;
}
function quotaTone(value: number | null, enabled?: boolean | null) { return enabled === false || value == null ? "low" : value >= 90 ? "critical" : value >= 70 ? "medium" : "high"; }
function planTone(value: string | null, account?: CursorAccountView) {
  switch (normalizeMembershipType(value)) {
    case "ultra": return "ultra";
    case "enterprise": return account?.isEnterprise === false ? "team" : "enterprise";
    case "pro_plus": return "plus";
    case "pro":
    case "free_trial": return "pro";
    case "free": return "free";
    default: return "unknown";
  }
}
function planDisplay(account: CursorAccountView) { const normalized = normalizeMembershipType(account.membershipType); const trial = account.subscriptionStatus?.trim().toLocaleLowerCase() === "trialing"; if (normalized === "ultra") return "ULTRA"; if (normalized === "pro_plus") return trial ? "PRO+ TRIAL" : "PRO+"; if (normalized === "pro") return trial ? "PRO TRIAL" : "PRO"; if (normalized === "free_trial") return "PRO TRIAL"; if (normalized === "free") return "FREE"; if (normalized === "enterprise") return account.isEnterprise === false ? "TEAM" : "ENTERPRISE"; return normalized ? normalized.toLocaleUpperCase() : "UNKNOWN"; }
function Modal({ language, title, children, footer, className = "", overlayClassName = "", onClose }: { language: Language; title: string; children: React.ReactNode; footer?: React.ReactNode; className?: string; overlayClassName?: string; onClose: () => void }) { const dialogRef = useDialogFocus<HTMLElement>(onClose); return <div className={`modal-overlay ${overlayClassName}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><h2>{title}</h2><button className="modal-close" aria-label={localized(language, "关闭", "Close")} onClick={onClose}><X size={18}/></button></div><div className="modal-body">{children}</div>{footer && <div className="modal-footer">{footer}</div>}</section></div>; }

function remainingCreditsPercent(account: CursorAccountView) {
  return 100 - (account.coreUsage?.total.percentUsed ?? 0);
}

function billingCycleEndTimestamp(account: CursorAccountView) {
  const value = account.coreUsage?.billingCycleEnd;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("cursor-theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "dark";
  } catch {
    return "dark";
  }
}
function normalizeTag(value: string) { return value.trim().toLocaleLowerCase(); }
function normalizedTags(values: string[]) { const tags = new Map<string, string>(); values.forEach((value) => { const normalized = normalizeTag(value); if (normalized && !tags.has(normalized)) tags.set(normalized, value.trim()); }); return [...tags.values()].sort((left, right) => left.localeCompare(right)); }
function inputTags(value: string) { const tags = new Map<string, string>(); value.split(/[\n,]/).forEach((item) => { const tag = item.trim(); const normalized = normalizeTag(tag); if (normalized && !tags.has(normalized)) tags.set(normalized, tag); }); return [...tags.values()]; }
function groupAccounts(accounts: CursorAccountView[], enabled: boolean, selectedTags: string[], language: Language): AccountGroup[] { if (!enabled) return [{ label: "", accounts, totalCount: accounts.length }]; const selected = new Set(selectedTags.map(normalizeTag)); const untagged = localized(language, "默认分组", "Default group"); const groups = new Map<string, CursorAccountView[]>(); accounts.forEach((account) => { const tags = normalizedTags(account.tags).map(normalizeTag); const labels = selected.size > 0 ? tags.filter((label) => selected.has(label)) : tags; const effectiveLabels = labels.length ? labels : [untagged]; effectiveLabels.forEach((label) => groups.set(label, [...(groups.get(label) ?? []), account])); }); return [...groups.entries()].sort(([left], [right]) => left === untagged ? -1 : right === untagged ? 1 : left.localeCompare(right)).map(([label, items]) => ({ label, accounts: items, totalCount: items.length })); }
function buildPaginatedGroups(groups: AccountGroup[], pageItems: CursorAccountView[]): AccountGroup[] { const pageIds = new Set(pageItems.map((account) => account.id)); return groups.map((group) => ({ ...group, accounts: group.accounts.filter((account) => pageIds.has(account.id)) })).filter((group) => group.accounts.length > 0); }
function toggleValue(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }
function displayIdentity(account: CursorAccountView) { return account.email?.trim() || account.name?.trim() || account.id; }
function normalizeMembershipType(value: string | null | undefined) { const normalized = value?.trim().toLocaleLowerCase() || null; if (normalized === "pro_student") return "pro"; if (normalized === "business" || normalized === "team") return "enterprise"; return normalized; }
function planKey(account: CursorAccountView) { return normalizeMembershipType(account.membershipType)?.toLocaleUpperCase() || "UNKNOWN"; }
function planFilterLabel(key: string) { return key === "PRO_PLUS" ? "PRO+" : key.replaceAll("_", " "); }
function hasCoreError(account: CursorAccountView) { return Boolean(account.lastError || account.coreUsage?.error); }
function isBannedAccount(account: CursorAccountView) { const status = account.status?.trim().toLocaleLowerCase() ?? ""; const reason = account.statusReason?.trim().toLocaleLowerCase() ?? ""; return status === "banned" || status === "forbidden" || reason.includes("banned") || reason.includes("suspended") || reason.includes("disabled"); }
function isAbnormalAccount(account: CursorAccountView) { return isBannedAccount(account) || account.status?.trim().toLocaleLowerCase() === "error"; }
function exportButtonLabel(selected: Set<string>, filtered: CursorAccountView[], language: Language) { const count = filtered.filter((account) => selected.has(account.id)).length; const label = localized(language, "导出", "Export"); return count > 0 ? `${label} (${count})` : label; }
function readable(error: unknown) { return error instanceof Error ? error.message : String(error); }
function readableForLanguage(error: unknown, language: Language) { const text = readable(error); if (language !== "en" || !/[\p{Script=Han}]/u.test(text)) return text; return text.match(/HTTP\s+\d+/i)?.[0].toLocaleUpperCase() ?? "The operation failed. Check the input or try again."; }
function providerErrorSummary(error: string, language: Language = "zh-CN") { const http = error.match(/HTTP\s+\d+/i)?.[0].toLocaleUpperCase(); if (http) return http; return language === "en" && /[\p{Script=Han}]/u.test(error) ? "Request failed" : error; }
function providerDiagnosticSummary(error: string, language: Language) { const stage = error.includes("oauth") ? localized(language, "令牌续期", "Token refresh") : error.includes("user-meta") ? localized(language, "账号资料", "Account profile") : error.includes("stripe-profile") ? localized(language, "订阅资料", "Subscription profile") : localized(language, "辅助资料", "Auxiliary data"); return `${stage}: ${providerErrorSummary(error, language)}`; }
function clamp(value: number | null | undefined) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null; }
function usagePercent(value: UsageAmount | undefined) { return clamp(value?.percentUsed ?? (value?.used != null && value.limit ? value.used / value.limit * 100 : null)); }
function onDemandPresentation(usage: CursorAccountView["coreUsage"], language: Language) { const value = usage?.onDemand; const used = value?.used ?? 0; const limit = value?.limit; const fixedLimit = limit != null && limit > 0 ? limit : null; const team = usage?.onDemandLimitType?.toLocaleLowerCase() === "team"; if (fixedLimit == null) { const unlimited = value?.enabled === true && !team; return unlimited ? { percent: 0, tone: "normal", valueText: localized(language, "无限", "Unlimited"), costText: dollarsFromCents(used) } : { percent: 0, tone: "normal", valueText: used > 0 ? dollarsFromCents(used) : localized(language, "已禁用", "Disabled"), costText: null as string | null }; } const p = clamp(used / fixedLimit * 100) ?? 0; return { percent: p, tone: quotaTone(p, true), valueText: percent(p, language), costText: `${dollarsFromCents(used)} / ${dollarsFromCents(fixedLimit)}` }; }
function localized(language: Language, zh: string, en: string) { return language === "en" ? en : zh; }
function percent(value: number | null | undefined, language: Language = "zh-CN") { const result = clamp(value); return result == null ? localized(language, "暂无数据", "No data") : `${result.toFixed(1)}%`; }
function number(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function dollarsFromCents(value: number) { return `$${(value / 100).toFixed(2)}`; }
function dateTime(value: number) { return new Date(value < 10_000_000_000 ? value * 1000 : value).toLocaleString(); }
function dateTimeParts(value: number) { const result = new Date(value < 10_000_000_000 ? value * 1000 : value); return { date: result.toLocaleDateString(), time: result.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }; }
function dateTimeMinuteParts(value: string, language: Language = "zh-CN") { const timestamp = parseExternalTimestamp(value); if (timestamp == null) return { date: localized(language, "未知", "Unknown"), time: "" }; const result = new Date(timestamp); const pad = (part: number) => String(part).padStart(2, "0"); return { date: `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}`, time: `${pad(result.getHours())}:${pad(result.getMinutes())}` }; }
function dateTimeMinute(value: string, language: Language) { const result = dateTimeMinuteParts(value, language); return result.time ? `${result.date} ${result.time}` : result.date; }
function sandPlanValue(sand: CursorAccountView["sand"], language: Language) { return sand?.grokPlanLabel?.trim() || localized(language, "未知", "Unknown"); }
function sandBlockReasonValue(sand: CursorAccountView["sand"]) { const value = sand?.blockReason?.trim(); return !value || value === "SAND_ACCESS_BLOCK_REASON_NONE" ? null : value; }
function sandPresentation(sand: CursorAccountView["sand"], language: Language = "zh-CN") {
  const p = clamp(sand?.usagePercent);
  const usage = sand?.usageError ? (p == null ? localized(language, "用量状态未更新", "Usage not updated") : `${localized(language, "上次本周期已用", "Last period usage")} ${percent(p, language)}`) : `${localized(language, "本周期已用", "Period usage")} ${percent(p, language)}`;
  const compactUsage = sand?.usageError ? (p == null ? localized(language, "用量未更新", "Usage not updated") : `${localized(language, "上次", "Last")} ${percent(p, language)}`) : `${localized(language, "已用", "Used")} ${percent(p, language)}`;
  const access = sand?.accessError ? localized(language, "资格状态未更新", "Access not updated") : sand?.accessGranted === true ? localized(language, "资格可访问", "Access granted") : sand?.accessGranted === false ? localized(language, "资格不可访问", "Access blocked") : localized(language, "资格未知", "Access unknown");
  const accessTone = sand?.accessError ? "unknown" : sand?.accessGranted === true ? "granted" : sand?.accessGranted === false ? "blocked" : "unknown";
  const incomplete = Boolean(sand?.usageError || sand?.accessError);
  const failures = [sand?.usageError ? localized(language, "用量未更新", "Usage not updated") : null, sand?.accessError ? localized(language, "资格未更新", "Access not updated") : null].filter(Boolean).join(" · ");
  const reset = sandResetText(sand?.nextResetTimestampUtc, language);
  const freshness = sand?.usageError ? `${localized(language, "Sand 数据未完全更新", "Sand data is incomplete")} (${failures})` : sand?.accessError ? `${reset} · ${localized(language, "资格未更新", "Access not updated")}` : reset;
  const blockReason = sandBlockReasonValue(sand);
  const blockReasonLabel = sand?.accessError ? localized(language, "上次受限原因", "Last block reason") : localized(language, "访问受限", "Access restricted");
  const planStale = Boolean(sand?.usageError);
  const planLabel = planStale ? localized(language, "上次套餐", "Last plan") : localized(language, "套餐", "Plan");
  return { usagePercent: p, usage, compactUsage, plan: sandPlanValue(sand, language), planLabel, planStale, access, accessTone, blockReason, blockReasonLabel, freshness, failures, incomplete };
}
function sandResetText(value: string | null | undefined, language: Language, now = Date.now()) {
  if (!value) return localized(language, "重置时间未知", "Reset time unknown");
  const timestamp = parseExternalTimestamp(value);
  if (timestamp == null) return localized(language, "重置时间未知", "Reset time unknown");
  if (timestamp <= now) return localized(language, "重置时间待刷新", "Reset time needs refresh");
  const relative = sandResetRelative(timestamp - now, language);
  return language === "en" ? `Next reset ${dateTimeMinute(value, language)} (${relative})` : `下次重置 ${dateTimeMinute(value, language)}（${relative}）`;
}
function sandTableReset(value: string | null | undefined, language: Language, now = Date.now()) {
  if (!value) return null;
  const timestamp = parseExternalTimestamp(value);
  if (timestamp == null || timestamp <= now) return null;
  const parts = dateTimeMinuteParts(value, language);
  if (!parts.time) return null;
  return { ...parts, relative: sandResetRelative(timestamp - now, language) };
}
function sandCardReset(value: string | null | undefined, language: Language, stale: boolean, now = Date.now()) {
  const label = stale ? localized(language, "上次重置", "Last reset") : localized(language, "重置", "Reset");
  if (!value) return { label, value: localized(language, "未知", "Unknown"), relative: null as string | null, title: localized(language, "重置时间未知", "Reset time unknown") };
  const timestamp = parseExternalTimestamp(value);
  if (timestamp == null) return { label, value: localized(language, "未知", "Unknown"), relative: null as string | null, title: localized(language, "重置时间未知", "Reset time unknown") };
  if (timestamp <= now) return { label, value: localized(language, "待刷新", "Needs refresh"), relative: null as string | null, title: localized(language, "重置时间待刷新", "Reset time needs refresh") };
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  const valueText = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return { label, value: valueText, relative: sandResetRelative(timestamp - now, language), title: dateTimeMinute(value, language) };
}
function sandResetRelative(remaining: number, language: Language) {
  const totalHours = Math.floor(remaining / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return language === "en" ? (days > 0 ? `about ${days}d ${hours}h` : `about ${hours}h ${minutes}m`) : (days > 0 ? `约 ${days}天 ${hours}小时` : `约 ${hours}时 ${minutes}分钟`);
}
function parseExternalTimestamp(value: string) { const numeric = /^\d+$/.test(value) ? Number(value) : null; const timestamp = numeric == null ? new Date(value).getTime() : numeric < 1_000_000_000_000 ? numeric * 1000 : numeric; return Number.isFinite(timestamp) ? timestamp : null; }
function maskJson(json: string) { try { const visit = (value: unknown): unknown => Array.isArray(value) ? value.map(visit) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)])) : typeof value === "string" ? "••••••••" : value; return JSON.stringify(visit(JSON.parse(json)), null, 2); } catch { return "••••••••"; } }
function downloadJson(json: string) { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([json], { type: "application/json" })); link.download = "cursor-accounts.json"; link.click(); URL.revokeObjectURL(link.href); }
