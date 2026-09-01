/* Derived from Cockpit Tools src/components/SingleSelectFilterDropdown.tsx. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDropdownPanelPlacement } from "../../hooks/useDropdownPanelPlacement";
import "./AccountFilterDropdown.css";

export type SingleSelectFilterOption = { value: string; label: string };

export function SingleSelectFilterDropdown({ value, options, ariaLabel, placeholder, icon, disabled = false, onChange }: {
  value: string;
  options: SingleSelectFilterOption[];
  ariaLabel: string;
  placeholder?: string;
  icon?: ReactNode;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { panelPlacement, panelRef, scrollContainerStyle } = useDropdownPanelPlacement(rootRef, open, options.length);
  const selectedOption = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) setOpen(false);
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onPointerDown), 0);
    return () => { window.clearTimeout(timer); document.removeEventListener("mousedown", onPointerDown); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className="tag-filter single-filter account-filter-surface" ref={rootRef}>
    <button type="button" className={`tag-filter-btn single-filter-btn ${open ? "active" : ""}`} onClick={() => !disabled && setOpen((previous) => !previous)} aria-label={ariaLabel} aria-expanded={open} disabled={disabled}>
      {icon && <span className="single-filter-icon">{icon}</span>}<span className="single-filter-label" title={selectedOption?.label ?? placeholder ?? ""}>{selectedOption?.label ?? placeholder ?? ""}</span>
    </button>
    {open && <div ref={panelRef} className={`tag-filter-panel single-filter-panel ${panelPlacement === "top" ? "open-top" : ""}`}><div className="tag-filter-options" style={scrollContainerStyle}>{options.map((option) => <button key={option.value} type="button" className={`tag-filter-option single-filter-option ${option.value === value ? "selected" : ""}`} onClick={() => { onChange(option.value); setOpen(false); }}><span className="tag-filter-name">{option.label}</span></button>)}</div></div>}
  </div>;
}
