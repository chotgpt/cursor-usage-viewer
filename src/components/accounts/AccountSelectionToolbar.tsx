/* Derived from Cockpit Tools src/components/AccountSelectionToolbar.tsx. */
import type { ReactNode } from "react";
import type { Language } from "../../i18n";

export function AccountSelectionToolbar({ language, selectedCount, allSelected, disabled = false, onToggleSelectAll, onClearSelection, actions }: {
  language: Language;
  selectedCount: number;
  allSelected: boolean;
  disabled?: boolean;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  actions?: ReactNode;
}) {
  const hasSelection = selectedCount > 0;
  return <div className="codex-overview-selection-bar account-selection-toolbar">
    <div className="codex-overview-selection-left">
      <label className="codex-overview-select-all"><input type="checkbox" aria-label={language === "en" ? "Select current page" : "全选当前页"} checked={allSelected} disabled={disabled} onChange={onToggleSelectAll}/><span>{language === "en" ? "Select all" : "全选"}</span></label>
      {hasSelection && <><span className="codex-overview-selected-count">{language === "en" ? `${selectedCount} selected` : `已选 ${selectedCount}`}</span><button type="button" className="codex-overview-clear-selection-btn" onClick={onClearSelection}>{language === "en" ? "Clear selection" : "取消选择"}</button></>}
    </div>
    {hasSelection && actions ? <div className="codex-overview-selection-actions">{actions}</div> : null}
  </div>;
}
