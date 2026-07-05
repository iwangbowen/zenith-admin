// ─── 实例/任务数据映射与定义快照辅助（拆分自 workflow-instances.service.ts）───
import { formatDateTime, formatNullableDateTime } from '../../../lib/datetime';
import { workflowInstances, workflowTasks, workflowDefinitions } from '../../../db/schema';
import type { WorkflowFlowData, WorkflowActionButtonKey, WorkflowActionButtonConfig, WorkflowFormField, WorkflowFormSettings, WorkflowCustomFormConfig, WorkflowFormType, WorkflowInstanceFormSnapshot } from '@zenith/shared';
import { type TaskAction } from '../../../lib/workflow-engine';
import { HTTPException } from 'hono/http-exception';

export function findExceptionCatchNode(flowData: WorkflowFlowData, nodeKey: string): TaskAction['nodeConfig'] | null {
  const source = flowData.nodes.find((n) => n.data.key === nodeKey);
  if (!source) return null;
  for (const edge of flowData.edges) {
    if (edge.source !== source.id) continue;
    const target = flowData.nodes.find((n) => n.id === edge.target);
    if (!target) continue;
    if (edge.isException || target.data.type === 'catchNode') return target.data;
  }
  return null;
}


export function mapTask(
  row: typeof workflowTasks.$inferSelect,
  assigneeName?: string | null,
  assigneeAvatar?: string | null,
  actionButtons?: Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>> | null,
  signatureRequired?: boolean,
) {
  return {
    id: row.id,
    instanceId: row.instanceId,
    nodeKey: row.nodeKey,
    nodeName: row.nodeName,
    nodeType: row.nodeType ?? null,
    assigneeId: row.assigneeId,
    assigneeName: assigneeName ?? null,
    assigneeAvatar: assigneeAvatar ?? null,
    status: row.status,
    comment: row.comment,
    signature: row.signature ?? null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    signatureRequired: signatureRequired ?? false,
    actionAt: formatNullableDateTime(row.actionAt),
    originalAssigneeId: row.originalAssigneeId ?? null,
    transferChain: Array.isArray(row.transferChain) ? row.transferChain : [],
    delegatedFromId: row.delegatedFromId ?? null,
    actionButtons: actionButtons ?? null,
    externalCallbackId: row.externalCallbackId ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export function mapInstance(
  row: typeof workflowInstances.$inferSelect,
  extras: {
    definitionName?: string | null;
    categoryId?: number | null;
    categoryName?: string | null;
    initiatorName?: string | null;
    initiatorAvatar?: string | null;
    currentNodeName?: string | null;
    currentNodeKeys?: string[];
    currentNodeNames?: string[];
    tasks?: ReturnType<typeof mapTask>[];
    childInstances?: Array<{ id: number; title: string; status: typeof workflowInstances.$inferSelect['status']; parentTaskNodeKey?: string | null; createdAt: string }>;
    comments?: import('@zenith/shared').WorkflowComment[];
    consults?: import('@zenith/shared').WorkflowTaskConsult[];
    myTaskStatus?: typeof workflowTasks.$inferSelect['status'] | null;
    myActionAt?: Date | string | null;
    ccTaskId?: number | null;
    ccReadAt?: Date | string | null;
    includeDefinitionSnapshot?: boolean;
  } = {},
) {
  const snapshotSettings = (row.definitionSnapshot as { flowData?: WorkflowFlowData } | null)?.flowData?.settings;
  const activeNodeKeys = extras.currentNodeKeys
    ?? [...new Set((extras.tasks ?? [])
      .filter((task) => task.status === 'pending' || task.status === 'waiting')
      .map((task) => task.nodeKey))];
  const currentNodeKeys = activeNodeKeys.length > 0 ? activeNodeKeys : (row.currentNodeKey ? [row.currentNodeKey] : []);
  const currentNodeNames = extras.currentNodeNames
    ?? currentNodeKeys
      .map((nodeKey) => resolveNodeNameFromSnapshot(row.definitionSnapshot, nodeKey))
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  const mapped = {
    id: row.id,
    definitionId: row.definitionId,
    definitionName: extras.definitionName ?? null,
    categoryId: extras.categoryId ?? null,
    categoryName: extras.categoryName ?? null,
    title: row.title,
    serialNo: row.serialNo ?? null,
    priority: (row.priority ?? 'normal') as import('@zenith/shared').WorkflowInstancePriority,
    allowWithdraw: snapshotSettings?.allowWithdraw !== false,
    allowResubmit: snapshotSettings?.allowResubmit !== false,
    allowComment: snapshotSettings?.allowComment !== false,
    formData: row.formData,
    formSnapshot: (row.formSnapshot ?? null) as WorkflowFormField[] | WorkflowInstanceFormSnapshot | null,
    status: row.status,
    currentNodeKey: row.currentNodeKey,
    currentNodeKeys,
    currentNodeName: extras.currentNodeName ?? resolveNodeNameFromSnapshot(row.definitionSnapshot, row.currentNodeKey),
    currentNodeNames,
    initiatorId: row.initiatorId,
    initiatorName: extras.initiatorName ?? null,
    initiatorAvatar: extras.initiatorAvatar ?? null,
    tenantId: row.tenantId,
    parentInstanceId: row.parentInstanceId ?? null,
    parentTaskId: row.parentTaskId ?? null,
    parentTaskItemKey: row.parentTaskItemKey ?? null,
    parentTaskItemIndex: row.parentTaskItemIndex ?? null,
    bizType: row.bizType ?? null,
    bizId: row.bizId ?? null,
    suspendedAt: row.suspendedAt != null ? formatNullableDateTime(row.suspendedAt) : null,
    suspendReason: row.suspendReason ?? null,
    childInstances: extras.childInstances ?? null,
    tasks: extras.tasks ?? null,
    comments: extras.comments,
    consults: extras.consults,
    myTaskStatus: extras.myTaskStatus ?? null,
    myActionAt: extras.myActionAt != null ? formatNullableDateTime(extras.myActionAt as Date) : null,
    ccTaskId: extras.ccTaskId ?? null,
    ccReadAt: extras.ccReadAt != null ? formatNullableDateTime(extras.ccReadAt as Date) : null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
  return extras.includeDefinitionSnapshot
    ? { ...mapped, definitionSnapshot: mapDefinitionSnapshot(row.definitionSnapshot, row.formSnapshot) }
    : mapped;
}

/** 从流程定义快照中解析节点 key 对应的节点名称 */
function resolveNodeNameFromSnapshot(snapshot: unknown, nodeKey: string | null): string | null {
  if (!nodeKey) return null;
  const flowData = (snapshot as { flowData?: WorkflowFlowData } | null)?.flowData;
  return flowData?.nodes?.find((n) => n.data.key === nodeKey)?.data.label ?? null;
}

function normalizeStoredFormSnapshot(snapshot: unknown): WorkflowInstanceFormSnapshot | null {
  if (!snapshot) return null;
  if (Array.isArray(snapshot)) {
    return { fields: snapshot as WorkflowFormField[], settings: null };
  }
  if (typeof snapshot !== 'object') return null;
  const value = snapshot as Partial<WorkflowInstanceFormSnapshot>;
  return {
    formType: value.formType,
    formId: value.formId ?? null,
    formName: value.formName ?? null,
    fields: Array.isArray(value.fields) ? value.fields : [],
    settings: value.settings ?? null,
    customForm: value.customForm ?? null,
  };
}

export function buildInstanceFormSnapshot(
  def: typeof workflowDefinitions.$inferSelect,
  resolvedForm: { fields: WorkflowFormField[]; settings?: WorkflowFormSettings; name: string } | null,
): WorkflowInstanceFormSnapshot | null {
  const formType = (def.formType ?? 'designer') as WorkflowFormType;
  if (formType === 'designer') {
    if (!resolvedForm) return null;
    return {
      formType,
      formId: def.formId ?? null,
      formName: resolvedForm.name,
      fields: resolvedForm.fields,
      settings: resolvedForm.settings ?? null,
      customForm: null,
    };
  }
  return {
    formType,
    formId: null,
    formName: null,
    fields: [],
    settings: null,
    customForm: (def.customForm ?? null) as WorkflowCustomFormConfig | null,
  };
}

function mapDefinitionSnapshot(snapshot: unknown, formSnapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const row = snapshot as Partial<typeof workflowDefinitions.$inferSelect>;
  const normalizedForm = normalizeStoredFormSnapshot(formSnapshot);
  const formType = (row.formType ?? normalizedForm?.formType ?? 'designer') as WorkflowFormType;
  return {
    id: Number(row.id ?? 0),
    name: typeof row.name === 'string' ? row.name : '',
    description: typeof row.description === 'string' ? row.description : null,
    categoryId: typeof row.categoryId === 'number' ? row.categoryId : null,
    flowData: (row.flowData ?? null) as WorkflowFlowData | null,
    formId: typeof row.formId === 'number' ? row.formId : null,
    formName: normalizedForm?.formName ?? null,
    formFields: normalizedForm?.fields ?? null,
    formSettings: normalizedForm?.settings ?? null,
    formType,
    customForm: (row.customForm ?? normalizedForm?.customForm ?? null) as WorkflowCustomFormConfig | null,
    status: row.status,
    version: typeof row.version === 'number' ? row.version : undefined,
    tenantId: typeof row.tenantId === 'number' || row.tenantId === null ? row.tenantId : undefined,
  };
}

export function assertLaunchMatchesFormType(
  def: typeof workflowDefinitions.$inferSelect,
  data: { bizType?: string | null; bizId?: string | null; asDraft?: boolean },
): void {
  const formType = (def.formType ?? 'designer') as WorkflowFormType;
  const hasBizKey = !!data.bizType?.trim() || !!data.bizId?.trim();
  if (formType === 'external') {
    if (data.asDraft) {
      throw new HTTPException(400, { message: '业务系统主导流程不支持在工作流中保存草稿，请在业务模块中保存草稿' });
    }
    if (!data.bizType?.trim() || !data.bizId?.trim()) {
      throw new HTTPException(400, { message: '业务系统主导流程必须通过业务模块发起，并提供 bizType 与 bizId' });
    }
    const cf = def.customForm as WorkflowCustomFormConfig | null;
    if (!cf?.viewComponent?.trim()) {
      throw new HTTPException(400, { message: '业务系统主导流程缺少审批查看页组件配置' });
    }
    return;
  }
  if (hasBizKey) {
    throw new HTTPException(400, { message: '仅业务系统主导流程允许携带 bizType 与 bizId' });
  }
  if (formType === 'custom') {
    const cf = def.customForm as WorkflowCustomFormConfig | null;
    if (!cf?.createComponent?.trim()) {
      throw new HTTPException(400, { message: '自定义业务表单缺少创建页组件配置' });
    }
  }
}
