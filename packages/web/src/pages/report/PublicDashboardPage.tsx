import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Input, Spin, Empty, Toast } from '@douyinfe/semi-ui';
import { Lock } from 'lucide-react';
import './report-grid.css';
import './report-screen.css';
import { request } from '@/utils/request';
import { ScreenCanvas } from './widgets/ScreenCanvas';
import { FilterBar } from './widgets/FilterBar';
import type { ReportPublicDashboard, ReportWidget, ReportFilter, ReportDataResult, ReportGridItem, ReportCanvasItem } from '@zenith/shared';

function defaultFilterValue(f: ReportFilter): unknown {
  if (f.defaultValue !== undefined) return f.defaultValue;
  return f.type === 'multiSelect' ? [] : undefined;
}

export default function PublicDashboardPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [needPwd, setNeedPwd] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<ReportPublicDashboard | null>(null);
  const [dataMap, setDataMap] = useState<Record<string, ReportDataResult>>({});
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const pwdRef = useRef<string | undefined>(undefined);

  const fetchData = useCallback(async (filters: Record<string, unknown>) => {
    const res = await request.post<Record<string, ReportDataResult>>(`/api/report/public/dashboards/${token}/data`, { password: pwdRef.current, filters }, { skipAuth: true, silent: true });
    if (res.code === 0) setDataMap(res.data);
  }, [token]);

  const load = useCallback(async (pwd?: string) => {
    setLoading(true);
    const res = await request.post<ReportPublicDashboard>(`/api/report/public/dashboards/${token}`, { password: pwd }, { skipAuth: true, silent: true });
    setLoading(false);
    if (res.code === 0) {
      pwdRef.current = pwd;
      setNeedPwd(false);
      setDashboard(res.data);
      const fv: Record<string, unknown> = {};
      for (const f of res.data.filters ?? []) fv[f.id] = defaultFilterValue(f);
      setFilterValues(fv);
      void fetchData(fv);
    } else if (res.code === 401) {
      setNeedPwd(true);
      if (pwd) Toast.error('访问密码错误');
    } else {
      setError(res.message || '链接不存在或已失效');
    }
  }, [token, fetchData]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function onFilterChange(fid: string, val: unknown) {
    setFilterValues((p) => { const next = { ...p, [fid]: val }; void fetchData(next); return next; });
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (error) return <div style={{ padding: 80 }}><Empty description={error} /></div>;

  if (needPwd) {
    return (
      <div style={{ maxWidth: 320, margin: '120px auto', textAlign: 'center' }}>
        <Lock size={32} style={{ color: 'var(--semi-color-text-2)' }} />
        <div style={{ margin: '12px 0', color: 'var(--semi-color-text-1)' }}>该报表需要访问密码</div>
        <Input mode="password" placeholder="请输入密码" value={pwdInput} onChange={setPwdInput} onEnterPress={() => void load(pwdInput)} style={{ marginBottom: 12 }} />
        <Button type="primary" block onClick={() => void load(pwdInput)}>访问</Button>
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
      <FilterBar filters={dashboard?.filters ?? []} values={filterValues} onChange={onFilterChange} disableDynamicOptions />
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
            getWidgetState={(w: ReportWidget) => ({ data: dataMap[w.i] ?? null })}
          />
        </div>
      )}
    </div>
  );
}
