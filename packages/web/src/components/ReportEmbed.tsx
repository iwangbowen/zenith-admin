import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Empty, Spin } from '@douyinfe/semi-ui';
import { useDebouncedValue } from '@tanstack/react-pacer';
import '@/pages/report/report-grid.css';
import '@/pages/report/report-screen.css';
import { FilterBar } from '@/pages/report/widgets/FilterBar';
import { MobileDashboardHeader } from '@/pages/report/widgets/MobileDashboardHeader';
import {
  dashboardMobileActions,
  defaultFilterValues,
  downloadDataUrl,
  drilldownPayload,
  exportDashboardPng,
  openDrilldownUrl,
  safeFilterValue,
  useDashboardWidgetQueries,
  widgetClickPayload,
  widgetStateFromDataMap,
} from '@/pages/report/widgets/dashboard-runtime';
import { DashboardCanvasView } from '@/pages/report/widgets/DashboardCanvasView';
import { useIsMobile } from '@/hooks/useMediaQuery';
import type { ReportEmbedDrilldownPayload, ReportEmbedFilterChangePayload, ReportEmbedFilterValue, ReportEmbedFilterValues, ReportEmbedState, ReportEmbedWidgetClickPayload, ReportWidget } from '@zenith/shared/report';
import { useReportDashboardWidgetData } from '@/hooks/queries/report-dashboards';
import { useReportEmbedDashboard, useReportEmbedData } from '@/hooks/queries/reports-embed';
import {
  sanitizeReportEmbedFilterValues,
  useReportEmbedBridge,
} from './report-embed-bridge';

export interface ReportEmbedHandle {
  refresh: () => Promise<void>;
  /** 受控或只读模式返回 false；受控值必须由宿主通过 props 更新。 */
  setFilter: (filterId: string, value: ReportEmbedFilterValue) => boolean;
  /** 受控或只读模式返回 false。 */
  resetFilters: () => boolean;
  getState: () => ReportEmbedState;
  exportPng: () => Promise<string | null>;
}

export interface ReportEmbedProps {
  /** 要嵌入的仪表盘 ID */
  dashboardId?: number;
  /** 可选 scoped embed token；传入后无需后台登录 */
  embedToken?: string;
  /**
   * 受控筛选值。传入后它是数据查询的唯一外部真值来源，组件不会用内部状态覆盖它；
   * 用户操作只触发 onFilterChange，宿主应回传新值。省略时组件自行维护筛选状态。
   */
  filterValues?: Record<string, unknown>;
  /** 是否显示内置筛选器栏（默认隐藏，由宿主控制）*/
  showFilters?: boolean;
  /** 只读模式会阻止筛选器、imperative API 和 postMessage 的筛选变更。 */
  readOnly?: boolean;
  /** 触发 onDrilldown 后阻止组件执行默认跳转。 */
  interceptDrilldown?: boolean;
  /** 精确宿主 origin 白名单；省略时读取仪表盘 config.embed.allowedOrigins，再回退为同源。 */
  allowedOrigins?: string[];
  onLoad?: (state: ReportEmbedState) => void;
  onError?: (error: Error) => void;
  /** 仅由筛选控件或组件联动等用户操作触发，不由 props/ref/postMessage 变更触发。 */
  onFilterChange?: (payload: ReportEmbedFilterChangePayload) => void;
  onWidgetClick?: (payload: ReportEmbedWidgetClickPayload) => void;
  onDrilldown?: (payload: ReportEmbedDrilldownPayload) => void;
  /** 容器高度（默认自适应内容）*/
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 标准报表嵌入组件。既支持 JSX 直接使用，也可通过 ref 和同源/白名单 postMessage 控制。
 *
 * @example
 * <ReportEmbed dashboardId={5} filterValues={{ f_dept: deptId }} height={420} />
 */
export const ReportEmbed = forwardRef<ReportEmbedHandle, Readonly<ReportEmbedProps>>(function ReportEmbed({
  dashboardId,
  embedToken,
  filterValues: external,
  showFilters,
  readOnly,
  interceptDrilldown = false,
  allowedOrigins: allowedOriginsProp,
  onLoad,
  onError,
  onFilterChange,
  onWidgetClick,
  onDrilldown,
  height,
  className,
  style,
}, ref) {
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [innerValues, setInnerValues] = useState<Record<string, unknown>>({});
  const { widgetQueries, resetWidgetQueries, handleWidgetQueryChange } = useDashboardWidgetQueries();
  const dashboardQuery = useReportEmbedDashboard(dashboardId, embedToken);
  const dashboard = dashboardQuery.data ?? null;
  const filterOptions = dashboard?.filterOptions;
  const widgets = useMemo(() => dashboard?.widgets ?? [], [dashboard]);
  const filters = useMemo(() => dashboard?.filters ?? [], [dashboard]);
  const defaults = useMemo(() => defaultFilterValues(filters), [filters]);
  const controlled = external !== undefined;
  const effectiveReadOnly = readOnly ?? dashboard?.config?.embed?.readOnly ?? false;
  const configuredOrigins = allowedOriginsProp ?? dashboard?.config?.embed?.allowedOrigins;
  const effectiveValues = useMemo(
    () => controlled ? { ...defaults, ...external } : innerValues,
    [controlled, defaults, external, innerValues],
  );
  const effectiveValuesRef = useRef<Record<string, unknown>>(effectiveValues);
  effectiveValuesRef.current = effectiveValues;
  const [debouncedValues] = useDebouncedValue(effectiveValues, { wait: 250 });

  const { get: getData, query: widgetDataQuery } = useReportDashboardWidgetData(
    embedToken ? undefined : dashboardId,
    widgets,
    debouncedValues,
    { widgetQueries, mode: 'published' },
  );
  const embedDataQuery = useReportEmbedData(embedToken, debouncedValues, widgetQueries, !!embedToken && !!dashboard);

  const initializedDashboardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dashboard) return;
    const sourceKey = embedToken ? `token:${embedToken}` : `dashboard:${dashboardId ?? ''}`;
    const key = `${sourceKey}:${controlled ? 'controlled' : 'uncontrolled'}`;
    if (initializedDashboardRef.current === key) return;
    initializedDashboardRef.current = key;
    if (!controlled) {
      effectiveValuesRef.current = defaults;
      setInnerValues(defaults);
    }
    resetWidgetQueries();
  }, [controlled, dashboard, dashboardId, defaults, embedToken, resetWidgetQueries]);

  useEffect(() => {
    resetWidgetQueries();
  }, [effectiveValues, resetWidgetQueries]);

  const setProgrammaticFilter = useCallback((filterId: string, value: ReportEmbedFilterValue): boolean => {
    if (effectiveReadOnly || controlled || !filters.some((filter) => filter.id === filterId)) return false;
    const next = { ...effectiveValuesRef.current, [filterId]: value };
    effectiveValuesRef.current = next;
    setInnerValues(next);
    resetWidgetQueries();
    return true;
  }, [controlled, effectiveReadOnly, filters, resetWidgetQueries]);

  const setProgrammaticFilters = useCallback((values: ReportEmbedFilterValues) => {
    if (effectiveReadOnly || controlled) return;
    const allowedIds = new Set(filters.map((filter) => filter.id));
    const next = {
      ...effectiveValuesRef.current,
      ...sanitizeReportEmbedFilterValues(values, allowedIds),
    };
    effectiveValuesRef.current = next;
    setInnerValues(next);
    resetWidgetQueries();
  }, [controlled, effectiveReadOnly, filters, resetWidgetQueries]);

  const resetProgrammaticFilters = useCallback((): boolean => {
    if (effectiveReadOnly || controlled) return false;
    effectiveValuesRef.current = defaults;
    setInnerValues(defaults);
    resetWidgetQueries();
    return true;
  }, [controlled, defaults, effectiveReadOnly, resetWidgetQueries]);

  const refresh = useCallback(async () => {
    await dashboardQuery.refetch();
    if (embedToken) await embedDataQuery.refetch();
    else await widgetDataQuery.refetch();
  }, [dashboardQuery, embedDataQuery, embedToken, widgetDataQuery]);

  const exportPng = useCallback(() => exportDashboardPng(rootRef.current), []);

  const getState = useCallback((): ReportEmbedState => ({
    ...(dashboardId ? { dashboardId } : {}),
    ...(dashboard?.name ? { dashboardName: dashboard.name } : {}),
    loaded: !!dashboard,
    loading: dashboardQuery.isLoading || dashboardQuery.isFetching,
    error: dashboardQuery.error instanceof Error ? dashboardQuery.error.message : null,
    readOnly: effectiveReadOnly,
    filterValues: sanitizeReportEmbedFilterValues(
      effectiveValuesRef.current,
      new Set(filters.map((filter) => filter.id)),
    ),
  }), [dashboard, dashboardId, dashboardQuery.error, dashboardQuery.isFetching, dashboardQuery.isLoading, effectiveReadOnly, filters]);

  const bridge = useReportEmbedBridge({
    allowedOrigins: configuredOrigins,
    getFilterIds: () => filters.map((filter) => filter.id),
    getReadOnly: () => effectiveReadOnly,
    setFilter: setProgrammaticFilter,
    setFilters: setProgrammaticFilters,
    resetFilters: resetProgrammaticFilters,
    refresh,
    getState,
    exportPng,
  });

  useImperativeHandle(ref, () => ({
    refresh,
    setFilter: setProgrammaticFilter,
    resetFilters: resetProgrammaticFilters,
    getState,
    exportPng,
  }), [exportPng, getState, refresh, resetProgrammaticFilters, setProgrammaticFilter]);

  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dashboard) return;
    const key = `${dashboardId ?? 'token'}:${embedToken ?? ''}:${dashboard.name}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    const state = getState();
    onLoad?.(state);
    bridge.emit('loaded', state);
  }, [bridge, dashboard, dashboardId, embedToken, getState, onLoad]);

  const lastErrorRef = useRef<string | null>(null);
  const queryError = dashboardQuery.error ?? embedDataQuery.error ?? widgetDataQuery.error;
  useEffect(() => {
    if (!queryError) {
      lastErrorRef.current = null;
      return;
    }
    const error = queryError instanceof Error ? queryError : new Error('仪表盘加载失败');
    if (lastErrorRef.current === error.message) return;
    lastErrorRef.current = error.message;
    onError?.(error);
    bridge.emit('error', { message: error.message });
  }, [bridge, onError, queryError]);

  const applyUserFilters = useCallback((next: Record<string, unknown>, filterId?: string) => {
    if (effectiveReadOnly) return;
    if (!controlled) {
      effectiveValuesRef.current = next;
      setInnerValues(next);
    }
    resetWidgetQueries();
    const allowedIds = new Set(filters.map((filter) => filter.id));
    const payload: ReportEmbedFilterChangePayload = {
      ...(filterId ? { filterId, value: safeFilterValue(next[filterId]) } : {}),
      filterValues: sanitizeReportEmbedFilterValues(next, allowedIds),
    };
    onFilterChange?.(payload);
    bridge.emit('filterChanged', payload);
  }, [bridge, controlled, effectiveReadOnly, filters, onFilterChange, resetWidgetQueries]);

  const handleUserFilter = useCallback((filterId: string, value: unknown) => {
    applyUserFilters({ ...effectiveValuesRef.current, [filterId]: value }, filterId);
  }, [applyUserFilters]);

  const handleWidgetClick = useCallback((widget: ReportWidget) => {
    const payload = widgetClickPayload(widget);
    onWidgetClick?.(payload);
    bridge.emit('widgetClicked', payload);
  }, [bridge, onWidgetClick]);

  const handleCategoryClick = useCallback((widget: ReportWidget, value: string) => {
    const selected = {
      field: widget.options?.categoryField,
      value: safeFilterValue(value),
    };
    if (widget.interaction?.enabled && widget.interaction.setFilterId && !effectiveReadOnly) {
      const filterId = widget.interaction.setFilterId;
      applyUserFilters({ ...effectiveValuesRef.current, [filterId]: value }, filterId);
    }
    const payload = drilldownPayload(widget, selected);
    if (!payload) return;
    onDrilldown?.(payload);
    bridge.emit('drilldown', payload);
    if (interceptDrilldown) return;
    if (payload.drilldownType === 'url') {
      openDrilldownUrl(widget, value);
    } else if (payload.drilldownType === 'dashboard' && payload.targetDashboardId) {
      const query = payload.paramName
        ? `?${encodeURIComponent(payload.paramName)}=${encodeURIComponent(value)}`
        : '';
      window.open(
        `/report/dashboards/${payload.targetDashboardId}/view${query}`,
        '_blank',
        'noopener,noreferrer',
      );
    }
  }, [applyUserFilters, bridge, effectiveReadOnly, interceptDrilldown, onDrilldown]);

  async function downloadPng() {
    try {
      downloadDataUrl(await exportPng(), `${dashboard?.name ?? 'dashboard'}.png`);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('导出失败'));
    }
  }

  if (dashboardQuery.isLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 40, ...style }} className={className}><Spin /></div>;
  }
  if (!dashboard) {
    return <Empty description="仪表盘不存在或无权访问" style={{ padding: 40, ...style }} />;
  }

  const filterControl = showFilters ? (
    <FilterBar
      compact={isMobile}
      filters={filters}
      values={effectiveValues}
      resetValues={defaults}
      dynamicOptions={filterOptions}
      disableDynamicOptions={!!embedToken}
      disabled={effectiveReadOnly}
      onChange={handleUserFilter}
      onApply={(values) => applyUserFilters(values)}
    />
  ) : null;

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ height, overflow: height ? 'auto' : undefined, ...style }}
      data-report-embed=""
    >
      {isMobile ? (
        <MobileDashboardHeader
          title={dashboard.name}
          dark={dashboard.config?.theme === 'dark'}
          filter={filterControl}
          actions={dashboardMobileActions(() => void refresh(), () => void downloadPng())}
        />
      ) : filterControl}
      <DashboardCanvasView
        dashboard={dashboard}
        isMobile={isMobile}
        filterValues={effectiveValues}
        getWidgetState={embedToken ? widgetStateFromDataMap(embedDataQuery.data, embedDataQuery.isFetching) : getData}
        getWidgetQuery={(widget) => widgetQueries[widget.i]}
        onWidgetQueryChange={effectiveReadOnly ? undefined : handleWidgetQueryChange}
        onCategoryClick={handleCategoryClick}
        onWidgetClick={handleWidgetClick}
        emptyStyle={{ padding: 40 }}
      />
    </div>
  );
});

ReportEmbed.displayName = 'ReportEmbed';

export default ReportEmbed;
