import { SEED_WORKFLOW_FORMS } from '@zenith/shared';
import type { WorkflowForm } from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

function cloneSchema(schema: WorkflowForm['schema']): WorkflowForm['schema'] {
  return schema ? JSON.parse(JSON.stringify(schema)) as NonNullable<WorkflowForm['schema']> : null;
}

export const mockWorkflowForms: WorkflowForm[] = SEED_WORKFLOW_FORMS.map((form) => ({
  ...form,
  schema: cloneSchema(form.schema),
  usageCount: 0,
  createdAt: mockDateTime(form.createdAt),
  updatedAt: mockDateTime(form.updatedAt),
}));

let nextWorkflowFormId = Math.max(...mockWorkflowForms.map((f) => f.id)) + 1;

export function getNextWorkflowFormId() {
  return nextWorkflowFormId++;
}
