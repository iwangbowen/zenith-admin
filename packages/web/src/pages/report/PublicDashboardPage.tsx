import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, Input, Spin, Empty, Toast } from '@douyinfe/semi-ui';
import { Lock } from 'lucide-react';
import './report-grid.css';
import './report-screen.css';
import { ScreenCanvas } from './widgets/ScreenCanvas';
import { FilterBar } from './widgets/FilterBar';
import { filterValuesFromSearch, withFilterParam } from './widgets/filter-url';
import type { ReportWidget, ReportFilter, ReportGridItem, ReportCanvasItem, ReportDatasetQueryOptions, ReportPublicDashboard } from '@zenith/shared';
import { usePublicReportDashboard, usePublicReportDashboardAccess, usePublicReportDashboardData } from '@/hooks/queries/report-dashboards';

function defaultFilterValue(f: ReportFilter): unknown {
  if (f.defaultValue !== undefined) return f.defaultValue;
  return f.type === 'multiSelect' ? [] : undefined;
}

export default function PublicDashboardPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [needPwd, setNeedPwd] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const [debouncedFilterValues, setDebouncedFilterValues] = useState<Record<string, unknown>>({});
  const [widgetQueries, setWidgetQueries] = useState<Record<string, ReportDatasetQueryOptions>>({});
  const [sessionToken, setSessionToken] = useState<string | undefined>(undefined);
  const [bootstrapDashboard, setBootstrapDashboard] = useState<ReportPublicDashboard | null>(null);

  const accessMutation = usePublicReportDashboardAccess();
  const dashboardQuery = usePublicReportDashboard(token, sessionToken, !!sessionToken);
  const dashboard = dashboardQuery.data ?? bootstrapDashboard;
  const dataQuery = usePublicReportDashboardData(token, sessionToken, debouncedFilterValues, widgetQueries, !!dashboard && !!sessionToken);
  const dataMap = dataQuery.data ?? {};

  useEffect(() => {
    if (!dashboard) return;
    setNeedPwd(false);
    setError(null);
    setFilterValues(filterValuesFromSearch(dashboard.filters ?? [], searchParams, defaultFilterValue));
    setWidgetQueries({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams 为初始化时的闭包快照，回写不重置
  }, [dashboard, sessionToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilterValues(filterValues), 250);
    return () => window.clearTimeout(timer);
  }, [filterValues]);

  const load = useCallback(async (pwd?: string) => {
    if (!token) return;
    try {
      const res = await accessMutation.mutateAsync({ token, password: pwd });
      if (res.code === 0 && res.data) {
        setSessionToken(res.data.accessSessionToken);
        setBootstrapDashboard(res.data.dashboard);
        setNeedPwd(false);
        setError(null);
        return;
      }
      setSessionToken(undefined);
      setBootstrapDashboard(null);
      if (res.code === 401) {
        setNeedPwd(true);
        Toast.error('访问密码错误');
        return;
      }
      setError(res.message || '链接不存在或已失效');
    } catch (err) {
      setError(err instanceof Error ? err.message : '链接不存在或已失效');
    }
  }, [accessMutation, token]);

  useEffect(() => {
    if (!token || sessionToken || accessMutation.isPending || dashboard || needPwd || error) return;
    void load();
  }, [accessMutation.isPending, dashboard, error, load, needPwd, sessionToken, token]);

  function onFilterChange(fid: string, val: unknown) {
    setFilterValues((p) => ({ ...p, [fid]: val }));
    setWidgetQueries({});
    setSearchParams((prev) => withFilterParam(prev, fid, val), { replace: true });
  }

  const handleWidgetQueryChange = useCallback((widgetId: string, next: ReportDatasetQueryOptions) => {
    setWidgetQueries((prev) => ({ ...prev, [widgetId]: next }));
  }, []);

  if ((dashboardQuery.isFetching || accessMutation.isPending) && !dashboard && !needPwd) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (error) return <div style={{ padding: 80 }}><Empty description={error} /></div>;

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
    <div className="report-view" style={{ minHeight: '100vh', ...(isDark ? { background: isCanvas ? '#060c1f' : '#0b1020' } : {}) }}>
      <div className="report-view__title" style={{ color: isDark ? '#eaf4ff' : undefined }}>{dashboard?.name ?? '报表'}</div>
      <FilterBar filters={dashboard?.filters ?? []} values={filterValues} onChange={onFilterChange} dynamicOptions={dashboard?.filterOptions ?? {}} />
      {widgets.length === 0 ? (
        <Empty description="该仪表盘还没有组件" style={{ paddingTop: 80 }} />
      ) : (
        <div style={isCanvas ? { width: '100%', aspectRatio: aspect, maxHeight: 'calc(100vh - 120px)' } : undefined}>
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
            onWidgetQueryChange={handleWidgetQueryChange}
          />
        </div>
      )}
    </div>
  );
}
