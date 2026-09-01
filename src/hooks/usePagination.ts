import { useEffect, useMemo, useState } from "react";
export const PAGE_SIZES = [20, 50, 100] as const;
function readPageSize() {
  try {
    const value = Number(localStorage.getItem("cursor-page-size"));
    return PAGE_SIZES.includes(value as 20) ? value : 20;
  } catch {
    return 20;
  }
}
export function usePagination<T>(items: T[]) {
  const [pageSize, setPageSizeState] = useState(readPageSize);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => setPage((value) => Math.min(value, pageCount)), [pageCount]);
  const pageItems = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
  const setPageSize = (value: number) => {
    const firstVisibleIndex = (page - 1) * pageSize;
    setPageSizeState(value);
    try { localStorage.setItem("cursor-page-size", String(value)); } catch { /* Keep the in-memory preference. */ }
    setPage(Math.floor(firstVisibleIndex / value) + 1);
  };
  return { page, setPage, pageSize, setPageSize, pageCount, pageItems };
}
