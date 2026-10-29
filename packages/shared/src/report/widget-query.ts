import type { ReportWidget } from './contracts/dashboards';
import type { ReportDatasetQueryOptions } from './validation';

/** Table pagination starts with the widget configuration, before any user override exists. */
export function resolveReportWidgetQuery(
  widget: ReportWidget,
  limit: number | undefined,
  widgetQueries: Record<string, ReportDatasetQueryOptions> | undefined,
): ReportDatasetQueryOptions {
  const override = widgetQueries?.[widget.i] ?? {};
  if (widget.type !== 'table') return { limit: override.limit ?? limit };
  const configuredSize = widget.options?.pageSize;
  const pageSize = override.pageSize ?? (typeof configuredSize === 'number' && configuredSize > 0 ? configuredSize : undefined);
  return {
    ...(pageSize !== undefined ? { page: override.page ?? 1, pageSize: Math.min(500, Math.max(1, Math.floor(pageSize))) } : { limit: override.limit ?? limit }),
    sortField: override.sortField,
    sortOrder: override.sortOrder,
  };
}
