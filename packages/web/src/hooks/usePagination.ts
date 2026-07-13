import { useCallback, useEffect, useRef, useState } from 'react';
import { usePreferences } from '@/hooks/usePreferences';

export const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

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

  // 渲染期由 buildPagination 收集最近一次的数据总数，用于页码越界钳制
  const lastTotalRef = useRef<number | null>(null);

  // 页码越界自动回退：删除（单条/批量）或搜索导致总数收缩后，当前页可能超出最大页数
  // （表现为停留在空页）。每次渲染后做一次 O(1) 检查，越界则钳制到最后一页。
  // total 为 0 时跳过：可能是查询加载中的占位值（data?.total ?? 0），此时钳页会误跳第 1 页；
  // 真正删空时列表本就显示空态，待有新数据（total > 0）后会自动钳回有效页。
  // 注意：有意不传依赖数组——total 经 ref 在渲染期更新（无法作为依赖），须每次渲染后检查。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const total = lastTotalRef.current;
    if (!total) return;
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > maxPage) setPage(maxPage);
  });

  const resetPage = useCallback(() => setPage(1), []);

  const buildPagination = useCallback(
    (total: number, onFetch?: (page: number, pageSize: number) => void): PaginationConfig => {
      lastTotalRef.current = total;
      return {
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
      };
    },
    [page, pageSize],
  );

  return { page, pageSize, setPage, setPageSize, resetPage, buildPagination };
}
