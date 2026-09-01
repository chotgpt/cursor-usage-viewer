/* Derived from Cockpit Tools src/components/AccountTagFilterDropdown.tsx. */
import { useEffect, useRef, useState } from "react";
import { Tag } from "lucide-react";
import { useDropdownPanelPlacement } from "../../hooks/useDropdownPanelPlacement";
import type { Language } from "../../i18n";
import "./AccountFilterDropdown.css";

export function AccountTagFilterDropdown({ language, availableTags, selectedTags, groupByTag, onToggleTag, onToggleGrouping, onClear }: { language: Language; availableTags: string[]; selectedTags: string[]; groupByTag: boolean; onToggleTag: (tag: string) => void; onToggleGrouping: () => void; onClear: () => void }) {
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { panelPlacement, panelRef, scrollContainerStyle } = useDropdownPanelPlacement(rootRef, open, availableTags.length);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) setOpen(false);
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onPointerDown), 0);
    return () => { window.clearTimeout(timer); document.removeEventListener("mousedown", onPointerDown); };
  }, [open]);
  return <div className="tag-filter account-filter-surface" ref={rootRef}>
    <button type="button" className={`tag-filter-btn ${selectedTags.length > 0 ? "active" : ""}`} onClick={() => setOpen((previous) => !previous)} aria-label={l("标签筛选", "Tag filter")} aria-expanded={open}><Tag size={14}/>{selectedTags.length > 0 ? `${l("标签", "Tags")}(${selectedTags.length})` : l("标签筛选", "Tag filter")}</button>
    {open && <div ref={panelRef} className={`tag-filter-panel ${panelPlacement === "top" ? "open-top" : ""}`}>
      {availableTags.length === 0 ? <div className="tag-filter-empty">{l("暂无可用标签", "No tags")}</div> : <div className="tag-filter-options" style={scrollContainerStyle}>{availableTags.map((tag) => <label key={tag} className={`tag-filter-option ${selectedTags.includes(tag) ? "selected" : ""}`}><input type="checkbox" checked={selectedTags.includes(tag)} onChange={() => onToggleTag(tag)}/><span className="tag-filter-name">{tag}</span></label>)}</div>}
      <div className="tag-filter-divider"/><label className={`tag-filter-option tag-filter-group-toggle ${groupByTag ? "selected" : ""}`}><input type="checkbox" checked={groupByTag} onChange={onToggleGrouping}/><span className="tag-filter-name">{l("按标签分组展示", "Group by tag")}</span></label>
      {selectedTags.length > 0 && <button type="button" className="tag-filter-clear" onClick={onClear}>{l("清空筛选", "Clear filter")}</button>}
    </div>}
  </div>;
}
