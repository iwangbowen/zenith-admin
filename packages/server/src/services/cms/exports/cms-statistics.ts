import { CMS_STAT_DIMENSION_LABELS, CMS_STAT_METRIC_LABELS, isCmsStatMetricAvailable, type CmsStatMetrics } from '@zenith/shared/cms';
import { ANALYTICS_DEVICE_TYPE_LABELS, type AnalyticsDeviceType } from '@zenith/shared/analytics';
import { prepareCmsStatisticsExportQuery, withCmsStatisticsExportSnapshot, type CmsStatisticsExportRow } from '../cms-stats-export-query';
import { defineExport } from '../../../lib/export-center/registry';
import { RETENTION_7_DAYS } from '../../../lib/export-center/presets';
import type { ExportColumn } from '../../../lib/export-center/types';

const columns: ExportColumn<CmsStatisticsExportRow>[] = [
  { key: 'label', header: '分组名称', width: 34, transform: (value, row) => row.dimension === 'device' ? ANALYTICS_DEVICE_TYPE_LABELS[row.key as AnalyticsDeviceType] ?? value : value },
  { key: 'key', header: '分组标识', width: 24 },
  ...Object.entries(CMS_STAT_METRIC_LABELS).map(([key, header]): ExportColumn<CmsStatisticsExportRow> => ({
    key: key as keyof CmsStatMetrics, header: `${header}${key.endsWith('Ms') ? '（毫秒）' : /Rate$|Depth$|^ctr$/u.test(key) ? '（%）' : ''}`, type: 'number', width: 20,
    transform: (value, row) => isCmsStatMetricAvailable(row, key as keyof CmsStatMetrics) ? value : null,
  })),
  { key: 'siteId', header: '站点 ID', type: 'number' },
  { key: 'dimension', header: '统计维度', enumMap: CMS_STAT_DIMENSION_LABELS },
  { key: 'timeZone', header: '统计时区', width: 22 },
  { key: 'startTime', header: '区间起点（UTC，含）', width: 28 },
  { key: 'endTime', header: '区间终点（UTC，不含）', width: 28 },
  { key: 'watermark', header: '采集截止点（UTC）', width: 28 },
  { key: 'reportVersion', header: '统计口径版本', width: 32 },
];

export const cmsStatisticsExportDefinition = defineExport<Record<string, unknown>, CmsStatisticsExportRow>({
  entity: 'cms.statistics', moduleName: 'CMS访问统计', filenamePrefix: 'CMS访问统计', sourcePath: '/cms/stats', sheetName: '访问统计',
  permissions: { export: 'cms:stat:view' }, formats: ['xlsx', 'csv'], columns,
  execution: { mode: 'async', syncMaxRows: 0, maxRows: 500_000, syncModeOverridesAsyncPolicies: false }, retention: RETENTION_7_DAYS,
  prepareQuery: prepareCmsStatisticsExportQuery,
  withSnapshot: (ctx, consume) => withCmsStatisticsExportSnapshot(ctx.query, consume),
  // Snapshot providers count inside the worker transaction, never during an HTTP submission.
  countRows: async () => 0,
  // 生成器只用于满足定义类型；统计报表的行必须由快照执行器读取，走到这里说明装配错了
  // eslint-disable-next-line require-yield -- 故意不在生成器里 yield，调用即报错
  streamRows: async function* () { throw new Error('统计报表必须在快照导出执行器中读取'); },
});
