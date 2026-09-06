import { normalizeWorkflowFormSnapshot, type WorkflowCustomFormConfig, type WorkflowDefinition, type WorkflowDefinitionSnapshot, type WorkflowFlowData, type WorkflowFormField, type WorkflowFormSettings, type WorkflowFormType, type WorkflowInstance } from '@zenith/shared/workflow';

export { normalizeWorkflowFormSnapshot };

export type WorkflowDetailDefinition = WorkflowDefinition | WorkflowDefinitionSnapshot;

export function resolveWorkflowDetailDefinition(
  instance: WorkflowInstance | null | undefined,
  fallback?: WorkflowDefinition | null,
): WorkflowDetailDefinition | null {
  return instance?.definitionSnapshot ?? fallback ?? null;
}

export function resolveWorkflowFormType(
  instance: WorkflowInstance | null | undefined,
  definition?: WorkflowDetailDefinition | null,
): WorkflowFormType {
  const snapshot = normalizeWorkflowFormSnapshot(instance?.formSnapshot);
  return (instance?.definitionSnapshot?.formType ?? snapshot?.formType ?? definition?.formType ?? 'designer') as WorkflowFormType;
}

export function resolveWorkflowCustomForm(
  instance: WorkflowInstance | null | undefined,
  definition?: WorkflowDetailDefinition | null,
): WorkflowCustomFormConfig | null {
  const snapshot = normalizeWorkflowFormSnapshot(instance?.formSnapshot);
  return instance?.definitionSnapshot?.customForm ?? snapshot?.customForm ?? definition?.customForm ?? null;
}

export function resolveWorkflowFormFields(
  instance: WorkflowInstance | null | undefined,
  definition?: WorkflowDetailDefinition | null,
): WorkflowFormField[] {
  const snapshot = normalizeWorkflowFormSnapshot(instance?.formSnapshot);
  return snapshot?.fields ?? definition?.formFields ?? [];
}

export function resolveWorkflowFormSettings(
  instance: WorkflowInstance | null | undefined,
  definition?: WorkflowDetailDefinition | null,
): WorkflowFormSettings | null {
  const snapshot = normalizeWorkflowFormSnapshot(instance?.formSnapshot);
  return snapshot?.settings ?? definition?.formSettings ?? null;
}

export function resolveWorkflowFlowData(
  instance: WorkflowInstance | null | undefined,
  definition?: WorkflowDetailDefinition | null,
): WorkflowFlowData | null {
  return instance?.definitionSnapshot?.flowData ?? definition?.flowData ?? null;
}
