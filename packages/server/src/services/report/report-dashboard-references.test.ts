import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportWidget } from '@zenith/shared/report';

/** 按表返回行；记录每次 select 命中的表，用来断言查询次数不随引用数增长 */
const runtime = vi.hoisted(() => ({
  rows: new Map<unknown, Array<{ id: number; tenantId: number | null }>>(),
  selectedTables: [] as unknown[],
}));

vi.mock('../../db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          runtime.selectedTables.push(table);
          return runtime.rows.get(table) ?? [];
        },
      }),
    }),
  },
}));
vi.mock('../../lib/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/context')>()),
  currentUserOrNull: vi.fn(() => ({ userId: 7 })),
}));
vi.mock('./report-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./report-access')>()),
  reportScopedWhere: vi.fn((_table: unknown, condition: unknown) => condition),
}));
vi.mock('./report-resource-acl.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./report-resource-acl.service')>()),
  filterReportResourceRowsByAccess: vi.fn(async (_type: unknown, rows: unknown[]) => rows),
}));

import { reportDashboards, reportDatasets, reportMetrics } from '../../db/schema';
import { currentUserOrNull } from '../../lib/context';
import { filterReportResourceRowsByAccess } from './report-resource-acl.service';
import { ensureDashboardReferences } from './report-dashboard.service';

const datasetWidget = (i: string, datasetId: number): ReportWidget => ({ i, type: 'bar', title: i, datasetId } as ReportWidget);
const metricWidget = (i: string, metricId: number): ReportWidget => ({ i, type: 'kpi', title: i, metricId } as ReportWidget);
const drilldownWidget = (i: string, datasetId: number, targetDashboardId: number): ReportWidget =>
  ({ i, type: 'table', title: i, datasetId, drilldown: { targetDashboardId } } as unknown as ReportWidget);

function stub(table: unknown, ids: number[], tenantId: number | null = null) {
  runtime.rows.set(table, ids.map((id) => ({ id, tenantId })));
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.rows.clear();
  runtime.selectedTables.length = 0;
  vi.mocked(currentUserOrNull).mockReturnValue({ userId: 7 } as ReturnType<typeof currentUserOrNull>);
});

describe('ensureDashboardReferences 批量校验', () => {
  it('issues one existence query and one access check per resource type, however many ids are referenced', async () => {
    const widgets = [
      ...[1, 2, 3, 4, 5].map((id) => datasetWidget(`d${id}`, id)),
      ...[11, 12, 13].map((id) => metricWidget(`m${id}`, id)),
      drilldownWidget('x1', 1, 101),
      drilldownWidget('x2', 2, 102),
    ];
    stub(reportDatasets, [1, 2, 3, 4, 5]);
    stub(reportMetrics, [11, 12, 13]);
    stub(reportDashboards, [101, 102]);

    await ensureDashboardReferences(widgets, [], null, 999, null);

    // 此前 5 + 3 + 2 = 10 组「行查询 + ACL 三路」并发打出；现在每类各一条 IN 查询
    expect(runtime.selectedTables).toHaveLength(3);
    expect(new Set(runtime.selectedTables)).toEqual(new Set([reportDatasets, reportMetrics, reportDashboards]));
    expect(filterReportResourceRowsByAccess).toHaveBeenCalledTimes(3);
    expect(vi.mocked(filterReportResourceRowsByAccess).mock.calls.map(([type, rows]) => [type, rows.length])).toEqual(
      expect.arrayContaining([['dataset', 5], ['metric', 3], ['dashboard', 2]]),
    );
  });

  it('skips resource types that are not referenced at all', async () => {
    stub(reportDatasets, [1]);

    await ensureDashboardReferences([datasetWidget('d1', 1)], [], null);

    expect(runtime.selectedTables).toEqual([reportDatasets]);
    expect(filterReportResourceRowsByAccess).toHaveBeenCalledTimes(1);
  });

  it('rejects with 404 when any referenced dataset is missing in scope', async () => {
    stub(reportDatasets, [1]);

    await expect(ensureDashboardReferences([datasetWidget('d1', 1), datasetWidget('d2', 2)], [], null))
      .rejects.toMatchObject({ status: 404, message: '数据集不存在' });
    expect(filterReportResourceRowsByAccess).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the access filter drops a referenced metric', async () => {
    stub(reportMetrics, [11, 12]);
    vi.mocked(filterReportResourceRowsByAccess).mockImplementationOnce(async (_type, rows) => rows.slice(0, 1));

    await expect(ensureDashboardReferences([metricWidget('m11', 11), metricWidget('m12', 12)], [], null))
      .rejects.toMatchObject({ status: 403, message: '无权访问该报表资源' });
  });

  it('still refuses cross-tenant references after the batched lookup', async () => {
    stub(reportDatasets, [1], 2);

    await expect(ensureDashboardReferences([datasetWidget('d1', 1)], [], null, undefined, 1))
      .rejects.toMatchObject({ status: 400, message: '仪表盘引用了其他租户的报表资源' });
  });

  it('skips the access check when there is no user context (cron / global evaluation)', async () => {
    vi.mocked(currentUserOrNull).mockReturnValue(null);
    stub(reportDatasets, [1]);

    await ensureDashboardReferences([datasetWidget('d1', 1)], [], null);

    expect(runtime.selectedTables).toEqual([reportDatasets]);
    expect(filterReportResourceRowsByAccess).not.toHaveBeenCalled();
  });
});
