/**
 * 仪表盘「查看态」运行时共享件：登录 / 嵌入（ReportEmbed）与公开链接（PublicDashboardPage）
 * 两条链路的数据源、筛选状态机与鉴权各不相同，但筛选默认值、图片导出、点击 / 下钻事件载荷、
 * 组件取数状态映射完全一致，统一收口在这里；画布渲染见 DashboardCanvasView。
 */
import { useCallback, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import type {
  ReportDashboardConfig,
  ReportDashboardData,
  ReportDatasetQueryOptions,
  ReportEmbedDrilldownPayload,
  ReportEmbedFilterValue,
  ReportEmbedWidgetClickPayload,
  ReportFilter,
  ReportWidget,
} from '@zenith/shared/report';
import { sanitizeReportEmbedFilterValues } from '@/components/report-embed-bridge';
import { openExternalUrl } from '@/utils/safe-url';
import type { WidgetState } from './ScreenCanvas';
import type { MobileDashboardAction } from './MobileDashboardHeader';

// ─── 筛选默认值 ───────────────────────────────────────────────────────────────

export function defaultFilterValue(filter: ReportFilter): unknown {
  if (filter.defaultValue !== undefined) return filter.defaultValue;
  return filter.type === 'multiSelect' ? [] : undefined;
}

export function defaultFilterValues(filters: readonly ReportFilter[]): Record<string, unknown> {
  return Object.fromEntries(filters.map((filter) => [filter.id, defaultFilterValue(filter)]));
}

/** 单个筛选值收窄为桥接协议允许的标量 / 数组，不可表示时退化为字符串 */
export function safeFilterValue(value: unknown): ReportEmbedFilterValue {
  const sanitized = sanitizeReportEmbedFilterValues({ value });
  return sanitized.value ?? String(value ?? '');
}

// ─── 组件级查询覆盖（排序 / 分页等） ────────────────────────────────────────────

export function useDashboardWidgetQueries() {
  const [widgetQueries, setWidgetQueries] = useState<Record<string, ReportDatasetQueryOptions>>({});
  const resetWidgetQueries = useCallback(() => setWidgetQueries({}), []);
  const handleWidgetQueryChange = useCallback((widgetId: string, next: ReportDatasetQueryOptions) => {
    setWidgetQueries((previous) => ({ ...previous, [widgetId]: next }));
  }, []);
  return { widgetQueries, resetWidgetQueries, handleWidgetQueryChange };
}

// ─── 图片导出 ─────────────────────────────────────────────────────────────────

/** 以根节点计算背景色导出 2x PNG（透明背景不强制填色） */
export async function exportDashboardPng(root: HTMLElement | null): Promise<string | null> {
  if (!root) return null;
  const backgroundColor = window.getComputedStyle(root).backgroundColor;
  return toPng(root, {
    backgroundColor: backgroundColor === 'rgba(0, 0, 0, 0)' ? undefined : backgroundColor,
    pixelRatio: 2,
    cacheBust: true,
  });
}

/** 触发浏览器下载；dataUrl 为空时静默返回。调用方自行处理导出异常 */
export function downloadDataUrl(dataUrl: string | null, filename: string) {
  if (!dataUrl) return;
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

export function dashboardMobileActions(refresh: () => void, downloadPng: () => void): MobileDashboardAction[] {
  return [
    { key: 'refresh', label: '刷新', icon: <RefreshCw size={15} />, onClick: refresh },
    { key: 'export', label: '导出图片', icon: <Download size={15} />, onClick: downloadPng },
  ];
}

// ─── 事件载荷 ─────────────────────────────────────────────────────────────────

export function widgetClickPayload(widget: ReportWidget): ReportEmbedWidgetClickPayload {
  return { widgetId: widget.i, widgetTitle: widget.title || widget.i, widgetType: widget.type };
}

/** 下钻已启用时返回载荷与类型，否则返回 null（调用方据此提前返回） */
export function drilldownPayload(
  widget: ReportWidget,
  selected: ReportEmbedDrilldownPayload['selected'],
): ReportEmbedDrilldownPayload | null {
  const drilldown = widget.drilldown;
  if (!drilldown?.enabled) return null;
  return {
    ...widgetClickPayload(widget),
    selected,
    drilldownType: drilldown.type ?? 'fields',
    ...(drilldown.targetDashboardId ? { targetDashboardId: drilldown.targetDashboardId } : {}),
    ...(drilldown.paramName ? { paramName: drilldown.paramName } : {}),
  };
}

/** URL 下钻：`{value}` 占位替换为编码后的分类值，经安全跳转打开 */
export function openDrilldownUrl(widget: ReportWidget, value: string) {
  const url = widget.drilldown?.url;
  if (!url) return;
  openExternalUrl(url.replace('{value}', encodeURIComponent(value)));
}

// ─── 取数状态与画布 ───────────────────────────────────────────────────────────

/** 批量取数结果（token 链路）映射为单组件状态 */
export function widgetStateFromDataMap(dataMap: ReportDashboardData | undefined, loading: boolean) {
  return (widget: ReportWidget): WidgetState => ({
    data: dataMap?.[widget.i]?.data ?? null,
    loading,
    error: dataMap?.[widget.i]?.error?.message ?? null,
  });
}

export function screenAspectRatio(config: ReportDashboardConfig | undefined): string | undefined {
  if (config?.layoutMode !== 'canvas') return undefined;
  const screen = config.screenConfig;
  return `${screen?.width || 1920} / ${screen?.height || 1080}`;
}
