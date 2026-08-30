import { useEffect, useMemo, useState } from "react";
import { dictionaries, initialLanguage, type Language } from "./i18n";
import { PAGE_SIZES, usePagination } from "./hooks/usePagination";
import * as cursor from "./services/cursorService";
import type { CursorAccountView, UsageAmount } from "./types";

type Page = "cursor" | "settings";
type Layout = "grid" | "list";

export default function App() {
  const [page, setPage] = useState<Page>("cursor");
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = dictionaries[language];
  const [accounts, setAccounts] = useState<CursorAccountView[]>([]);
  const [message, setMessage] = useState("就绪");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [membership, setMembership] = useState("all");
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState("last");
  const [ascending, setAscending] = useState(false);
  const [layout, setLayout] = useState<Layout>("grid");
  const [privacy, setPrivacy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [exportState, setExportState] = useState<{ json: string; revealed: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => { void cursor.listAccounts().then(setAccounts).catch((error) => setMessage(`加载失败：${readable(error)}`)); }, []);

  const memberships = useMemo(() => unique(accounts.map((item) => item.membershipType).filter(Boolean) as string[]), [accounts]);
  const tags = useMemo(() => unique(accounts.flatMap((item) => item.tags)), [accounts]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return accounts.filter((item) => {
      const matchesQuery = !query || [item.email, item.authId, item.name, ...item.tags].some((value) => value?.toLocaleLowerCase().includes(query));
      return matchesQuery && (membership === "all" || item.membershipType === membership) && (tag === "all" || item.tags.includes(tag));
    }).sort((left, right) => {
      const result = sort === "email" ? (left.email ?? "").localeCompare(right.email ?? "") : sort === "plan" ? (left.membershipType ?? "").localeCompare(right.membershipType ?? "") : left.lastUsed - right.lastUsed;
      return ascending ? result : -result;
    });
  }, [accounts, search, membership, tag, sort, ascending]);
  const pagination = usePagination(filtered);
  const currentPageIds = pagination.pageItems.map((item) => item.id);
  const allPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selected.has(id));

  const replaceAccount = (updated: CursorAccountView) => setAccounts((items) => items.some((item) => item.id === updated.id) ? items.map((item) => item.id === updated.id ? updated : item) : [updated, ...items]);
  const withBusy = async (ids: string[], action: () => Promise<void>) => { setBusy((old) => new Set([...old, ...ids])); try { await action(); } finally { setBusy((old) => { const next = new Set(old); ids.forEach((id) => next.delete(id)); return next; }); } };

  async function readLocal() { await withBusy(["local"], async () => { try { replaceAccount(await cursor.readLocalAccount()); setMessage("已读取并保存本机 Cursor 账号"); } catch (error) { setMessage(`读取失败：${readable(error)}`); } }); }
  async function refreshOne(id: string) { await withBusy([id], async () => { try { replaceAccount(await cursor.refreshAccount(id)); setMessage("额度已更新"); } catch (error) { setMessage(`查询失败：${readable(error)}`); } }); }
  async function refreshMany(ids: string[]) { if (!ids.length) return; await withBusy(ids, async () => { const results = await cursor.refreshAccounts(ids); for (const item of results) if (item.result) replaceAccount(item.result); const failures = results.filter((item) => item.error).length; setMessage(failures ? `刷新完成，${failures} 个账号失败` : `已刷新 ${results.length} 个账号`); }); }
  async function submitImport() { const payload = importText; setImportText(""); if (!payload.trim()) return; setShowImport(false); await withBusy(["import"], async () => { try { setAccounts(await cursor.importAccounts(payload)); setMessage("账号已导入并保存到本机"); } catch (error) { setMessage(`导入失败：${readable(error)}`); } }); }
  async function openExport(ids?: string[]) { const scope = ids ?? (selected.size ? filtered.filter((item) => selected.has(item.id)).map((item) => item.id) : filtered.map((item) => item.id)); if (!scope.length) return; try { setExportState({ json: await cursor.exportAccounts(scope), revealed: false }); } catch (error) { setMessage(`导出失败：${readable(error)}`); } }
  async function confirmDelete() { if (!deleteTarget) return; const id = deleteTarget; setDeleteTarget(null); await cursor.deleteAccount(id); setAccounts((items) => items.filter((item) => item.id !== id)); setSelected((items) => { const next = new Set(items); next.delete(id); return next; }); setMessage("本地账号及凭据备份已删除"); }

  return <div className="app-shell">
    <aside className="side-nav">
      <div className="brand"><span className="brand-mark">⌁</span><div><strong>Cursor</strong><small>Usage Viewer</small></div></div>
      <button className={page === "cursor" ? "nav active" : "nav"} onClick={() => setPage("cursor")}><span>◎</span>{t.cursor}<b>{accounts.length}</b></button>
      <div className="nav-spacer" />
      <button className={page === "settings" ? "nav active" : "nav"} onClick={() => setPage("settings")}><span>⚙</span>{t.settings}</button>
      <div className="version">v0.1.0 · MIT<br/><span>UNOFFICIAL</span></div>
    </aside>
    <main className="main-area">
      {page === "settings" ? <Settings language={language} setLanguage={setLanguage} /> : <>
        <header className="page-head"><div><p>LOCAL ACCOUNT WORKSPACE</p><h1>Cursor <span>{accounts.length} {t.accounts}</span></h1></div><div className="status"><i className={message.includes("失败") ? "error" : ""}/>{message}</div></header>
        <details className="local-notice"><summary>本地处理与隐私说明</summary><p>{t.localNotice}</p></details>
        <section className="toolbar">
          <label className="search"><span>⌕</span><input aria-label={t.search} placeholder={t.search} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <select aria-label="套餐筛选" value={membership} onChange={(event) => setMembership(event.target.value)}><option value="all">全部套餐</option>{memberships.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="标签筛选" value={tag} onChange={(event) => setTag(event.target.value)}><option value="all">全部标签</option>{tags.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="last">最近使用</option><option value="email">邮箱</option><option value="plan">套餐</option></select>
          <button className="icon-button" aria-label="切换排序方向" onClick={() => setAscending((value) => !value)}>{ascending ? "↑" : "↓"}</button>
          <button className="icon-button" aria-label="切换布局" onClick={() => setLayout((value) => value === "grid" ? "list" : "grid")}>{layout === "grid" ? "▦" : "☷"}</button>
          <button className={privacy ? "icon-button active" : "icon-button"} aria-label="隐私模式" onClick={() => setPrivacy((value) => !value)}>◉</button>
          <button onClick={() => void readLocal()} disabled={busy.has("local")}>{t.readLocal}</button>
          <button onClick={() => setShowImport(true)}>{t.import}</button>
          <button className="primary" onClick={() => void refreshMany(accounts.map((item) => item.id))} disabled={!accounts.length || busy.size > 0}>{t.refreshAll}</button>
        </section>
        {selected.size > 0 && <section className="selection-bar"><strong>已选 {selected.size} 个账号</strong><button onClick={() => void refreshMany([...selected])}>刷新选中</button><button onClick={() => void openExport()}>{t.export}</button><button onClick={() => setSelected(new Set())}>取消选择</button></section>}
        <section className="list-head"><label><input type="checkbox" aria-label="全选当前页" checked={allPageSelected} onChange={() => setSelected((old) => { const next = new Set(old); currentPageIds.forEach((id) => allPageSelected ? next.delete(id) : next.add(id)); return next; })} /> 当前页全选</label><span>{filtered.length} 个结果</span></section>
        {pagination.pageItems.length === 0 ? <div className="empty"><span>◎</span><h2>{t.empty}</h2><p>读取本机账号，或粘贴 Cockpit JSON 批量导入。</p></div> : <div className={`account-${layout}`}>{pagination.pageItems.map((account) => <AccountCard key={account.id} account={account} privacy={privacy} selected={selected.has(account.id)} busy={busy.has(account.id)} onSelect={() => setSelected((old) => { const next = new Set(old); next.has(account.id) ? next.delete(account.id) : next.add(account.id); return next; })} onRefresh={() => void refreshOne(account.id)} onExport={() => void openExport([account.id])} onDelete={() => setDeleteTarget(account.id)} />)}</div>}
        <footer className="pagination"><span>第 {pagination.page} / {pagination.pageCount} 页</span><label>每页 <select aria-label="每页数量" value={pagination.pageSize} onChange={(event) => pagination.setPageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}</select></label><button disabled={pagination.page === 1} onClick={() => pagination.setPage(pagination.page - 1)}>上一页</button><button disabled={pagination.page === pagination.pageCount} onClick={() => pagination.setPage(pagination.page + 1)}>下一页</button></footer>
      </>}
    </main>
    {showImport && <Modal title="粘贴 Cockpit JSON" onClose={() => { setShowImport(false); setImportText(""); }}><p className="warning">支持单对象、数组、accounts/items 包装；提交后立即清空。Token 将明文保存在本机。</p><textarea autoFocus aria-label="Cockpit Tools JSON" value={importText} onChange={(event) => setImportText(event.target.value)} /><div className="modal-actions"><button onClick={() => { setShowImport(false); setImportText(""); }}>取消</button><button className="primary" disabled={!importText.trim()} onClick={() => void submitImport()}>导入</button></div></Modal>}
    {exportState && <Modal title="完整账号 JSON" onClose={() => setExportState(null)}><p className="warning">包含明文 Access / Refresh Token。预览默认遮罩，请谨慎复制或保存。</p><pre className="export-preview">{exportState.revealed ? exportState.json : maskJson(exportState.json)}</pre><div className="modal-actions"><button onClick={() => setExportState({ ...exportState, revealed: !exportState.revealed })}>{exportState.revealed ? "隐藏" : "显示"}</button><button onClick={() => void navigator.clipboard.writeText(exportState.json)}>复制完整 JSON</button><button className="primary" onClick={() => downloadJson(exportState.json)}>保存 JSON</button></div></Modal>}
    {deleteTarget && <Modal title="删除本地账号？" onClose={() => setDeleteTarget(null)}><p>账号明细、凭据和对应 .bak 将从本机删除，无法撤销。</p><div className="modal-actions"><button onClick={() => setDeleteTarget(null)}>取消</button><button className="danger" onClick={() => void confirmDelete()}>删除</button></div></Modal>}
  </div>;
}

function AccountCard({ account, privacy, selected, busy, onSelect, onRefresh, onExport, onDelete }: { account: CursorAccountView; privacy: boolean; selected: boolean; busy: boolean; onSelect: () => void; onRefresh: () => void; onExport: () => void; onDelete: () => void }) {
  const usage = account.coreUsage; const sand = account.sand;
  return <article className={`account-card ${selected ? "selected" : ""}`}>
    <header><input type="checkbox" aria-label={`选择 ${account.email ?? account.id}`} checked={selected} onChange={onSelect}/><div className="avatar">{(account.email ?? "?")[0].toUpperCase()}</div><div className="identity"><strong className={privacy ? "private" : ""}>{account.email ?? "邮箱未知"}</strong><small className={privacy ? "private" : ""}>{account.authId ?? "Auth ID 未知"}</small></div><span className="plan">{account.membershipType ?? "UNKNOWN"}</span></header>
    <div className="tags">{account.isCurrent && <span className="current">本机当前</span>}{account.tags.slice(0,2).map((tag) => <span key={tag}>{tag}</span>)}{account.tags.length > 2 && <span>+{account.tags.length - 2}</span>}</div>
    <div className="quota-grid"><Quota label="TOTAL" value={usage?.total}/><Quota label="AUTO + COMPOSER" value={usage?.autoComposer}/><Quota label="API" value={usage?.api}/><Quota label="ON-DEMAND" value={usage?.onDemand}/></div>
    <div className="sand-row"><span><b>GROK / SAND</b> {percent(sand?.usagePercent)}</span><span>{sand?.accessGranted === true ? "可访问" : sand?.accessGranted === false ? "不可访问" : "状态未知"}</span><span>重置 {date(sand?.nextResetTimestampUtc)}</span></div>
    {(account.lastError || usage?.error) && <p className="account-error">{account.lastError ?? usage?.error}</p>}
    <footer><span>{usage ? `${usage.source === "live" ? "实时查询" : "导入缓存"} · ${dateTime(usage.updatedAt)}` : "暂无额度数据"}</span><div><button aria-label={`刷新 ${account.email ?? account.id}`} onClick={onRefresh} disabled={busy}>{busy ? "查询中" : "刷新"}</button><button onClick={onExport}>导出</button><button className="danger-link" onClick={onDelete}>删除</button></div></footer>
  </article>;
}

function Quota({ label, value }: { label: string; value?: UsageAmount }) { const p = clamp(value?.percentUsed ?? (value?.used != null && value.limit ? value.used / value.limit * 100 : null)); return <div className="quota"><span>{label}</span><strong>{percent(p)}</strong><div><i style={{ width: `${p ?? 0}%` }}/></div><small>{value?.used == null ? "暂无数据" : `${number(value.used)} / ${value.limit == null ? "—" : number(value.limit)}`}</small></div>; }
function Settings({ language, setLanguage }: { language: Language; setLanguage: (value: Language) => void }) { const t = dictionaries[language]; return <section className="settings-page"><header className="page-head"><div><p>APPLICATION</p><h1>{t.settings}</h1></div></header><div className="settings-tabs"><button className="active">{t.general}</button><button>{t.about}</button></div><div className="settings-card"><label><span><strong>{t.language}</strong><small>界面语言立即生效</small></span><select value={language} onChange={(event) => { const value = event.target.value as Language; localStorage.setItem("cursor-language", value); setLanguage(value); }}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><label><span><strong>关闭行为</strong><small>默认每次询问最小化到托盘或退出</small></span><select><option>每次询问</option><option>最小化到托盘</option><option>退出</option></select></label><label><span><strong>自动检查更新</strong><small>每小时检查一次；不会刷新 Cursor 额度</small></span><input type="checkbox" defaultChecked /></label></div><div className="about-card"><strong>Cursor Usage Viewer</strong><span>v0.1.0 · MIT</span><p>{t.unofficial}</p><button>检查更新</button></div></section>; }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [onClose]); return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button aria-label="关闭" onClick={onClose}>×</button></header>{children}</section></div>; }

function unique(values: string[]) { return [...new Set(values)].sort(); }
function readable(error: unknown) { return error instanceof Error ? error.message : String(error); }
function clamp(value: number | null | undefined) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null; }
function percent(value: number | null | undefined) { const result = clamp(value); return result == null ? "暂无数据" : `${result.toFixed(1)}%`; }
function number(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function date(value: string | null | undefined) { if (!value) return "未知"; const result = new Date(/^\d+$/.test(value) ? Number(value) : value); return Number.isNaN(result.getTime()) ? "未知" : result.toLocaleDateString(); }
function dateTime(value: number) { return new Date(value < 10_000_000_000 ? value * 1000 : value).toLocaleString(); }
function maskJson(json: string) { try { const visit = (value: unknown): unknown => Array.isArray(value) ? value.map(visit) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)])) : typeof value === "string" ? "••••••••" : value; return JSON.stringify(visit(JSON.parse(json)), null, 2); } catch { return "••••••••"; } }
function downloadJson(json: string) { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([json], { type: "application/json" })); link.download = "cursor-accounts.json"; link.click(); URL.revokeObjectURL(link.href); }
