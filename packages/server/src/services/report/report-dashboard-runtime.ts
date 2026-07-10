import ipRangeCheck from 'ip-range-check';
import type {
  ReportDashboard,
  ReportDashboardSnapshot,
  ReportDashboardVersionDiff,
  ReportDashboardVersionWidgetChange,
  ReportFilter,
  ReportWidget,
  ReportWidgetDataResult,
} from '@zenith/shared';

type SnapshotLike = Pick<ReportDashboard, 'name' | 'layout' | 'canvasLayout' | 'widgets' | 'filters' | 'config' | 'categoryId' | 'remark'>
  | ReportDashboardSnapshot;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stable(val)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildDashboardSnapshot(source: SnapshotLike): ReportDashboardSnapshot {
  return {
    name: source.name,
    layout: [...(source.layout ?? [])],
    canvasLayout: [...(source.canvasLayout ?? [])],
    widgets: [...(source.widgets ?? [])],
    filters: [...(source.filters ?? [])],
    config: { ...(source.config ?? {}) },
    categoryId: source.categoryId ?? null,
    remark: source.remark ?? null,
  };
}

function widgetSummary(widget: ReportWidget): ReportDashboardVersionWidgetChange {
  return {
    id: widget.i,
    title: widget.title || widget.i,
    type: widget.type,
  };
}

export function compareDashboardSnapshots(
  left: ReportDashboardSnapshot,
  right: ReportDashboardSnapshot,
  labels?: { leftLabel?: string; rightLabel?: string },
): ReportDashboardVersionDiff {
  const leftWidgets = new Map((left.widgets ?? []).map((widget) => [widget.i, widget]));
  const rightWidgets = new Map((right.widgets ?? []).map((widget) => [widget.i, widget]));
  const added: ReportDashboardVersionWidgetChange[] = [];
  const removed: ReportDashboardVersionWidgetChange[] = [];
  const modified: ReportDashboardVersionWidgetChange[] = [];

  for (const [id, widget] of rightWidgets) {
    const prev = leftWidgets.get(id);
    if (!prev) {
      added.push(widgetSummary(widget));
      continue;
    }
    const changedFields = ['title', 'type', 'datasetId', 'options', 'paramBindings', 'interaction', 'drilldown', 'style', 'page']
      .filter((field) => stable((prev as unknown as Record<string, unknown>)[field]) !== stable((widget as unknown as Record<string, unknown>)[field]));
    if (changedFields.length > 0) {
      modified.push({ ...widgetSummary(widget), changedFields });
    }
  }
  for (const [id, widget] of leftWidgets) {
    if (!rightWidgets.has(id)) removed.push(widgetSummary(widget));
  }

  const layoutChanged = stable(left.layout ?? []) !== stable(right.layout ?? [])
    || stable(left.canvasLayout ?? []) !== stable(right.canvasLayout ?? []);
  const filtersChanged = stable(left.filters ?? []) !== stable(right.filters ?? []);
  const configChanged = stable(left.config ?? {}) !== stable(right.config ?? {});
  const metadataChanged = stable({
    name: left.name,
    categoryId: left.categoryId ?? null,
    remark: left.remark ?? null,
  }) !== stable({
    name: right.name,
    categoryId: right.categoryId ?? null,
    remark: right.remark ?? null,
  });

  const summary: string[] = [];
  if (added.length > 0) summary.push(`新增组件 ${added.length} 个`);
  if (removed.length > 0) summary.push(`删除组件 ${removed.length} 个`);
  if (modified.length > 0) summary.push(`修改组件 ${modified.length} 个`);
  if (layoutChanged) summary.push('布局发生变化');
  if (filtersChanged) summary.push('筛选器发生变化');
  if (configChanged) summary.push('全局配置发生变化');
  if (metadataChanged) summary.push('名称/分类/备注发生变化');
  if (summary.length === 0) summary.push('两个版本无差异');

  return {
    leftLabel: labels?.leftLabel ?? '左侧版本',
    rightLabel: labels?.rightLabel ?? '右侧版本',
    summary,
    widgets: { added, removed, modified },
    layoutChanged,
    filtersChanged,
    configChanged,
    metadataChanged,
  };
}

export function sanitizePublicFilterOptions(
  filters: ReportFilter[],
  data: Record<string, ReportWidgetDataResult>,
): Record<string, Array<{ value: string; label: string }>> {
  const out: Record<string, Array<{ value: string; label: string }>> = {};
  for (const filter of filters) {
    const source = filter.optionSource;
    if ((filter.type !== 'select' && filter.type !== 'multiSelect') || source?.kind !== 'dataset' || !source.datasetId) continue;
    const entry = data[filter.id];
    const result = entry?.data;
    if (!result) {
      out[filter.id] = [];
      continue;
    }
    const valueField = source.valueField || result.columns[0];
    const labelField = source.labelField || valueField;
    out[filter.id] = result.rows
      .map((row) => ({
        value: String(row[valueField] ?? ''),
        label: String(row[labelField] ?? row[valueField] ?? ''),
      }))
      .filter((option) => option.value !== '');
  }
  return out;
}

export function ensureAccessAllowedByIp(
  clientIp: string,
  allowedIps: string[],
  allowedCidrs: string[],
): boolean {
  if (allowedIps.length === 0 && allowedCidrs.length === 0) return true;
  if (allowedIps.includes(clientIp)) return true;
  return allowedCidrs.some((cidr) => {
    try {
      return ipRangeCheck(clientIp, cidr);
    } catch {
      return false;
    }
  });
}

export function applyEmbedFilterScope(
  requestedFilters: Record<string, unknown>,
  scope: { allowedFilterIds: string[]; fixedFilters: Record<string, unknown> },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const allow = new Set(scope.allowedFilterIds);
  for (const [key, value] of Object.entries(requestedFilters ?? {})) {
    if (allow.has(key)) out[key] = value;
  }
  return { ...out, ...scope.fixedFilters };
}
