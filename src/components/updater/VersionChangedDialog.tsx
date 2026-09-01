import type { PendingNotes } from "../../hooks/useAppUpdater";
import type { Language } from "../../i18n";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { X } from "lucide-react";

export default function VersionChangedDialog({
  change,
  language,
  onClose,
}: {
  change: PendingNotes;
  language: Language;
  onClose: () => void;
}) {
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  return <div className="modal-overlay" role="presentation">
    <section ref={dialogRef} className="modal version-changed" role="dialog" aria-modal="true" aria-label={l("版本更新说明", "What's new")}>
      <div className="modal-header"><div><small>UPDATE COMPLETE</small><h2>{l("版本更新说明", "What's new")}</h2></div><button className="modal-close" aria-label={l("关闭", "Close")} onClick={onClose}><X size={18}/></button></div>
      <div className="modal-body"><p className="version-route">{change.fromVersion} → {change.toVersion}</p><div className="release-notes">{change.notes || l("本次更新未提供详细说明。", "No release notes were provided for this update.")}</div></div>
      <div className="modal-footer"><button className="btn btn-primary" onClick={onClose}>{l("知道了", "Got it")}</button></div>
    </section>
  </div>;
}
