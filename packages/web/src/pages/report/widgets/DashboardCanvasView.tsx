/**
 * 仪表盘查看态画布：空态 + 大屏等比容器 + ScreenCanvas，登录 / 嵌入与公开链接两条链路共用。
 */
import type { CSSProperties } from 'react';
import { Empty } from '@douyinfe/semi-ui';
import type { ReportCanvasItem, ReportDashboardConfig, ReportDatasetQueryOptions, ReportGridItem, ReportWidget } from '@zenith/shared/report';
import { ScreenCanvas, type WidgetState } from './ScreenCanvas';
import { screenAspectRatio } from './dashboard-runtime';

export interface DashboardCanvasViewProps {
  dashboard: {
    widgets?: ReportWidget[] | null;
    layout?: unknown;
    canvasLayout?: unknown;
    config?: ReportDashboardConfig | null;
  };
  isMobile: boolean;
  filterValues: Record<string, unknown>;
  getWidgetState: (widget: ReportWidget) => WidgetState;
  getWidgetQuery: (widget: ReportWidget) => ReportDatasetQueryOptions | undefined;
  onWidgetQueryChange?: (widgetId: string, next: ReportDatasetQueryOptions) => void;
  onCategoryClick: (widget: ReportWidget, value: string) => void;
  onWidgetClick: (widget: ReportWidget) => void;
  emptyStyle?: CSSProperties;
  /** 大屏模式桌面端外层容器的附加样式（已含 width / aspectRatio） */
  canvasStyle?: CSSProperties;
}

/** 空态 + 大屏等比容器 + ScreenCanvas，查看态两条链路共用 */
export function DashboardCanvasView({
  dashboard,
  isMobile,
  filterValues,
  getWidgetState,
  getWidgetQuery,
  onWidgetQueryChange,
  onCategoryClick,
  onWidgetClick,
  emptyStyle,
  canvasStyle,
}: Readonly<DashboardCanvasViewProps>) {
  const widgets = dashboard.widgets ?? [];
  const config = (dashboard.config ?? {}) as ReportDashboardConfig;
  const aspect = screenAspectRatio(config);
  if (widgets.length === 0) {
    return <Empty description="该仪表盘还没有组件" style={emptyStyle} />;
  }
  return (
    <div style={aspect && !isMobile ? { width: '100%', aspectRatio: aspect, ...canvasStyle } : undefined}>
      <ScreenCanvas
        widgets={widgets}
        layout={(dashboard.layout ?? []) as ReportGridItem[]}
        canvasLayout={(dashboard.canvasLayout ?? []) as ReportCanvasItem[]}
        config={config}
        filterValues={filterValues}
        getWidgetState={getWidgetState}
        getWidgetQuery={getWidgetQuery}
        onWidgetQueryChange={onWidgetQueryChange}
        onCategoryClick={onCategoryClick}
        onWidgetClick={onWidgetClick}
      />
    </div>
  );
}
