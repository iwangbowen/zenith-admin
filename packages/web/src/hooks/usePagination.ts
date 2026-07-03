import { useCallback, useState } from 'react';
import { usePreferences } from '@/hooks/usePreferences';

export interface PaginationConfig {
  currentPage: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export interface UsePaginationReturn {
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  /** 搜索/重置时调用，将页码重置为第 1 页 */
  resetPage: () => void;
  /**
   * 生成传给 ConfigurableTable 的 pagination 对象。
   * @param total   数据总条数
   * @param onFetch 翻页/换尺寸时调用的拉取函数，接收 (page, pageSize) 两个参数。
   *                使用 TanStack Query（page/pageSize 进入 query key）时无需传入，状态变化自动触发请求
   */
  buildPagination: (total: number, onFetch?: (page: number, pageSize: number) => void) => PaginationConfig;
}

/**
 * 封装列表页的分页状态管理，消除各页面重复的 pagination 样板代码。
 *
 * @example
 * ```tsx
 * const { page, pageSize, setPage, resetPage, buildPagination } = usePagination();
 *
 * const fetchData = useCallback(async (p = page, ps = pageSize) => {
 *   const res = await request.get(`/api/items?page=${p}&pageSize=${ps}`);
 *   if (res.code === 0) setData(res.data);
 * }, [page, pageSize]);
 *
 * <ConfigurableTable pagination={buildPagination(data?.total ?? 0, fetchData)} />
 * ```
 */
export function usePagination(overrideDefaultPageSize?: number): UsePaginationReturn {
  const { preferences } = usePreferences();
  const defaultPageSize = overrideDefaultPageSize ?? preferences.tablePageSize ?? 10;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const resetPage = useCallback(() => setPage(1), []);

  const buildPagination = useCallback(
    (total: number, onFetch?: (page: number, pageSize: number) => void): PaginationConfig => ({
      currentPage: page,
      pageSize,
      total,
      onPageChange: (p: number) => {
        setPage(p);
        onFetch?.(p, pageSize);
      },
      onPageSizeChange: (size: number) => {
        setPageSize(size);
        setPage(1);
        onFetch?.(1, size);
      },
    }),
    [page, pageSize],
  );

  return { page, pageSize, setPage, setPageSize, resetPage, buildPagination };
}
