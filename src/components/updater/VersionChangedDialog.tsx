import type { PendingNotes } from "../../hooks/useAppUpdater";

export default function VersionChangedDialog({
  change,
  onClose,
}: {
  change: PendingNotes;
  onClose: () => void;
}) {
  return <div className="modal-backdrop" role="presentation">
    <section className="modal version-changed" role="dialog" aria-modal="true" aria-label="版本更新说明">
      <header><div><small>UPDATE COMPLETE</small><h2>版本更新说明</h2></div></header>
      <p className="version-route">{change.fromVersion} → {change.toVersion}</p>
      <div className="release-notes">{change.notes || "本次更新未提供详细说明。"}</div>
      <div className="modal-actions"><button className="primary" onClick={onClose}>知道了</button></div>
    </section>
  </div>;
}
