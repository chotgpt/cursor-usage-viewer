import { useState } from "react";
import { CircleAlert, Database, Globe, KeyRound, RefreshCw, X } from "lucide-react";
import type { Language } from "../../i18n";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import "./AddAccountModal.css";

type AddTab = "oauth" | "token" | "local";

export function AddAccountModal({ language, busy, oauthWaiting = false, onClose, onOAuth, onToken, onLocal, onJsonFile }: {
  language: Language;
  busy: boolean;
  oauthWaiting?: boolean;
  onClose: () => void;
  onOAuth: () => Promise<void>;
  onToken: (value: string) => Promise<void>;
  onLocal: () => Promise<void>;
  onJsonFile: () => Promise<void>;
}) {
  const [tab, setTab] = useState<AddTab>("oauth");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const canClose = !busy || oauthWaiting;
  const dialogRef = useDialogFocus<HTMLElement>(() => { if (canClose) onClose(); });
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const labels: Record<AddTab, string> = { oauth: l("网页登录", "Web login"), token: "Token / JSON", local: l("本机导入", "Local import") };

  const run = async (action: () => Promise<void>) => {
    setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const submitToken = async () => {
    const value = token.trim();
    if (!value || busy) return;
    setToken("");
    await run(() => onToken(value));
  };

  return <div className="modal-overlay account-add-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && canClose) onClose(); }}>
    <section ref={dialogRef} className="modal ghcp-add-modal add-account-modal" role="dialog" aria-modal="true" aria-label={l("添加 Cursor 账号", "Add Cursor account")} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header"><h2>{l("添加 Cursor 账号", "Add Cursor account")}</h2><button className="modal-close" aria-label={oauthWaiting ? l("取消登录", "Cancel login") : l("关闭", "Close")} disabled={!canClose} onClick={onClose}><X size={18}/></button></div>
      <div className="add-account-tabs" role="tablist" aria-label={l("账号添加方式", "Account add method")}>
        {(["oauth", "token", "local"] as const).map((value) => <button key={value} id={`add-account-${value}-tab`} className={`add-account-tab ${tab === value ? "active" : ""}`} role="tab" aria-selected={tab === value} aria-controls={`add-account-${value}-panel`} disabled={busy} onClick={() => { setError(""); setTab(value); }}>{value === "oauth" ? <Globe size={15}/> : value === "token" ? <KeyRound size={15}/> : <Database size={15}/>} {labels[value]}</button>)}
      </div>
      <div className="modal-body">
        <div id={`add-account-${tab}-panel`} className="add-account-panel" role="tabpanel" aria-labelledby={`add-account-${tab}-tab`} aria-label={labels[tab]}>
          {tab === "oauth" && <><p>{l("在 Cursor 第一方页面完成授权。应用会等待登录结果，最长 5 分钟；关闭弹层即可取消。", "Authorize on Cursor's first-party page. The app waits up to five minutes; close this dialog to cancel.")}</p><button data-dialog-autofocus className="btn btn-primary btn-full" aria-busy={busy} disabled={busy} onClick={() => void run(onOAuth)}>{busy ? <RefreshCw size={16} className="loading-spinner"/> : <Globe size={16}/>} {busy ? l("等待授权…", "Waiting for authorization…") : l("在浏览器中登录", "Log in in browser")}</button></>}
          {tab === "token" && <><p>{l("粘贴单个 Cursor Access Token，或粘贴 Cockpit JSON。提交后输入会立即从界面清空。", "Paste one Cursor access token or Cockpit JSON. The input is cleared from the interface immediately after submission.")}</p><textarea data-dialog-autofocus className="token-input" aria-label={l("Cursor Access Token 或 Cockpit JSON", "Cursor access token or Cockpit JSON")} spellCheck={false} autoComplete="off" value={token} onChange={(event) => { setError(""); setToken(event.target.value); }} placeholder={l("粘贴 Token 或 JSON…", "Paste token or JSON…")}/><button className="btn btn-primary btn-full" aria-busy={busy} disabled={busy || !token.trim()} onClick={() => void submitToken()}>{busy ? <RefreshCw size={16} className="loading-spinner"/> : <KeyRound size={16}/>} {busy ? l("导入中…", "Importing…") : l("导入", "Import")}</button></>}
          {tab === "local" && <><p>{l("只读取默认 Cursor state.vscdb 中的当前账号；也可以选择一个 Cockpit JSON 文件导入。", "Only the current account in the default Cursor state.vscdb is read. You can also choose a Cockpit JSON file.")}</p><button data-dialog-autofocus className="btn btn-secondary btn-full" disabled={busy} onClick={() => void run(onLocal)}><Database size={16}/> {l("导入本机当前 Cursor 账号", "Import current Cursor account")}</button><div className="add-account-divider"><span>{l("或", "or")}</span></div><button className="btn btn-primary btn-full" disabled={busy} onClick={() => void run(onJsonFile)}><Database size={16}/> {l("选择 JSON 文件", "Choose JSON file")}</button></>}
        </div>
        {error && <div className="add-account-error" role="alert"><CircleAlert size={16}/><span>{error}</span></div>}
        <p className="add-account-storage-note">{l("凭据将以明文保存在此应用的数据目录及备份中，仅用于你主动发起或已启用的额度刷新。", "Credentials are stored in plaintext in this app's data directory and backup, and are used only for refreshes you start or enable.")}</p>
      </div>
    </section>
  </div>;
}
