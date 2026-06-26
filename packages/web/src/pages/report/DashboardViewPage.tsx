import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Spin, Toast, Empty } from '@douyinfe/semi-ui';
import { ArrowLeft, RotateCcw, PencilRuler, Maximize, Image } from 'lucide-react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import { toPng } from 'html-to-image';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './report-grid.css';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { WidgetRenderer } from './widgets/WidgetRenderer';
import { useWidgetData } from './widgets/useWidgetData';
import { FilterBar } from './widgets/FilterBar';
import type { ReportDashboard, ReportWidget, ReportFilter } from '@zenith/shared';

const GridLayout = WidthProvider(RGL);

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

  const widgets = useMemo(() => dashboard?.widgets ?? [], [dashboard]);
  const layout = (dashboard?.layout ?? []) as Layout;
  const filters = dashboard?.filters ?? [];
  const isDark = dashboard?.config?.theme === 'dark';

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

  return (
    <div className="report-view" ref={rootRef} style={isDark ? { background: '#0b1020' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={() => navigate('/report/dashboards')}>返回</Button>
        <span className="report-view__title" style={{ margin: 0, color: isDark ? '#fff' : undefined }}>{dashboard?.name ?? '仪表盘'}</span>
        <div style={{ flex: 1 }} />
        <Button icon={<RotateCcw size={16} />} onClick={() => refresh()}>刷新</Button>
        <Button icon={<Image size={16} />} loading={exporting} onClick={handleExportPng}>图片</Button>
        <Button icon={<Maximize size={16} />} onClick={toggleFullscreen}>全屏</Button>
        {hasPermission('report:dashboard:update') && (
          <Button icon={<PencilRuler size={16} />} onClick={() => navigate(`/report/dashboards/${dashboardId}/design`)}>编辑</Button>
        )}
      </div>

      <div ref={exportRef}>
      <FilterBar filters={filters} values={filterValues} onChange={(fid, val) => setFilterValues((p) => ({ ...p, [fid]: val }))} />

      {widgets.length === 0 ? (
        <Empty description="该仪表盘还没有组件" style={{ paddingTop: 80 }} />
      ) : (
        <GridLayout className="report-grid" layout={layout} cols={12} rowHeight={40} margin={[12, 12]} isDraggable={false} isResizable={false} compactType="vertical">
          {widgets.map((w: ReportWidget) => {
            const ds = getData(w);
            const clickable = w.interaction?.enabled || w.drilldown?.enabled;
            return (
              <div key={w.i}>
                <div className="report-widget-card">
                  <div className="report-widget-card__header">
                    <span className="report-widget-card__title">{w.title || '未命名组件'}</span>
                  </div>
                  <div className="report-widget-card__body">
                    <WidgetRenderer widget={w} data={ds.data} loading={ds.loading} error={ds.error} filterValues={filterValues}
                      onCategoryClick={clickable ? (v) => handleCategoryClick(w, v) : undefined} />
                  </div>
                </div>
              </div>
            );
          })}
        </GridLayout>
      )}
      </div>
    </div>
  );
}
