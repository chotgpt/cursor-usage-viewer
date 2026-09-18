import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Language } from "../../i18n";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import * as cursor from "../../services/cursorService";
import type { CursorLaunchCandidate, SwitchAccountResult } from "../../types";
import { isWindowsRuntime, parseWindowsOperationError } from "../../utils/windowsOperationError";
import "./CursorPathDialog.css";

export function CursorPathDialog({ language, onClose, onLaunched, onSwitchError }: {
  language: Language;
  onClose: () => void;
  onLaunched: (result: SwitchAccountResult) => void;
  onSwitchError: (error: unknown) => void;
}) {
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const windows = isWindowsRuntime();
  const [draft, setDraft] = useState("");
  const [candidates, setCandidates] = useState<CursorLaunchCandidate[]>([]);
  const [busy, setBusy] = useState<"detect" | "save" | null>(null);
  const [ready, setReady] = useState(false);
  const [scanError, setScanError] = useState("");
  const [actionError, setActionError] = useState("");
  const dialogRef = useDialogFocus<HTMLElement>(() => { if (!busy) onClose(); });

  useEffect(() => {
    void cursor.getCursorAppPath()
      .then((path) => setDraft(path ?? ""))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const pick = async () => {
    if (busy) return;
    const path = await open({ multiple: false, directory: false });
    if (typeof path === "string" && path.trim()) {
      setDraft(path);
      setScanError("");
      setActionError("");
    }
  };

  const detect = async () => {
    if (busy) return;
    setBusy("detect");
    setScanError("");
    setActionError("");
    try {
      if (windows) {
        const found = await cursor.scanCursorAppPath();
        setCandidates(found);
        if (found.length === 0) {
          setScanError(l("未检测到运行中的 Cursor，请手动选择或自动检测。", "No running Cursor app was found. Choose a path or detect one."));
        } else if (!draft.trim()) {
          setDraft(found[0].target);
        }
      } else {
        const detected = await cursor.detectCursorAppPath(true);
        setDraft(detected ?? "");
        if (!detected) {
          setScanError(l("未找到 Cursor 应用程序路径。", "Cursor application path was not found."));
        }
      }
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const path = draft.trim();
    if (!path || busy) return;
    setBusy("save");
    setScanError("");
    setActionError("");
    try {
      await cursor.saveCursorAppPath(path);
      const result = await cursor.startDefaultCursorInstance();
      if (result.launchStatus === "pathRequired") {
        setActionError(l("保存后仍未找到可用的 Cursor 路径。", "The saved Cursor path is still not usable."));
        setBusy(null);
        return;
      }
      onLaunched(result);
    } catch (error) {
      const windows = parseWindowsOperationError(error);
      if (windows) {
        onSwitchError(error);
        return;
      }
      setActionError(error instanceof Error ? error.message : String(error));
      setBusy(null);
    }
  };

  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="modal cursor-path-dialog" role="dialog" aria-modal="true" aria-label={l("未找到应用程序路径", "Application path not found")} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header">
        <h2>{l("未找到应用程序路径", "Application path not found")}</h2>
        <button className="modal-close" aria-label={l("关闭", "Close")} disabled={Boolean(busy)} onClick={() => { if (!busy) onClose(); }}><X size={18}/></button>
      </div>
      <div className="modal-body">
        <p>{l("未找到 Cursor 应用程序路径，请立即设置后继续启动。", "Cursor’s application path was not found. Set it now to continue launching.")}</p>
        <label className="cursor-path-field">
          <span>{l("Cursor 路径", "Cursor path")}</span>
          <div className="cursor-path-row">
            <input data-dialog-autofocus aria-label={l("Cursor 路径", "Cursor path")} value={draft} placeholder={l("默认路径", "Default path")} disabled={Boolean(busy) || !ready} onChange={(event) => { setDraft(event.target.value); setScanError(""); setActionError(""); }}/>
            <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || !ready} onClick={() => void pick()}><FolderOpen size={14}/>{l("选择", "Browse")}</button>
            <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || !ready} onClick={() => void detect()}>
              <RefreshCw size={14} className={busy === "detect" ? "spin" : undefined}/>
              {busy === "detect" ? l("加载中...", "Loading...") : windows ? l("检测运行中应用", "Scan running apps") : l("自动检测", "Auto detect")}
            </button>
          </div>
        </label>
        {candidates.length > 0 && <ul className="cursor-path-candidates">{candidates.map((candidate) => <li key={candidate.target}><button type="button" className={`cursor-path-candidate${draft.trim() === candidate.target ? " selected" : ""}`} disabled={Boolean(busy)} onClick={() => { setDraft(candidate.target); setScanError(""); setActionError(""); }}><span>{candidate.label || l("Cursor", "Cursor")}</span><code>{candidate.target}</code></button></li>)}</ul>}
        {(scanError || actionError) && <p className="modal-inline-error" role="alert">{scanError || `${l("切换失败", "Switch failed")}: ${actionError}`}</p>}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => { if (!busy) onClose(); }}>{l("取消", "Cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={Boolean(busy) || !draft.trim()} onClick={() => void save()}>{busy === "save" ? l("保存中…", "Saving…") : l("保存并继续", "Save and continue")}</button>
      </div>
    </section>
  </div>;
}
