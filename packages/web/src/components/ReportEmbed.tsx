import { useEffect, useMemo, useState } from 'react';
import { Spin, Empty } from '@douyinfe/semi-ui';
import '@/pages/report/report-grid.css';
import '@/pages/report/report-screen.css';
import { request } from '@/utils/request';
import { ScreenCanvas } from '@/pages/report/widgets/ScreenCanvas';
import { useWidgetData } from '@/pages/report/widgets/useWidgetData';
import { FilterBar } from '@/pages/report/widgets/FilterBar';
import type { ReportDashboard, ReportWidget, ReportFilter, ReportGridItem, ReportCanvasItem } from '@zenith/shared';

function defaultFilterValue(f: ReportFilter): unknown {
  if (f.defaultValue !== undefined) return f.defaultValue;
  return f.type === 'multiSelect' ? [] : undefined;
}

export interface ReportEmbedProps {
  /** 要嵌入的仪表盘 ID */
  dashboardId: number;
  /** 外部传入的筛选器值覆盖（按 filterId），用于把宿主模块的上下文注入报表 */
  filterValues?: Record<string, unknown>;
  /** 是否显示内置筛选器栏（默认隐藏，由宿主控制）*/
  showFilters?: boolean;
  /** 容器高度（默认自适应内容）*/
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 报表嵌入组件 —— 供项目其它模块一行接入某个仪表盘（只读）。
 *
 * @example
 * <ReportEmbed dashboardId={5} filterValues={{ f_dept: deptId }} height={420} />
 */
export function ReportEmbed({ dashboardId, filterValues: external, showFilters, height, className, style }: Readonly<ReportEmbedProps>) {
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<ReportDashboard | null>(null);
  const [innerValues, setInnerValues] = useState<Record<string, unknown>>({});

  const widgets = useMemo(() => dashboard?.widgets ?? [], [dashboard]);
  const filters = dashboard?.filters ?? [];
  const isCanvas = dashboard?.config?.layoutMode === 'canvas';
  const screen = dashboard?.config?.screenConfig;
  const aspect = isCanvas ? `${screen?.width || 1920} / ${screen?.height || 1080}` : undefined;

  // 宿主传入的 external 覆盖内部值
  const effectiveValues = useMemo(() => ({ ...innerValues, ...(external ?? {}) }), [innerValues, external]);
  const { get: getData } = useWidgetData(widgets, effectiveValues);

  useEffect(() => {
    if (!dashboardId) return;
    setLoading(true);
    request.get<ReportDashboard>(`/api/report/dashboards/${dashboardId}`, { silent: true }).then((res) => {
      if (res.code === 0) {
        setDashboard(res.data);
        const fv: Record<string, unknown> = {};
        for (const f of res.data.filters ?? []) fv[f.id] = defaultFilterValue(f);
        setInnerValues(fv);
      }
    }).finally(() => setLoading(false));
  }, [dashboardId]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40, ...style }} className={className}><Spin /></div>;
  if (!dashboard) return <Empty description="仪表盘不存在或无权访问" style={{ padding: 40, ...style }} />;

  return (
    <div className={className} style={{ height, overflow: height ? 'auto' : undefined, ...style }}>
      {showFilters && <FilterBar filters={filters} values={effectiveValues} onChange={(fid, val) => setInnerValues((p) => ({ ...p, [fid]: val }))} />}
      {widgets.length === 0 ? (
        <Empty description="该仪表盘还没有组件" style={{ padding: 40 }} />
      ) : (
        <div style={isCanvas ? { width: '100%', aspectRatio: aspect } : undefined}>
          <ScreenCanvas
            widgets={widgets}
            layout={(dashboard?.layout ?? []) as ReportGridItem[]}
            canvasLayout={(dashboard?.canvasLayout ?? []) as ReportCanvasItem[]}
            config={dashboard?.config ?? {}}
            filterValues={effectiveValues}
            getWidgetState={(w: ReportWidget) => getData(w)}
          />
        </div>
      )}
    </div>
  );
}

export default ReportEmbed;
