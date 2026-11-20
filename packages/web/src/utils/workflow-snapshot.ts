import { collectReferencedFormFieldKeys, normalizeWorkflowFormSnapshot, type WorkflowCustomFormConfig, type WorkflowDefinition, type WorkflowDefinitionSnapshot, type WorkflowFlowData, type WorkflowFormField, type WorkflowFormSettings, type WorkflowFormType, type WorkflowInstance } from '@zenith/shared/workflow';

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

/** 查询参数上限（与服务端 workflowSelectableNextApproversQuery.formData 保持一致，留一点余量） */
const PENDING_FORM_DATA_LIMIT = 7000;

/**
 * 收集「会参与分支条件求值」的待提交表单值，供「下一节点自选审批人」查询使用：
 * 只保留流程里条件规则引用到的字段，避免把整张表单塞进 URL；超长时退化为不传（服务端按已保存值计算）。
 * 服务端仍会按当前节点字段权限过滤，这里只做请求体量控制。
 */
export function pickPendingConditionValues(
  flowData: WorkflowFlowData | null | undefined,
  values: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!flowData || !values) return undefined;
  const referenced = collectReferencedFormFieldKeys(flowData);
  const picked: Record<string, unknown> = {};
  for (const key of referenced) {
    if (key in values) picked[key] = values[key];
  }
  if (Object.keys(picked).length === 0) return undefined;
  return JSON.stringify(picked).length <= PENDING_FORM_DATA_LIMIT ? picked : undefined;
}
