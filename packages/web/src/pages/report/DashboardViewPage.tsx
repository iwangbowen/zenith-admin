import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Spin, Toast, Empty } from '@douyinfe/semi-ui';
import { ArrowLeft, RotateCcw, PencilRuler } from 'lucide-react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './report-grid.css';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { WidgetRenderer } from './widgets/WidgetRenderer';
import { useDatasetDataMap } from './widgets/useDatasetData';
import type { ReportDashboard, ReportWidget } from '@zenith/shared';

const GridLayout = WidthProvider(RGL);

export default function DashboardViewPage() {
  const { id } = useParams<{ id: string }>();
  const dashboardId = Number(id);
  const navigate = useNavigate();
  const { hasPermission } = usePermission();

  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<ReportDashboard | null>(null);

  const widgets = dashboard?.widgets ?? [];
  const layout = (dashboard?.layout ?? []) as Layout;
  const datasetIds = useMemo(() => widgets.map((w) => w.datasetId ?? 0).filter((x) => x > 0), [widgets]);
  const { get: getData, refresh } = useDatasetDataMap(datasetIds);

  useEffect(() => {
    if (!dashboardId) return;
    setLoading(true);
    request.get<ReportDashboard>(`/api/report/dashboards/${dashboardId}`).then((res) => {
      if (res.code === 0) setDashboard(res.data);
      else Toast.error(res.message || '加载失败');
    }).finally(() => setLoading(false));
  }, [dashboardId]);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" /></div>;
  }

  return (
    <div className="report-view">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={() => navigate('/report/dashboards')}>返回</Button>
        <span className="report-view__title" style={{ margin: 0 }}>{dashboard?.name ?? '仪表盘'}</span>
        <div style={{ flex: 1 }} />
        <Button icon={<RotateCcw size={16} />} onClick={() => refresh()}>刷新数据</Button>
        {hasPermission('report:dashboard:update') && (
          <Button icon={<PencilRuler size={16} />} onClick={() => navigate(`/report/dashboards/${dashboardId}/design`)}>编辑</Button>
        )}
      </div>

      {widgets.length === 0 ? (
        <Empty description="该仪表盘还没有组件" style={{ paddingTop: 80 }} />
      ) : (
        <GridLayout
          className="report-grid"
          layout={layout}
          cols={12}
          rowHeight={40}
          margin={[12, 12]}
          isDraggable={false}
          isResizable={false}
          compactType="vertical"
        >
          {widgets.map((w: ReportWidget) => {
            const ds = getData(w.datasetId);
            return (
              <div key={w.i}>
                <div className="report-widget-card">
                  <div className="report-widget-card__header">
                    <span className="report-widget-card__title">{w.title || '未命名组件'}</span>
                  </div>
                  <div className="report-widget-card__body">
                    <WidgetRenderer widget={w} data={ds.data} loading={ds.loading} error={ds.error} />
                  </div>
                </div>
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
