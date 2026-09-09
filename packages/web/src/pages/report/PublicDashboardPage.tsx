import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, Input, Spin, Empty, Toast } from '@douyinfe/semi-ui';
import { Lock } from 'lucide-react';
import './report-grid.css';
import './report-screen.css';
import { FilterBar } from './widgets/FilterBar';
import { MobileDashboardHeader } from './widgets/MobileDashboardHeader';
import { filterValuesFromSearch, withFilterParam } from './widgets/filter-url';
import {
  dashboardMobileActions,
  defaultFilterValue,
  defaultFilterValues,
  downloadDataUrl,
  drilldownPayload,
  exportDashboardPng,
  openDrilldownUrl,
  safeFilterValue,
  useDashboardWidgetQueries,
  widgetClickPayload,
  widgetStateFromDataMap,
} from './widgets/dashboard-runtime';
import { DashboardCanvasView } from './widgets/DashboardCanvasView';
import { useIsMobile } from '@/hooks/useMediaQuery';
import type { ReportEmbedFilterChangePayload, ReportEmbedFilterValues, ReportEmbedState, ReportPublicDashboard, ReportWidget } from '@zenith/shared/report';
import { usePublicReportDashboard, usePublicReportDashboardAccess, usePublicReportDashboardData } from '@/hooks/queries/report-dashboards';
import { ApiError } from '@/lib/query';
import { sanitizeReportEmbedFilterValues, useReportEmbedBridge } from '@/components/report-embed-bridge';

export default function PublicDashboardPage() {
  const { token } = useParams<{ token: string }>();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [needPwd, setNeedPwd] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const [debouncedFilterValues] = useDebouncedValue(filterValues, { wait: 250 });
  const { widgetQueries, resetWidgetQueries, handleWidgetQueryChange } = useDashboardWidgetQueries();
  const [sessionToken, setSessionToken] = useState<string | undefined>(undefined);
  const [bootstrapDashboard, setBootstrapDashboard] = useState<ReportPublicDashboard | null>(null);

  const accessMutation = usePublicReportDashboardAccess();
  const dashboardQuery = usePublicReportDashboard(token, sessionToken, !!sessionToken);
  const dashboard = dashboardQuery.data ?? bootstrapDashboard;
  const dataQuery = usePublicReportDashboardData(token, sessionToken, debouncedFilterValues, widgetQueries, !!dashboard && !!sessionToken);
  const filters = useMemo(() => dashboard?.filters ?? [], [dashboard]);
  const filterDefaults = useMemo(() => defaultFilterValues(filters), [filters]);
  const filterValuesRef = useRef<Record<string, unknown>>(filterValues);
  filterValuesRef.current = filterValues;
  const effectiveReadOnly = dashboard?.config?.embed?.readOnly ?? false;

  const initializedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dashboard) return;
    const key = `${token ?? ''}:${sessionToken ?? 'bootstrap'}`;
    if (initializedSessionRef.current === key) return;
    initializedSessionRef.current = key;
    setNeedPwd(false);
    setError(null);
    const initialValues = filterValuesFromSearch(dashboard.filters ?? [], searchParams, defaultFilterValue);
    filterValuesRef.current = initialValues;
    setFilterValues(initialValues);
    resetWidgetQueries();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams 为初始化时的闭包快照，回写不重置
  }, [dashboard, sessionToken, token]);

  const load = useCallback(async (pwd?: string) => {
    if (!token) return;
    try {
      const session = await accessMutation.mutateAsync({ params: { token }, body: { password: pwd } });
      setSessionToken(session.accessSessionToken);
      setBootstrapDashboard(session.dashboard);
      setNeedPwd(false);
      setError(null);
    } catch (err) {
      setSessionToken(undefined);
      setBootstrapDashboard(null);
      if (err instanceof ApiError && err.code === 401) {
        setNeedPwd(true);
        Toast.error('访问密码错误');
        return;
      }
      setError(err instanceof Error ? err.message : '链接不存在或已失效');
    }
  }, [accessMutation, token]);

  useEffect(() => {
    if (!token || sessionToken || accessMutation.isPending || dashboard || needPwd || error) return;
    void load();
  }, [accessMutation.isPending, dashboard, error, load, needPwd, sessionToken, token]);

  function onFilterChange(fid: string, val: unknown) {
    if (effectiveReadOnly) return;
    const next = { ...filterValuesRef.current, [fid]: val };
    filterValuesRef.current = next;
    setFilterValues(next);
    resetWidgetQueries();
    setSearchParams((prev) => withFilterParam(prev, fid, val), { replace: true });
  }

  const setFiltersAndUrl = useCallback((values: Record<string, unknown>) => {
    filterValuesRef.current = values;
    setFilterValues(values);
    resetWidgetQueries();
    setSearchParams((previous) => {
      let next = new URLSearchParams(previous);
      for (const filter of filters) next = withFilterParam(next, filter.id, values[filter.id]);
      return next;
    }, { replace: true });
  }, [filters, resetWidgetQueries, setSearchParams]);

  const refresh = useCallback(async () => {
    await Promise.all([dashboardQuery.refetch(), dataQuery.refetch()]);
  }, [dashboardQuery, dataQuery]);

  const exportPng = useCallback(() => exportDashboardPng(rootRef.current), []);

  const getState = useCallback((): ReportEmbedState => ({
    ...(dashboard?.name ? { dashboardName: dashboard.name } : {}),
    loaded: !!dashboard,
    loading: dashboardQuery.isFetching || accessMutation.isPending,
    error: error ?? (dashboardQuery.error instanceof Error ? dashboardQuery.error.message : null),
    readOnly: effectiveReadOnly,
    filterValues: sanitizeReportEmbedFilterValues(
      filterValuesRef.current,
      new Set(filters.map((filter) => filter.id)),
    ),
  }), [accessMutation.isPending, dashboard, dashboardQuery.error, dashboardQuery.isFetching, effectiveReadOnly, error, filters]);

  const bridge = useReportEmbedBridge({
    allowedOrigins: dashboard?.config?.embed?.allowedOrigins,
    getFilterIds: () => filters.map((filter) => filter.id),
    getReadOnly: () => effectiveReadOnly,
    setFilter: (filterId, value) => {
      if (effectiveReadOnly || !filters.some((filter) => filter.id === filterId)) return;
      onFilterChange(filterId, value);
    },
    setFilters: (values: ReportEmbedFilterValues) => {
      if (effectiveReadOnly) return;
      setFiltersAndUrl({ ...filterValuesRef.current, ...values });
    },
    resetFilters: () => {
      if (!effectiveReadOnly) setFiltersAndUrl(filterDefaults);
    },
    refresh,
    getState,
    exportPng,
  });

  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dashboard) return;
    const key = `${token ?? ''}:${dashboard.name}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    bridge.emit('loaded', getState());
  }, [bridge, dashboard, getState, token]);

  const bridgeError = error ?? (dashboardQuery.error instanceof Error ? dashboardQuery.error.message : null);
  const lastBridgeErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bridgeError || lastBridgeErrorRef.current === bridgeError) return;
    lastBridgeErrorRef.current = bridgeError;
    bridge.emit('error', { message: bridgeError });
  }, [bridge, bridgeError]);

  const applyUserFilters = useCallback((values: Record<string, unknown>, filterId?: string) => {
    if (effectiveReadOnly) return;
    setFiltersAndUrl(values);
    const payload: ReportEmbedFilterChangePayload = {
      ...(filterId ? { filterId, value: safeFilterValue(values[filterId]) } : {}),
      filterValues: sanitizeReportEmbedFilterValues(values, new Set(filters.map((filter) => filter.id))),
    };
    bridge.emit('filterChanged', payload);
  }, [bridge, effectiveReadOnly, filters, setFiltersAndUrl]);

  const handlePublicFilterChange = useCallback((filterId: string, value: unknown) => {
    applyUserFilters({ ...filterValuesRef.current, [filterId]: value }, filterId);
  }, [applyUserFilters]);

  const handleWidgetClick = useCallback((widget: ReportWidget) => {
    bridge.emit('widgetClicked', widgetClickPayload(widget));
  }, [bridge]);

  const handleCategoryClick = useCallback((widget: ReportWidget, value: string) => {
    const selected = { field: widget.options?.categoryField, value };
    if (widget.interaction?.enabled && widget.interaction.setFilterId && !effectiveReadOnly) {
      handlePublicFilterChange(widget.interaction.setFilterId, value);
    }
    const payload = drilldownPayload(widget, selected);
    if (!payload) return;
    bridge.emit('drilldown', payload);
    if (payload.drilldownType === 'url') openDrilldownUrl(widget, value);
  }, [bridge, effectiveReadOnly, handlePublicFilterChange]);

  async function downloadPng() {
    try {
      downloadDataUrl(await exportPng(), `${dashboard?.name ?? 'dashboard'}.png`);
    } catch {
      Toast.error('导出失败，请重试');
    }
  }

  if ((dashboardQuery.isFetching || accessMutation.isPending) && !dashboard && !needPwd) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  const viewError = error ?? (dashboardQuery.error instanceof Error ? dashboardQuery.error.message : null);
  if (viewError) return <div style={{ padding: 80 }}><Empty description={viewError} /></div>;

  if (needPwd) {
    return (
      <div style={{ maxWidth: 320, margin: '120px auto', textAlign: 'center' }}>
        <Lock size={32} style={{ color: 'var(--semi-color-text-2)' }} />
        <div style={{ margin: '12px 0', color: 'var(--semi-color-text-1)' }}>该报表需要访问密码</div>
        <Input mode="password" placeholder="请输入密码" value={pwdInput} onChange={setPwdInput} onEnterPress={() => load(pwdInput)} style={{ marginBottom: 12 }} />
        <Button type="primary" block onClick={() => load(pwdInput)}>访问</Button>
      </div>
    );
  }

  const isDark = dashboard?.config?.theme === 'dark';
  const isCanvas = dashboard?.config?.layoutMode === 'canvas';

  return (
    <div ref={rootRef} className="report-view" style={{ minHeight: '100vh', ...(isDark ? { background: isCanvas ? '#060c1f' : '#0b1020' } : {}) }}>
      {isMobile ? (
        <MobileDashboardHeader
          title={dashboard?.name ?? '报表'}
          dark={isDark}
          filter={(
            <FilterBar
              compact
              filters={filters}
              values={filterValues}
              resetValues={filterDefaults}
              onChange={handlePublicFilterChange}
              onApply={(values) => applyUserFilters(values)}
              dynamicOptions={dashboard?.filterOptions ?? {}}
              disableDynamicOptions
              disabled={effectiveReadOnly}
            />
          )}
          actions={dashboardMobileActions(() => void refresh(), () => void downloadPng())}
        />
      ) : (
        <>
          <div className="report-view__title" style={{ color: isDark ? '#eaf4ff' : undefined }}>{dashboard?.name ?? '报表'}</div>
          <FilterBar
            filters={filters}
            values={filterValues}
            onChange={handlePublicFilterChange}
            dynamicOptions={dashboard?.filterOptions ?? {}}
            disableDynamicOptions
            disabled={effectiveReadOnly}
          />
        </>
      )}
      <DashboardCanvasView
        dashboard={dashboard ?? {}}
        isMobile={isMobile}
        filterValues={filterValues}
        getWidgetState={widgetStateFromDataMap(dataQuery.data, dataQuery.isFetching)}
        getWidgetQuery={(widget) => widgetQueries[widget.i]}
        onWidgetQueryChange={effectiveReadOnly ? undefined : handleWidgetQueryChange}
        onCategoryClick={handleCategoryClick}
        onWidgetClick={handleWidgetClick}
        emptyStyle={{ paddingTop: 80 }}
        canvasStyle={{ maxHeight: 'calc(100vh - 120px)' }}
      />
    </div>
  );
}
