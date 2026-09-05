import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, Input, Spin, Empty, Toast } from '@douyinfe/semi-ui';
import { Download, Lock, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import './report-grid.css';
import './report-screen.css';
import { ScreenCanvas } from './widgets/ScreenCanvas';
import { FilterBar } from './widgets/FilterBar';
import { MobileDashboardHeader } from './widgets/MobileDashboardHeader';
import { filterValuesFromSearch, withFilterParam } from './widgets/filter-url';
import { useIsMobile } from '@/hooks/useMediaQuery';
import type { ReportCanvasItem, ReportDatasetQueryOptions, ReportEmbedDrilldownPayload, ReportEmbedFilterChangePayload, ReportEmbedFilterValue, ReportEmbedFilterValues, ReportEmbedState, ReportEmbedWidgetClickPayload, ReportFilter, ReportGridItem, ReportPublicDashboard, ReportWidget } from '@zenith/shared/report';
import { usePublicReportDashboard, usePublicReportDashboardAccess, usePublicReportDashboardData } from '@/hooks/queries/report-dashboards';
import { ApiError } from '@/lib/query';
import { sanitizeReportEmbedFilterValues, useReportEmbedBridge } from '@/components/report-embed-bridge';
import { openExternalUrl } from '@/utils/safe-url';

function defaultFilterValue(f: ReportFilter): unknown {
  if (f.defaultValue !== undefined) return f.defaultValue;
  return f.type === 'multiSelect' ? [] : undefined;
}

function defaultFilterValues(filters: readonly ReportFilter[]): Record<string, unknown> {
  return Object.fromEntries(filters.map((filter) => [filter.id, defaultFilterValue(filter)]));
}

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
  const [widgetQueries, setWidgetQueries] = useState<Record<string, ReportDatasetQueryOptions>>({});
  const [sessionToken, setSessionToken] = useState<string | undefined>(undefined);
  const [bootstrapDashboard, setBootstrapDashboard] = useState<ReportPublicDashboard | null>(null);

  const accessMutation = usePublicReportDashboardAccess();
  const dashboardQuery = usePublicReportDashboard(token, sessionToken, !!sessionToken);
  const dashboard = dashboardQuery.data ?? bootstrapDashboard;
  const dataQuery = usePublicReportDashboardData(token, sessionToken, debouncedFilterValues, widgetQueries, !!dashboard && !!sessionToken);
  const dataMap = dataQuery.data ?? {};
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
    setWidgetQueries({});
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
    setWidgetQueries({});
    setSearchParams((prev) => withFilterParam(prev, fid, val), { replace: true });
  }

  const setFiltersAndUrl = useCallback((values: Record<string, unknown>) => {
    filterValuesRef.current = values;
    setFilterValues(values);
    setWidgetQueries({});
    setSearchParams((previous) => {
      let next = new URLSearchParams(previous);
      for (const filter of filters) next = withFilterParam(next, filter.id, values[filter.id]);
      return next;
    }, { replace: true });
  }, [filters, setSearchParams]);

  const handleWidgetQueryChange = useCallback((widgetId: string, next: ReportDatasetQueryOptions) => {
    setWidgetQueries((prev) => ({ ...prev, [widgetId]: next }));
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([dashboardQuery.refetch(), dataQuery.refetch()]);
  }, [dashboardQuery, dataQuery]);

  const exportPng = useCallback(async (): Promise<string | null> => {
    if (!rootRef.current) return null;
    const backgroundColor = window.getComputedStyle(rootRef.current).backgroundColor;
    return toPng(rootRef.current, {
      backgroundColor: backgroundColor === 'rgba(0, 0, 0, 0)' ? undefined : backgroundColor,
      pixelRatio: 2,
      cacheBust: true,
    });
  }, []);

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
      ...(filterId ? {
        filterId,
        value: (sanitizeReportEmbedFilterValues({ value: values[filterId] }).value ?? String(values[filterId] ?? '')) as ReportEmbedFilterValue,
      } : {}),
      filterValues: sanitizeReportEmbedFilterValues(values, new Set(filters.map((filter) => filter.id))),
    };
    bridge.emit('filterChanged', payload);
  }, [bridge, effectiveReadOnly, filters, setFiltersAndUrl]);

  const handlePublicFilterChange = useCallback((filterId: string, value: unknown) => {
    applyUserFilters({ ...filterValuesRef.current, [filterId]: value }, filterId);
  }, [applyUserFilters]);

  const handleWidgetClick = useCallback((widget: ReportWidget) => {
    const payload: ReportEmbedWidgetClickPayload = {
      widgetId: widget.i,
      widgetTitle: widget.title || widget.i,
      widgetType: widget.type,
    };
    bridge.emit('widgetClicked', payload);
  }, [bridge]);

  const handleCategoryClick = useCallback((widget: ReportWidget, value: string) => {
    const selected = { field: widget.options?.categoryField, value };
    if (widget.interaction?.enabled && widget.interaction.setFilterId && !effectiveReadOnly) {
      handlePublicFilterChange(widget.interaction.setFilterId, value);
    }
    if (!widget.drilldown?.enabled) return;
    const drilldownType = widget.drilldown.type ?? 'fields';
    const payload: ReportEmbedDrilldownPayload = {
      widgetId: widget.i,
      widgetTitle: widget.title || widget.i,
      widgetType: widget.type,
      selected,
      drilldownType,
      ...(widget.drilldown.targetDashboardId ? { targetDashboardId: widget.drilldown.targetDashboardId } : {}),
      ...(widget.drilldown.paramName ? { paramName: widget.drilldown.paramName } : {}),
    };
    bridge.emit('drilldown', payload);
    if (drilldownType === 'url' && widget.drilldown.url) {
      openExternalUrl(widget.drilldown.url.replace('{value}', encodeURIComponent(value)));
    }
  }, [bridge, effectiveReadOnly, handlePublicFilterChange]);

  async function downloadPng() {
    try {
      const dataUrl = await exportPng();
      if (!dataUrl) return;
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = `${dashboard?.name ?? 'dashboard'}.png`;
      anchor.click();
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

  const widgets = dashboard?.widgets ?? [];
  const isDark = dashboard?.config?.theme === 'dark';
  const isCanvas = dashboard?.config?.layoutMode === 'canvas';
  const screen = dashboard?.config?.screenConfig;
  const aspect = isCanvas ? `${screen?.width || 1920} / ${screen?.height || 1080}` : undefined;

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
          actions={[
            { key: 'refresh', label: '刷新', icon: <RefreshCw size={15} />, onClick: () => void refresh() },
            { key: 'export', label: '导出图片', icon: <Download size={15} />, onClick: () => void downloadPng() },
          ]}
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
      {widgets.length === 0 ? (
        <Empty description="该仪表盘还没有组件" style={{ paddingTop: 80 }} />
      ) : (
        <div style={isCanvas && !isMobile ? { width: '100%', aspectRatio: aspect, maxHeight: 'calc(100vh - 120px)' } : undefined}>
          <ScreenCanvas
            widgets={widgets}
            layout={(dashboard?.layout ?? []) as ReportGridItem[]}
            canvasLayout={(dashboard?.canvasLayout ?? []) as ReportCanvasItem[]}
            config={dashboard?.config ?? {}}
            filterValues={filterValues}
            getWidgetState={(w: ReportWidget) => ({
              data: dataMap[w.i]?.data ?? null,
              loading: dataQuery.isFetching,
              error: dataMap[w.i]?.error?.message ?? null,
            })}
            getWidgetQuery={(widget) => widgetQueries[widget.i]}
            onWidgetQueryChange={effectiveReadOnly ? undefined : handleWidgetQueryChange}
            onCategoryClick={handleCategoryClick}
            onWidgetClick={handleWidgetClick}
          />
        </div>
      )}
    </div>
  );
}
