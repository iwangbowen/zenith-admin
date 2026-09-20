import type { MaskType, SensitiveFieldRef } from '@zenith/shared/core';
import { flattenWorkflowPrintLeafFields, normalizeWorkflowFormSnapshot } from '@zenith/shared/workflow';
import type { DbExecutor } from '../../db/types';
import { currentUser, hasPermission } from '../../lib/context';
import { resolveMaskDecisions } from '../../lib/data-mask/policies';
import { registerSensitiveSource } from '../../lib/data-mask/registry';
import { hiddenWorkflowFieldKeys, type WorkflowFormViewerContext } from './workflow-form-access';

export const FORM_FIELD_MASK_KINDS: Record<string, { field: string; kind: MaskType; label: string }> = {
  phone: { field: 'phone', kind: 'phone', label: '审批表单·手机号' },
  email: { field: 'email', kind: 'email', label: '审批表单·邮箱' },
  idCard: { field: 'idCard', kind: 'id_card', label: '审批表单·证件号' },
};
export const WORKFLOW_FORM_SENSITIVE_REFS: readonly SensitiveFieldRef[] = Object.values(FORM_FIELD_MASK_KINDS).map((entry) => ({
  path: ['formData', entry.field], entity: 'WorkflowForm', field: entry.field, kind: entry.kind, label: entry.label,
}));
registerSensitiveSource('PRINT workflow_instance', WORKFLOW_FORM_SENSITIVE_REFS);

/** An immutable original contains all fields, so both node visibility and PII masking apply. */
export async function workflowArchiveNeedsRedaction(row: WorkflowFormViewerContext & { formSnapshot: unknown }, executor?: DbExecutor): Promise<boolean> {
  if (hiddenWorkflowFieldKeys(row, currentUser().userId).size > 0 && !(await hasPermission('workflow:instance:monitor'))) return true;
  const kinds = new Set<string>();
  const add = (type: string) => { const entry = FORM_FIELD_MASK_KINDS[type]; if (entry) kinds.add(entry.field); };
  for (const field of flattenWorkflowPrintLeafFields(normalizeWorkflowFormSnapshot(row.formSnapshot)?.fields ?? [])) {
    if (field.type === 'detail') for (const child of field.children ?? []) add(child.type);
    else add(field.type);
  }
  if (!kinds.size) return false;
  const decisions = await resolveMaskDecisions(WORKFLOW_FORM_SENSITIVE_REFS, executor);
  return decisions.some((decision) => kinds.has(decision.ref.field));
}
