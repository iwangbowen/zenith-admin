import type { ReportDashboardConfig, ReportDashboardSnapshot, ReportFilter, ReportGridItem, ReportWidget } from '@zenith/shared/report';
import type { ReportDashboardRow } from '../../db/schema';
import { buildDashboardSnapshot } from './report-dashboard-runtime';

export function draftSnapshotFromDashboardRow(row: ReportDashboardRow): ReportDashboardSnapshot {
  return buildDashboardSnapshot({
    name: row.name,
    layout: (row.layout ?? []) as ReportGridItem[],
    canvasLayout: (row.canvasLayout ?? []) as ReportDashboardSnapshot['canvasLayout'],
    widgets: (row.widgets ?? []) as ReportWidget[],
    filters: (row.filters ?? []) as ReportFilter[],
    config: (row.config ?? {}) as ReportDashboardConfig,
    categoryId: row.categoryId ?? null,
    remark: row.remark ?? null,
  });
}
