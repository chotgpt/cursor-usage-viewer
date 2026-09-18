import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Copy, X } from "lucide-react";
import type { Language } from "../../i18n";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import type { WindowsOperationErrorDetail } from "../../utils/windowsOperationError";
import { redactWindowsOperationError } from "../../utils/windowsOperationError";
import "./WindowsOperationDialog.css";

export function WindowsOperationDialog({ language, error, onClose, onRetry, onAuthorize }: {
  language: Language;
  error: WindowsOperationErrorDetail;
  onClose: () => void;
  onRetry: () => Promise<void>;
  onAuthorize?: () => Promise<void>;
}) {
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const [busy, setBusy] = useState<"retry" | "authorize" | null>(null);
  const [actionError, setActionError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>(() => { if (!busy) onClose(); });

  useEffect(() => {
    setBusy(null);
    setActionError("");
    setDetailsOpen(false);
    setCopied(false);
  }, [error]);

  const description = error.code === "access_denied"
    ? l("系统拒绝访问该进程。可授权后重试关闭默认 Cursor 实例。", "Windows denied access to the process. Authorize and retry closing the default Cursor instance.")
    : error.code === "file_in_use"
      ? l("目标文件正在使用。", "The target file is in use.")
      : error.code === "program_not_found"
        ? l("找不到所需程序。", "The required program was not found.")
        : l("Windows 操作失败，可查看脱敏详情后重试。", "The Windows operation failed. Review the redacted details and retry.");

  const details = redactWindowsOperationError([
    error.summary,
    error.originalReason,
    error.operation,
    error.target ?? "",
    error.pids.join(", "),
    error.attemptedRecoveries.join(" · "),
  ].filter(Boolean).join("\n"));

  const run = async (kind: "retry" | "authorize", action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setActionError("");
    try {
      await action();
      onClose();
    } catch (next) {
      const text = next instanceof Error ? next.message : String(next);
      setActionError(text.includes("WINDOWS_ELEVATION_CANCELLED") ? l("已取消授权", "Authorization cancelled") : redactWindowsOperationError(text));
      setBusy(null);
    }
  };

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setActionError(l("复制失败", "Copy failed"));
    }
  };

  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="modal windows-operation-dialog" role="dialog" aria-modal="true" aria-label={error.summary} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header">
        <h2>{error.summary}</h2>
        <button className="modal-close" aria-label={l("关闭", "Close")} disabled={Boolean(busy)} onClick={() => { if (!busy) onClose(); }}><X size={18}/></button>
      </div>
      <div className="modal-body">
        <p>{description}</p>
        <div className="windows-operation-details-toggle">
          <button type="button" className="btn btn-secondary" onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}{l("详情", "Details")}</button>
          <button type="button" className="btn btn-secondary" onClick={() => void copyDetails()}><Copy size={14}/>{copied ? l("已复制", "Copied") : l("复制详情", "Copy details")}</button>
        </div>
        {detailsOpen && <pre className="windows-operation-details" aria-label={l("脱敏详情", "Redacted details")}>{details}</pre>}
        {actionError && <p className="modal-inline-error" role="alert">{actionError}</p>}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => { if (!busy) onClose(); }}>{l("取消", "Cancel")}</button>
        {error.retryable && <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => void run("retry", onRetry)}>{busy === "retry" ? l("重试中…", "Retrying…") : l("重试", "Retry")}</button>}
        {error.canElevate && onAuthorize && <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void run("authorize", onAuthorize)}>{busy === "authorize" ? l("授权中…", "Authorizing…") : l("授权并继续", "Authorize and continue")}</button>}
      </div>
    </section>
  </div>;
}
