import { computeWorkflowDerivedValues } from '@zenith/shared/workflow';
import type { WorkflowInstanceFormSnapshot } from '@zenith/shared/workflow';

/**
 * 服务端权威派生值归一（公式 / `daysFromKey` 天数 / 明细行内公式与聚合）。
 *
 * 实例 `formData` 完全来自客户端提交，而分支条件、金额分级、摘要与打印都以它为准：
 * 客户端漏传公式字段会让分级条件静默不成立（漏审批），发起人改小金额则能绕过审批（越权）。
 * 因此凡是「写入实例表单」的入口都必须按表单快照重算派生值，而不是只在条件求值时兜底
 * ——否则展示值与判定值会不一致。
 *
 * 与前端 `initializeWorkflowFormValues` 的派生部分同源（shared 同一实现）。
 * 非设计器表单（custom / external）没有字段快照，原样返回。
 */
export function normalizeInstanceFormData(
  formSnapshot: WorkflowInstanceFormSnapshot | null | undefined,
  formData: Record<string, unknown>,
): Record<string, unknown> {
  if (formSnapshot?.formType !== 'designer' || !formSnapshot.fields?.length) return formData;
  return computeWorkflowDerivedValues(formSnapshot.fields, formData);
}
