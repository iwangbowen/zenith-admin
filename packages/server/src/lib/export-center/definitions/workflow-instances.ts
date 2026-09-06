import {
  countWorkflowInstancesForExport,
  getWorkflowInstancesForExport,
  type WorkflowInstanceExportQuery,
} from '../../../services/workflow/workflow-analytics.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'serialNo', header: '业务编号', width: 20 },
  { key: 'title', header: '申请标题', width: 30 },
  { key: 'definitionName', header: '流程', width: 22 },
  { key: 'categoryName', header: '分类', width: 14 },
  { key: 'initiatorName', header: '发起人', width: 14 },
  { key: 'status', header: '状态', width: 10 },
  { key: 'createdAt', header: '发起时间', width: 20 },
  { key: 'updatedAt', header: '最后更新', width: 20 },
];

export const workflowInstancesExportDefinition = defineExport<WorkflowInstanceExportQuery & Record<string, unknown>, Record<string, unknown>>({
  entity: 'workflow.instances',
  moduleName: '流程实例',
  filenamePrefix: '流程实例',
  sourcePath: '/workflow/monitor',
  sheetName: '流程实例',
  formats: ['xlsx'],
  permissions: { export: 'workflow:instance:monitor' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: (query) => countWorkflowInstancesForExport(query),
  streamRows: (query) => getWorkflowInstancesForExport(query),
});
