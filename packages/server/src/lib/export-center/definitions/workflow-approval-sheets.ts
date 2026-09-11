/**
 * 批量导出审批单 PDF（多份合并为一个文件，接入统一导出中心）。
 * 每份都走 renderWorkflowInstancePrintDocument：沿用查看者的访问控制、脱敏、模板绑定与水印，
 * 与单份打印结果一致；无权查看的实例按 403 中止整批，不产出残缺文件。
 */
import { workflowBatchPrintQuerySchema } from '@zenith/shared/workflow';
import type { WorkflowBatchPrintQueryInput } from '@zenith/shared/workflow';
import { renderWorkflowInstancesBatchPdf } from '../../../services/workflow/workflow-print.service';
import { defineExport } from '../registry';

function pickQuery(query: Record<string, unknown>): WorkflowBatchPrintQueryInput {
  const parsed = workflowBatchPrintQuerySchema.safeParse(query);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '导出参数不合法');
  return parsed.data;
}

export const workflowApprovalSheetsExportDefinition = defineExport<WorkflowBatchPrintQueryInput & Record<string, unknown>, Record<string, unknown>>({
  entity: 'workflow.approval-sheets',
  moduleName: '审批单',
  filenamePrefix: '审批单',
  sourcePath: '/workflow/applications',
  formats: ['pdf'],
  renderMode: 'custom',
  permissions: { export: 'workflow:instance:print' },
  // 一份审批单 = 一次完整渲染（表单 + 流转 + PDF）：少量同步返回，更多进后台任务
  execution: { mode: 'auto', syncMaxRows: 10, syncModeOverridesAsyncPolicies: false },
  columns: [],
  countRows: async (query) => pickQuery(query).instanceIds.length,
  streamRows: () => [],
  renderFile: async (ctx) => {
    const { instanceIds } = pickQuery(ctx.query);
    const { buffer, count } = await renderWorkflowInstancesBatchPdf(instanceIds);
    return { buffer, mimeType: 'application/pdf', rowCount: count, filename: `${ctx.moduleName}_${ctx.jobId}.pdf` };
  },
});
