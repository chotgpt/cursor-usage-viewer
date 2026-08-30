import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { mockAccount } from "./mock";
import type { AccountSummary, QuotaSnapshot } from "./types";

type View = "overview" | "accounts" | "security";
type Busy = "account" | "import" | "select" | "usage" | "clear" | null;

const isTauri = () => "__TAURI_INTERNALS__" in window;

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState("等待你读取或导入账号");

  const totalPercent = clampPercent(quota?.totalPercentUsed);
  const autoPercent = clampPercent(quota?.autoPercentUsed);
  const apiPercent = clampPercent(quota?.apiPercentUsed);
  const sandPercent = clampPercent(quota?.usagePercent);
  const remainingPercent = totalPercent === null ? null : Math.max(0, 100 - totalPercent);
  const statusTone = message.includes("失败") || message.includes("无效") ? "error" : quota ? "success" : "neutral";

  const accountDetail = useMemo(() => {
    if (!account) return "尚未选择查询账号";
    return [account.membership, account.signupType].filter(Boolean).join(" · ") || "套餐信息未提供";
  }, [account]);

  function applyActiveAccount(summary: AccountSummary, sourceAccounts?: AccountSummary[]) {
    const base = sourceAccounts ?? accounts;
    const exists = base.some((item) => item.id === summary.id);
    const next = (exists ? base : [summary, ...base]).map((item) => ({
      ...item,
      ...(item.id === summary.id ? summary : {}),
      isActive: item.id === summary.id,
    }));
    setAccounts(next);
    setAccount(summary);
    setQuota(null);
  }

  async function loadAccount() {
    setBusy("account");
    setMessage("正在只读加载当前 Cursor 账号…");
    try {
      const result = isTauri() ? await invoke<AccountSummary>("load_current_cursor_account") : mockAccount;
      applyActiveAccount(result);
      setMessage("当前 Cursor 账号已加入并设为查询账号");
    } catch (error) {
      setMessage(`读取失败：${readableError(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function importCockpitAccounts() {
    let payload = importText;
    setImportText("");
    if (!payload.trim()) {
      setMessage("请先粘贴 Cockpit Tools JSON 数组");
      return;
    }
    if (!isTauri()) {
      setMessage("浏览器预览不处理账号凭据，请在桌面应用中导入");
      payload = "";
      return;
    }
    setBusy("import");
    setMessage("正在解析 Cockpit Tools JSON…");
    try {
      const result = await invoke<AccountSummary[]>("import_cockpit_accounts_json", { payload });
      setAccounts(result);
      const active = result.find((item) => item.isActive) ?? null;
      setAccount(active);
      setQuota(null);
      const importedCount = result.filter((item) => item.source === "cockpit-tools").length;
      setMessage(`已从 Cockpit Tools 导入 ${importedCount} 个账号，仅保存在本次会话内`);
    } catch (error) {
      setMessage(`导入失败：${readableError(error)}`);
    } finally {
      payload = "";
      setBusy(null);
    }
  }

  async function selectAccount(accountId: string) {
    setBusy("select");
    try {
      const result = isTauri()
        ? await invoke<AccountSummary>("select_cursor_account", { accountId })
        : accounts.find((item) => item.id === accountId);
      if (!result) throw new Error("找不到所选账号");
      applyActiveAccount(result);
      setMessage(`已选择 ${result.email}，点击查询额度即可刷新`);
    } catch (error) {
      setMessage(`选择失败：${readableError(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function queryUsage() {
    setBusy("usage");
    setMessage("正在查询 Cursor 官方额度…");
    try {
      if (!isTauri()) {
        setMessage("浏览器预览不会发送真实请求；请在桌面应用中操作");
        return;
      }
      const result = await invoke<QuotaSnapshot>("query_cursor_usage");
      setQuota(result);
      setMessage("额度已更新");
    } catch (error) {
      setMessage(`查询失败：${readableError(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function clearCredentials() {
    setBusy("clear");
    try {
      if (isTauri()) await invoke("clear_cursor_credentials");
      setAccounts([]);
      setAccount(null);
      setQuota(null);
      setImportText("");
      setMessage("本次会话中的全部账号与凭据已清除");
    } catch (error) {
      setMessage(`清除失败：${readableError(error)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="brand-gauge" aria-hidden="true" /><div><strong>Cursor</strong><span>额度查看器</span></div></div>
        <nav aria-label="主导航">
          <NavButton active={view === "overview"} icon="▦" label="概览" onClick={() => setView("overview")} />
          <NavButton active={view === "accounts"} icon="○" label="账号" onClick={() => setView("accounts")} />
          <NavButton active={view === "security"} icon="◇" label="安全" onClick={() => setView("security")} />
        </nav>
        <div className="sidebar-foot"><span className={account ? "vault-dot active" : "vault-dot"} /><div><strong>{accounts.length} 个账号</strong><span>仅驻留内存</span></div></div>
      </aside>

      <main className="workspace">
        <header className={`commandbar ${statusTone}`}>
          <div className="command-status"><span /><p>{message}</p></div>
          <button className="query-button" onClick={queryUsage} disabled={!account || busy !== null}>{busy === "usage" ? "查询中…" : "查询额度"}</button>
        </header>

        {view === "overview" && <Overview account={account} accountDetail={accountDetail} quota={quota} autoPercent={autoPercent} apiPercent={apiPercent} sandPercent={sandPercent} totalPercent={totalPercent} remainingPercent={remainingPercent} busy={busy} onLoad={loadAccount} onOpenAccounts={() => setView("accounts")} />}
        {view === "accounts" && <AccountsView accounts={accounts} importText={importText} busy={busy} onImportTextChange={setImportText} onLoad={loadAccount} onImport={importCockpitAccounts} onSelect={selectAccount} onClear={clearCredentials} />}
        {view === "security" && <SecurityView accountCount={accounts.length} busy={busy} onClear={clearCredentials} />}
      </main>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) {
  return <button className={active ? "nav-button active" : "nav-button"} aria-pressed={active} onClick={onClick}><span aria-hidden="true">{icon}</span>{label}</button>;
}

type OverviewProps = {
  account: AccountSummary | null;
  accountDetail: string;
  quota: QuotaSnapshot | null;
  autoPercent: number | null;
  apiPercent: number | null;
  sandPercent: number | null;
  totalPercent: number | null;
  remainingPercent: number | null;
  busy: Busy;
  onLoad: () => void;
  onOpenAccounts: () => void;
};

function Overview({ account, accountDetail, quota, autoPercent, apiPercent, sandPercent, totalPercent, remainingPercent, busy, onLoad, onOpenAccounts }: OverviewProps) {
  return (
    <section className="view overview-view">
      <div className="active-account-card">
        <div className="avatar">{account?.email.charAt(0).toUpperCase() ?? "?"}</div>
        <div className="active-account-copy"><span>当前查询账号</span><strong>{account?.email ?? "尚未选择账号"}</strong><p>{accountDetail}{account?.source === "cockpit-tools" ? " · Cockpit Tools" : ""}</p></div>
        {account ? <button className="subtle-button" onClick={onOpenAccounts}>切换账号</button> : <button className="subtle-button" onClick={onLoad} disabled={busy !== null}>{busy === "account" ? "读取中…" : "读取当前 Cursor"}</button>}
      </div>

      <div className="meter-grid">
        <UsageMeter label="AUTO" value={autoPercent} tone="cyan" />
        <UsageMeter label="API" value={apiPercent} tone="violet" />
        <UsageMeter label="GROK / SAND" value={sandPercent} tone="green" />
      </div>

      <div className="summary-panel">
        <div className="total-block"><UsageRing value={totalPercent} /><div><span>总用量</span><strong>{formatPercent(totalPercent)}</strong><p>{remainingPercent === null ? "暂无可用量数据" : `${remainingPercent.toFixed(1)}% 可用`}</p></div></div>
        <div className="period-block"><span>计费周期</span><strong>{quota ? `${formatDate(quota.billingCycleStart)} — ${formatDate(quota.billingCycleEnd)}` : "等待查询"}</strong><div className="period-line"><i /><b /></div><p>{quota ? `Sand 重置 ${formatTimestamp(quota.nextResetTimestampUtc)}` : "查询后显示周期与重置时间"}</p></div>
        <div className="status-stack"><div className="status-chip violet"><span>♙</span>{quota?.grokPlanLabel || (quota ? "Grok / Sand 暂无额度" : "套餐待查询")}</div><div className={quota?.sandAccessGranted === true ? "status-chip green" : "status-chip"}><span>◇</span>{quota?.sandAccessGranted === true ? "Sand 已授权" : quota?.sandAccessGranted === false ? "Sand 不可用" : quota ? "Sand 暂无数据" : "Sand 待查询"}</div><p>↻ {quota ? formatTimestamp(quota.nextResetTimestampUtc) : "—"}</p></div>
      </div>
    </section>
  );
}

function UsageMeter({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  const percent = value ?? 0;
  const height = percent * 2.08;
  const y = 222 - height;
  return (
    <article className={`meter-card ${tone}`}>
      <h2>{label} <strong>{formatPercent(value)}</strong></h2>
      <div className="meter-body"><div className="meter-scale"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><svg className="vertical-meter" viewBox="0 0 100 240" role="img" aria-label={`${label} 用量 ${formatPercent(value)}`}><rect className="meter-track" x="20" y="8" width="60" height="216" rx="5" /><rect className="meter-value" x="20" y={y} width="60" height={height} rx="4" /></svg></div>
      <div className="meter-footer"><span>已用 {formatPercent(value)}</span><strong>剩余 {value === null ? "—" : `${(100 - value).toFixed(1)}%`}</strong></div>
    </article>
  );
}

function UsageRing({ value }: { value: number | null }) {
  const percent = value ?? 0;
  return <div className="total-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle className="total-track" cx="50" cy="50" r="42" pathLength="100" /><circle className="total-value" cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${percent} ${100 - percent}`} /></svg><strong>{formatPercent(value)}</strong></div>;
}

function AccountsView({ accounts, importText, busy, onImportTextChange, onLoad, onImport, onSelect, onClear }: { accounts: AccountSummary[]; importText: string; busy: Busy; onImportTextChange: (value: string) => void; onLoad: () => void; onImport: () => void; onSelect: (id: string) => void; onClear: () => void }) {
  return (
    <section className="view accounts-view">
      <div className="view-heading"><div><span>ACCOUNT MANAGEMENT</span><h1>账号管理</h1><p>粘贴 Cockpit Tools JSON 数组，可一次导入多个账号。</p></div><div className="heading-actions"><button className="subtle-button" onClick={onLoad} disabled={busy !== null}>{busy === "account" ? "读取中…" : "读取当前 Cursor"}</button></div></div>
      <div className="import-panel">
        <div className="import-panel-heading"><div><strong>粘贴 JSON 数组</strong><p>提交后立即清空输入框；额度缓存会被忽略。</p></div><span>最多 500 个账号 · 8 MiB</span></div>
        <textarea aria-label="Cockpit Tools JSON 数组" autoComplete="off" spellCheck={false} value={importText} onChange={(event) => onImportTextChange(event.target.value)} placeholder={'粘贴 Cockpit Tools 导出的 JSON 数组，例如：\n[{ "id": "...", "email": "...", "access_token": "..." }]'} disabled={busy !== null} />
        <div className="import-panel-actions"><p>仅保留本次会话查询所需的 Access Token，不读取文件。</p><button className="query-button" onClick={onImport} disabled={!importText.trim() || busy !== null}>{busy === "import" ? "导入中…" : "导入全部账号"}</button></div>
      </div>
      {accounts.length === 0 ? <div className="empty-state"><span>◎</span><h2>还没有账号</h2><p>读取当前 Cursor，或在上方粘贴 JSON 数组后导入。</p></div> : <div className="account-list">{accounts.map((item) => <article className={item.isActive ? "account-row active" : "account-row"} key={item.id}><div className="avatar small">{item.email.charAt(0).toUpperCase()}</div><div className="row-main"><strong>{item.email}</strong><p>{[item.membership, item.signupType].filter(Boolean).join(" · ") || "套餐未知"}</p><div className="tag-row"><span className="source-tag">{item.source === "cursor" ? "本机 Cursor" : "Cockpit Tools"}</span>{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div><div className="row-security"><span className={item.hasAccessToken ? "ok" : ""}>Access</span><span className={item.hasRefreshToken ? "ok" : ""}>Refresh</span></div><button className={item.isActive ? "selected-button" : "subtle-button"} disabled={item.isActive || busy !== null} onClick={() => onSelect(item.id)}>{item.isActive ? "当前使用" : "设为当前"}</button></article>)}</div>}
      {accounts.length > 0 && <div className="account-footer"><p>重新导入会替换上一次 Cockpit Tools 集合，不修改 Cockpit Tools 数据。</p><button className="danger-button" onClick={onClear} disabled={busy !== null}>{busy === "clear" ? "清除中…" : "清除全部内存账号"}</button></div>}
    </section>
  );
}

function SecurityView({ accountCount, busy, onClear }: { accountCount: number; busy: Busy; onClear: () => void }) {
  const items = [["敏感数据隔离", "除你主动粘贴的 JSON 外，完整 Token 和 Cookie 不进入前端；提交后输入框立即清空。"], ["固定网络白名单", "只允许三个已记录的 Cursor HTTPS 端点，禁止重定向。"], ["无持久化账号库", "导入账号仅保留到清除、关闭窗口或退出进程。"], ["不信任缓存额度", "忽略 Cockpit Tools 的 cursor_usage_raw，每次主动查询实时数据。"]];
  return <section className="view security-view"><div className="view-heading"><div><span>SECURITY BOUNDARY</span><h1>安全与隐私</h1><p>当前内存中有 {accountCount} 个账号摘要。</p></div></div><div className="security-grid">{items.map(([title, text], index) => <article key={title}><span>{index + 1}</span><div><h2>{title}</h2><p>{text}</p></div></article>)}</div><div className="clear-zone"><div><strong>清除本次会话</strong><p>立即移除全部账号、选中状态和查询结果，并尽力清零 Rust 字符串。</p></div><button className="danger-button" onClick={onClear} disabled={accountCount === 0 || busy !== null}>{busy === "clear" ? "清除中…" : "清除全部"}</button></div></section>;
}

function readableError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function clampPercent(value: number | null | undefined): number | null { return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null; }
function formatPercent(value: number | null): string { return value === null ? "—" : `${value.toFixed(1)}%`; }
function parseTimestamp(value: string): Date { return new Date(/^\d+$/.test(value) ? Number(value) : value); }
function formatDate(value: string): string { const date = parseTimestamp(value); return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }); }
function formatTimestamp(value: string | null | undefined): string { if (!value) return "暂无数据"; const date = parseTimestamp(value); return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
