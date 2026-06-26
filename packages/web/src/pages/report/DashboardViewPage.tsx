import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Spin, Toast, Empty } from '@douyinfe/semi-ui';
import { ArrowLeft, RotateCcw, PencilRuler, Maximize, Image } from 'lucide-react';
import { toPng } from 'html-to-image';
import './report-grid.css';
import './report-screen.css';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { ScreenCanvas } from './widgets/ScreenCanvas';
import { useWidgetData } from './widgets/useWidgetData';
import { FilterBar } from './widgets/FilterBar';
import type { ReportDashboard, ReportWidget, ReportFilter, ReportGridItem, ReportCanvasItem } from '@zenith/shared';

function defaultFilterValue(f: ReportFilter): unknown {
  if (f.defaultValue !== undefined) return f.defaultValue;
  return f.type === 'multiSelect' ? [] : undefined;
}

export default function DashboardViewPage() {
  const { id } = useParams<{ id: string }>();
  const dashboardId = Number(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission } = usePermission();

  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<ReportDashboard | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [isFs, setIsFs] = useState(false);

  const widgets = useMemo(() => dashboard?.widgets ?? [], [dashboard]);
  const filters = dashboard?.filters ?? [];
  const isDark = dashboard?.config?.theme === 'dark';
  const isCanvas = dashboard?.config?.layoutMode === 'canvas';
  const screen = dashboard?.config?.screenConfig;
  const aspect = isCanvas ? `${screen?.width || 1920} / ${screen?.height || 1080}` : undefined;

  const { get: getData, refresh } = useWidgetData(widgets, filterValues);

  useEffect(() => {
    if (!dashboardId) return;
    setLoading(true);
    request.get<ReportDashboard>(`/api/report/dashboards/${dashboardId}`).then((res) => {
      if (res.code === 0) {
        const fv: Record<string, unknown> = {};
        for (const f of res.data.filters ?? []) {
          const fromUrl = searchParams.get(f.id);
          fv[f.id] = fromUrl != null ? fromUrl : defaultFilterValue(f);
        }
        setDashboard(res.data);
        setFilterValues(fv);
      } else Toast.error(res.message || '加载失败');
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId]);

  // 自动刷新
  useEffect(() => {
    const sec = dashboard?.config?.refreshInterval ?? 0;
    if (!sec || sec <= 0) return;
    const t = setInterval(() => refresh(), sec * 1000);
    return () => clearInterval(t);
  }, [dashboard?.config?.refreshInterval, refresh]);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  function handleCategoryClick(w: ReportWidget, value: string) {
    if (w.interaction?.enabled && w.interaction.setFilterId) {
      setFilterValues((p) => ({ ...p, [w.interaction!.setFilterId as string]: value }));
    }
    if (w.drilldown?.enabled) {
      const dd = w.drilldown;
      if (dd.type === 'url' && dd.url) { window.open(dd.url.replace('{value}', encodeURIComponent(value)), '_blank'); }
      else if (dd.targetDashboardId) {
        const q = dd.paramName ? `?${encodeURIComponent(dd.paramName)}=${encodeURIComponent(value)}` : '';
        navigate(`/report/dashboards/${dd.targetDashboardId}/view${q}`);
      }
    }
  }

  function toggleFullscreen() {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  async function handleExportPng() {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(exportRef.current, { backgroundColor: isDark ? '#0b1020' : '#ffffff', pixelRatio: 2, cacheBust: true });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${dashboard?.name ?? 'dashboard'}.png`;
      a.click();
    } catch { Toast.error('导出失败，请重试'); } finally { setExporting(false); }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" /></div>;

  const canvasState = (w: ReportWidget) => getData(w);

  return (
    <div
      ref={rootRef}
      className={`report-screen-root${isCanvas ? '' : ' report-view'}`}
      style={isCanvas ? { background: isDark ? '#060c1f' : 'var(--semi-color-fill-0)' } : (isDark ? { background: '#0b1020' } : undefined)}
    >
      <div className={`report-screen-header${isDark ? ' report-screen-header--dark' : ''}`} style={isCanvas ? undefined : { padding: 0, marginBottom: 12 }}>
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={() => navigate('/report/dashboards')}>返回</Button>
        <span className="report-screen-header__title" style={{ margin: 0, color: isDark ? '#eaf4ff' : 'var(--semi-color-text-0)', fontSize: isCanvas ? 20 : 18 }}>{dashboard?.name ?? '仪表盘'}</span>
        <div style={{ flex: 1 }} />
        <Button icon={<RotateCcw size={16} />} onClick={() => refresh()}>刷新</Button>
        <Button icon={<Image size={16} />} loading={exporting} onClick={handleExportPng}>图片</Button>
        <Button icon={<Maximize size={16} />} onClick={toggleFullscreen}>全屏</Button>
        {hasPermission('report:dashboard:update') && (
          <Button icon={<PencilRuler size={16} />} onClick={() => navigate(`/report/dashboards/${dashboardId}/design`)}>编辑</Button>
        )}
      </div>

      <div ref={exportRef} style={isCanvas ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}>
        <div style={isCanvas ? { padding: '0 12px' } : undefined}>
          <FilterBar filters={filters} values={filterValues} onChange={(fid, val) => setFilterValues((p) => ({ ...p, [fid]: val }))} />
        </div>

        {widgets.length === 0 ? (
          <Empty description="该仪表盘还没有组件" style={{ paddingTop: 80 }} />
        ) : isCanvas ? (
          <div style={isFs ? { flex: 1, minHeight: 0 } : { width: '100%', aspectRatio: aspect, maxHeight: 'calc(100vh - 160px)' }}>
            <ScreenCanvas
              widgets={widgets}
              layout={(dashboard?.layout ?? []) as ReportGridItem[]}
              canvasLayout={(dashboard?.canvasLayout ?? []) as ReportCanvasItem[]}
              config={dashboard?.config ?? {}}
              filterValues={filterValues}
              getWidgetState={canvasState}
              onCategoryClick={handleCategoryClick}
            />
          </div>
        ) : (
          <ScreenCanvas
            widgets={widgets}
            layout={(dashboard?.layout ?? []) as ReportGridItem[]}
            canvasLayout={(dashboard?.canvasLayout ?? []) as ReportCanvasItem[]}
            config={dashboard?.config ?? {}}
            filterValues={filterValues}
            getWidgetState={canvasState}
            onCategoryClick={handleCategoryClick}
          />
        )}
      </div>
    </div>
  );
}
