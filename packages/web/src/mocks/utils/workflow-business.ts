import { getMockCmsReviewContent, getMockCmsWorkingContent } from './cms-revisions';
import { syncMockCmsFeedbackWorkflow } from '../data/cms-operations';
import { submitMockCmsContentRelease } from '../handlers/cms-releases';
import dayjs from 'dayjs';
import { publishMockWatchEvent } from '@/mocks/data/entity-watch-events';
import type { CmsContent } from '@zenith/shared/cms';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES } from '@zenith/shared/workflow';
import type { WorkflowBusinessContext, WorkflowBusinessPreview, WorkflowDefinition, WorkflowInstance } from '@zenith/shared/workflow';
import { mockBizLeaves } from '../data/biz-leave';
import { mockCmsChannels, mockCmsContents, mockCmsSites } from '../data/cms';
import { mockUsers } from '../data/users';
import { buildFirstApproveTask, getNextInstanceId, mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks } from '../data/workflow';
import { MockHttpError } from './contract';
import { requireItem } from './crud';
import { mockDateTime } from './date';
import { badRequest, notFound } from './handlers';

const ACTIVE_STATUSES = new Set<WorkflowInstance['status']>(WORKFLOW_ACTIVE_INSTANCE_STATUSES);

export function resolveMockBusinessDefinition(name: string, definitionId?: number): WorkflowDefinition {
  const definition = mockWorkflowDefinitions.find((item) => definitionId === undefined ? item.name === name && item.formType === 'external' && item.status === 'published' : item.id === definitionId);
  if (!definition || definition.formType !== 'external' || definition.status !== 'published') {
    throw new MockHttpError(badRequest(`未找到已发布的「${name}」业务系统主导流程定义`, { status: 400 }));
  }
  return definition;
}

/** Demo 的业务 seed 为线性流程，直接从同源流程图解析用户节点，不保存业务或实例。 */
export function previewMockBusinessWorkflow(definition: WorkflowDefinition | null): WorkflowBusinessPreview {
  if (!definition) return { definition: null, nodes: [] };
  return {
    definition: { id: definition.id, name: definition.name, description: definition.description, version: definition.version, flowData: definition.flowData },
    nodes: (definition.flowData?.nodes ?? []).filter((node) => ['approve', 'handler', 'ccNode'].includes(node.data.type)).map(({ data }) => {
      const ids = data.assigneeIds ?? (data.assigneeId == null ? [] : [data.assigneeId]);
      const approvers = mockUsers.filter((user) => ids.includes(user.id)).map((user) => ({ id: user.id, name: user.nickname ?? user.username }));
      return { nodeKey: data.key, nodeName: data.label, nodeType: data.type, approvers, approveMethod: data.approveMethod, empty: approvers.length === 0 };
    }),
  };
}

function businessInstances(bizType: string, bizId: number) {
  return mockWorkflowInstances.filter((instance) => instance.bizType === bizType && instance.bizId === String(bizId)).sort((a, b) => b.id - a.id);
}

export function requireMockBusinessInstance(bizType: string, bizId: number, instanceId: number): WorkflowInstance {
  const instance = requireItem(mockWorkflowInstances, instanceId, '审批实例不存在', { status: 404 });
  if (instance.bizType !== bizType || instance.bizId !== String(bizId)) {
    throw new MockHttpError(notFound('审批实例与业务记录不匹配', { status: 404 }));
  }
  return instance;
}

export function getMockBusinessContext(bizType: string, bizId: number, currentId: number | null, requestedId?: number): WorkflowBusinessContext {
  const instances = businessInstances(bizType, bizId);
  const selectedId = requestedId ?? currentId;
  const selected = selectedId == null ? null : requireMockBusinessInstance(bizType, bizId, selectedId);
  const tasks = selected ? mockWorkflowTasks.filter((task) => task.instanceId === selected.id) : [];
  const activeTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'waiting');
  const currentNodeKeys = [...new Set(activeTasks.map((task) => task.nodeKey))];
  const currentNodeNames = [...new Set(activeTasks.map((task) => task.nodeName))];
  return {
    instance: selected ? { ...selected, tasks, currentNodeKeys, currentNodeNames, currentNodeName: currentNodeNames[0] ?? null } : null,
    previousInstances: instances.map(({ id, title, status, createdAt, definitionName }) => ({ id, title, status, createdAt, definitionName: definitionName ?? null })),
  };
}

export function startMockBusinessWorkflow(input: { definition: WorkflowDefinition; bizType: string; bizId: number; title: string; variables: Record<string, unknown>; initiatorId?: number; initiatorName?: string | null; tenantId: number | null }): WorkflowInstance {
  const existing = businessInstances(input.bizType, input.bizId).find((instance) => ACTIVE_STATUSES.has(instance.status));
  if (existing) return existing;
  const { definition } = input;
  const now = mockDateTime();
  const id = getNextInstanceId();
  const task = buildFirstApproveTask(definition, id, now);
  const instance: WorkflowInstance = {
    id, definitionId: definition.id, definitionName: definition.name, title: input.title,
    formData: { ...input.variables },
    formSnapshot: { formType: 'external', formId: null, formName: null, fields: [], settings: null, customForm: structuredClone(definition.customForm) },
    definitionSnapshot: structuredClone(definition),
    status: task ? 'running' : 'approved', currentNodeKey: task?.nodeKey ?? null,
    initiatorId: input.initiatorId ?? 1, initiatorName: input.initiatorName ?? '管理员', initiatorAvatar: null,
    tenantId: input.tenantId, bizType: input.bizType, bizId: String(input.bizId), tasks: task ? [task] : [], createdAt: now, updatedAt: now,
  };
  mockWorkflowInstances.push(instance);
  if (task) mockWorkflowTasks.push(task);
  return instance;
}

export function resolveMockCmsAuditDefinition(siteId: number): WorkflowDefinition | null {
  const site = requireItem(mockCmsSites, siteId, '站点不存在', { status: 404 });
  if (site.settings.auditMode !== 'workflow') return null;
  const configuredId = site.settings.auditWorkflowDefinitionId;
  return resolveMockBusinessDefinition('CMS 内容审核', typeof configuredId === 'number' ? configuredId : undefined);
}

export function startMockCmsWorkflow(content: CmsContent): void {
  const definition = resolveMockCmsAuditDefinition(content.siteId);
  if (!definition) return;
  const site = requireItem(mockCmsSites, content.siteId, '站点不存在', { status: 404 });
  const channel = requireItem(mockCmsChannels, content.channelId, '栏目不存在', { status: 404 });
  startMockBusinessWorkflow({ definition, bizType: 'cms_content', bizId: content.id, title: `内容审核 - ${content.title}`, variables: { contentTitle: content.title, siteName: site.name, channelName: channel.name }, tenantId: 1 });
}

export function getMockCmsCurrentInstanceId(content: CmsContent): number | null {
  return businessInstances('cms_content', content.id)[0]?.id ?? null;
}

export function assertMockCmsManualAudit(content: CmsContent): void {
  if (businessInstances('cms_content', content.id).some((instance) => ACTIVE_STATUSES.has(instance.status))) {
    throw new MockHttpError(badRequest('内容正在工作流审核中，请在流程中处理', { status: 400 }));
  }
}

/** 只回写该业务的当前轮次，审批旧轮次不会覆盖已重新提交的业务。 */
export function syncMockWorkflowBusinessResult(instance: WorkflowInstance): void {
  syncMockCmsFeedbackWorkflow(instance);
  if (['approved', 'rejected', 'withdrawn', 'returned'].includes(instance.status)) {
    publishMockWatchEvent({ id: `workflow:${instance.id}:${instance.status}:${instance.updatedAt}`, eventType: `workflow.instance.${instance.status}`,
      occurredAt: dayjs().toISOString(), sourceRef: { type: 'workflow.instance', key: String(instance.id) },
      subjectRefs: [{ type: 'workflow.instance', key: String(instance.id), role: 'primary' }], visibility: 'restricted',
      payload: { instanceId: instance.id, status: instance.status } });
  }
  if (instance.bizType === 'biz_leave') {
    const leave = mockBizLeaves.find((item) => String(item.id) === instance.bizId);
    if (!leave || leave.workflowInstanceId !== instance.id) return;
    leave.workflowStatus = instance.status;
    if (instance.status === 'approved' || instance.status === 'rejected') leave.status = instance.status;
    else if (instance.status === 'withdrawn') leave.status = 'cancelled';
    leave.updatedAt = instance.updatedAt;
  } else if (instance.bizType === 'cms_content') {
    const content = mockCmsContents.find((item) => String(item.id) === instance.bizId);
    if (!content || !content.submittedRevisionId || content.lockedAt || (content as CmsContent & { deleted?: boolean }).deleted || getMockCmsCurrentInstanceId(content) !== instance.id) return;
    getMockCmsWorkingContent(content.id);
    const reviewed = getMockCmsReviewContent(content.id, instance.id);
    if (instance.status === 'approved' && reviewed.revisionId) {
      content.approvedRevisionId = reviewed.revisionId;
      if (content.version === reviewed.version) content.editorialStatus = 'approved';
      submitMockCmsContentRelease(content.id, reviewed.revisionId);
    } else if (instance.status === 'rejected') { content.editorialStatus = 'rejected'; content.rejectReason = '工作流审核驳回'; }
    else if (instance.status === 'withdrawn') content.editorialStatus = 'draft';
    content.updatedAt = instance.updatedAt;
  }
}
