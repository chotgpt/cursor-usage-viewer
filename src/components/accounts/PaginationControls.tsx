/* Derived from Cockpit Tools src/components/PaginationControls.tsx. */
import { Rows3 } from "lucide-react";
import { SingleSelectFilterDropdown } from "./SingleSelectFilterDropdown";
import type { Language } from "../../i18n";

export function PaginationControls({ language, totalItems, currentPage, totalPages, pageSize, pageSizeOptions, rangeStart, rangeEnd, onPageSizeChange, onPreviousPage, onNextPage }: {
  language: Language;
  totalItems: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  rangeStart: number;
  rangeEnd: number;
  onPageSizeChange: (pageSize: number) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  if (totalItems === 0) return null;
  return <div className="pagination-container">
    <div className="pagination-info">{language === "en" ? `${rangeStart} - ${rangeEnd} of ${totalItems} accounts` : `${rangeStart} - ${rangeEnd}，共 ${totalItems} 个账号`}</div>
    <div className="pagination-controls"><SingleSelectFilterDropdown value={String(pageSize)} options={pageSizeOptions.map((count) => ({ value: String(count), label: language === "en" ? `${count} / page` : `${count} / 页` }))} ariaLabel={language === "en" ? `${pageSize} per page` : `每页 ${pageSize}`} icon={<Rows3 size={14}/>} onChange={(value) => onPageSizeChange(Number.parseInt(value, 10))}/><div className="pagination-buttons"><button type="button" className="pagination-btn" onClick={onPreviousPage} disabled={currentPage <= 1}>{language === "en" ? "Previous" : "上一页"}</button><span className="pagination-page">{language === "en" ? `Page ${currentPage} / ${totalPages}` : `第 ${currentPage} / ${totalPages} 页`}</span><button type="button" className="pagination-btn" onClick={onNextPage} disabled={currentPage >= totalPages}>{language === "en" ? "Next" : "下一页"}</button></div></div>
  </div>;
}
