import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '@/utils/request';

const PAGE_SIZE = 200;
/** 与后端 db-admin.service 的 MAX_ROWS 对齐 */
const MAX_ROWS = 5000;

interface TableRowsResponse {
  list: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
}

interface Params {
  schema?: string;
  table?: string;
  enabled: boolean;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  filters: Record<string, string>;
  search: string;
  /** 原生 WHERE 片段（需 query 权限） */
  whereRaw?: string;
}

/**
 * 表数据无限滚动加载：分批消费现有 GET /rows 接口（200 行/批）。
 * 防闪烁（stale-while-revalidate）：同一张表内排序 / 筛选 / 搜索变化时保留旧数据展示，
 * 新数据到达后一次性替换（refreshing 标记）；换表则立即清空。
 */
export function useTableRowsInfinite(params: Params) {
  const { schema, table, enabled, orderBy, orderDir, filters, search, whereRaw } = params;
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pagesRef = useRef(0);
  const generationRef = useRef(0);
  const fetchingMoreRef = useRef(false);
  /** 表身份：变化时才清空旧数据 */
  const identityRef = useRef('');

  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  const fetchPage = useCallback(async (page: number): Promise<TableRowsResponse | null> => {
    if (!schema || !table) return null;
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('pageSize', String(PAGE_SIZE));
    if (orderBy && orderDir) {
      qs.set('orderBy', orderBy);
      qs.set('orderDir', orderDir);
    }
    const active = Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length > 0));
    if (Object.keys(active).length > 0) qs.set('filters', JSON.stringify(active));
    if (search.trim()) qs.set('search', search.trim());
    if (whereRaw?.trim()) qs.set('where', whereRaw.trim());
    const res = await request.get<TableRowsResponse>(
      `/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows?${qs.toString()}`,
    );
    if (res.code !== 0 || !res.data) return null;
    return res.data;
    // filtersKey 代表 filters 的稳定序列化，避免对象引用抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, table, orderBy, orderDir, filtersKey, search, whereRaw]);

  // 参数变化：重置并加载第一页（同表保留旧数据防闪烁；换表立即清空）
  useEffect(() => {
    const gen = ++generationRef.current;
    pagesRef.current = 0;
    fetchingMoreRef.current = false;
    setLoadingMore(false);
    const identity = `${schema ?? ''}\u0001${table ?? ''}`;
    const identityChanged = identity !== identityRef.current;
    identityRef.current = identity;
    if (identityChanged) {
      setRows([]);
      setTotal(0);
    }
    if (!enabled || !schema || !table) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (identityChanged) setLoading(true);
    else setRefreshing(true);
    void (async () => {
      const data = await fetchPage(1);
      if (gen !== generationRef.current) return;
      if (data) {
        setRows(data.list);
        setTotal(data.total);
        pagesRef.current = 1;
      }
      setLoading(false);
      setRefreshing(false);
    })();
  }, [enabled, schema, table, fetchPage]);

  const hasMore = rows.length > 0 && rows.length < Math.min(total, MAX_ROWS);

  const loadMore = useCallback(() => {
    if (fetchingMoreRef.current || !hasMore || !enabled) return;
    fetchingMoreRef.current = true;
    setLoadingMore(true);
    const gen = generationRef.current;
    void (async () => {
      const data = await fetchPage(pagesRef.current + 1);
      if (gen !== generationRef.current) return;
      fetchingMoreRef.current = false;
      setLoadingMore(false);
      if (data) {
        pagesRef.current += 1;
        setRows((prev) => [...prev, ...data.list]);
        setTotal(data.total);
      }
    })();
  }, [hasMore, enabled, fetchPage]);

  /** 并行重取所有已加载页（保持滚动位置），行编辑 / 删除后调用 */
  const refresh = useCallback(async () => {
    if (!enabled || !schema || !table) return;
    const pages = Math.max(1, pagesRef.current);
    const gen = ++generationRef.current;
    const results = await Promise.all(
      Array.from({ length: pages }, (_, i) => fetchPage(i + 1)),
    );
    if (gen !== generationRef.current) return;
    const list: Array<Record<string, unknown>> = [];
    let newTotal = 0;
    let loadedPages = 0;
    for (const r of results) {
      if (!r) break;
      list.push(...r.list);
      newTotal = r.total;
      loadedPages += 1;
      if (r.list.length < PAGE_SIZE) break;
    }
    pagesRef.current = Math.max(1, loadedPages);
    setRows(list);
    setTotal(newTotal);
    fetchingMoreRef.current = false;
    setLoadingMore(false);
  }, [enabled, schema, table, fetchPage]);

  return { rows, total, loading, refreshing, loadingMore, hasMore, loadMore, refresh, maxRows: MAX_ROWS };
}
