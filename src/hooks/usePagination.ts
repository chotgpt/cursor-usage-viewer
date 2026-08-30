import { useEffect, useMemo, useState } from "react";
export const PAGE_SIZES = [20, 50, 100] as const;
export function usePagination<T>(items: T[]) {
  const [pageSize, setPageSizeState] = useState(() => { const value = Number(localStorage.getItem("cursor-page-size")); return PAGE_SIZES.includes(value as 20) ? value : 20; });
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => setPage((value) => Math.min(value, pageCount)), [pageCount]);
  const pageItems = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
  const setPageSize = (value: number) => { setPageSizeState(value); localStorage.setItem("cursor-page-size", String(value)); setPage(1); };
  return { page, setPage, pageSize, setPageSize, pageCount, pageItems };
}
