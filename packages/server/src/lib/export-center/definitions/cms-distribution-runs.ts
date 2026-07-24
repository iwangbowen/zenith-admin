import { loadCmsDistributionExportRows } from '../../../services/cms/cms-distributions.service';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

interface DistributionExportRow extends Record<string, unknown> {
  taskId: number;
  ruleId: number;
  ruleName: string;
  sourceSite: string;
  targetSite: string;
  trigger: string;
  sourceContentId: number | null;
  targetContentId: number | null;
  outcome: string;
  title: string;
  message: string;
  createdAt: string;
}

const columns: ExportColumn<DistributionExportRow>[] = [
  { key: 'taskId', header: '任务 ID', width: 12, type: 'number' },
  { key: 'ruleId', header: '规则 ID', width: 12, type: 'number' },
  { key: 'ruleName', header: '分发规则', width: 28 },
  { key: 'sourceSite', header: '来源站点', width: 24 },
  { key: 'targetSite', header: '目标站点', width: 24 },
  { key: 'trigger', header: '触发方式', width: 16 },
  { key: 'sourceContentId', header: '来源内容 ID', width: 14, type: 'number' },
  { key: 'targetContentId', header: '目标内容 ID', width: 14, type: 'number' },
  { key: 'outcome', header: '结果', width: 14 },
  { key: 'title', header: '内容标题', width: 36 },
  { key: 'message', header: '处理说明', width: 42 },
  { key: 'createdAt', header: '任务时间', width: 22, type: 'datetime' },
];

export const cmsDistributionRunsExportDefinition = defineExport<Record<string, unknown>, DistributionExportRow>({
  entity: 'cms.distribution-runs',
  moduleName: 'CMS内容管理',
  filenamePrefix: 'CMS内容分发结果',
  sourcePath: '/cms/distribution',
  sheetName: '分发明细',
  formats: ['xlsx', 'csv'],
  permissions: { export: 'cms:distribution:export' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 30, sensitiveDays: 30, rawDays: 30 },
  columns,
  countRows: async (query) => loadCmsDistributionExportRows(query).then((rows) => rows.length),
  streamRows: loadCmsDistributionExportRows,
});
