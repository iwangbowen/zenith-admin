/**
 * 工作流相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const WorkflowCategoryDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string().nullable(),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    sort: z.number().int(),
    description: z.string().nullable(),
    tenantId: z.number().int().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowCategory');

export const WorkflowFormDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string().nullable(),
    description: z.string().nullable(),
    categoryId: z.number().int().nullable(),
    categoryName: z.string().nullable().optional(),
    schema: z.unknown().nullable(),
    status: z.enum(['enabled', 'disabled']),
    usageCount: z.number().int().optional(),
    tenantId: z.number().int().nullable(),
    ...auditFields,
    createdByName: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowForm');

export const WorkflowDataSourceDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    method: z.enum(['GET', 'POST']),
    url: z.string(),
    headers: z.record(z.string(), z.string()).nullable().optional(),
    itemsPath: z.string().nullable().optional(),
    valueField: z.string(),
    labelField: z.string(),
    keywordParam: z.string().nullable().optional(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowDataSource');

export const WorkflowDataSourceOptionDTO = z
  .object({
    value: z.string(),
    label: z.string(),
  })
  .openapi('WorkflowDataSourceOption');

export const WorkflowDefinitionDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    categoryId: z.number().int().nullable(),
    initiatorScopeType: z.enum(['all', 'users', 'departments', 'roles']),
    initiatorScopeIds: z.array(z.number().int()).nullable(),
    categoryName: z.string().nullable().optional(),
    categoryColor: z.string().nullable().optional(),
    categoryIcon: z.string().nullable().optional(),
    flowData: z.unknown().nullable(),
    formId: z.number().int().nullable(),
    formName: z.string().nullable().optional(),
    formFields: z.unknown().nullable(),
    formSettings: z.unknown().nullable().optional(),
    formType: z.enum(['designer', 'custom', 'external']),
    customForm: z.unknown().nullable(),
    status: z.enum(['draft', 'published', 'disabled']),
    version: z.number().int(),
    tenantId: z.number().int().nullable(),
    ...auditFields,
    createdByName: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowDefinition');

export const WorkflowDefinitionVersionDTO = z
  .object({
    id: z.number().int(),
    definitionId: z.number().int(),
    version: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    flowData: z.unknown().nullable(),
    formId: z.number().int().nullable(),
    formName: z.string().nullable().optional(),
    formFields: z.unknown().nullable(),
    formType: z.enum(['designer', 'custom', 'external']),
    customForm: z.unknown().nullable(),
    publishedAt: z.string(),
    publishedBy: z.number().int().nullable(),
    publishedByName: z.string().nullable().optional(),
    tenantId: z.number().int().nullable(),
  })
  .openapi('WorkflowDefinitionVersion');

export const WorkflowDefinitionExportDTO = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    categoryName: z.string().nullable(),
    flowData: z.unknown().nullable(),
    formType: z.enum(['designer', 'custom', 'external']),
    customForm: z.unknown().nullable(),
    form: z.object({
      name: z.string(),
      description: z.string().nullable(),
      schema: z.unknown().nullable(),
    }).nullable(),
    exportedAt: z.string(),
    schemaVersion: z.number().int(),
  })
  .openapi('WorkflowDefinitionExport');

const WorkflowVersionDiffSideDTO = z.object({
  version: z.number().int(),
  name: z.string(),
  label: z.string(),
  flowData: z.unknown().nullable(),
  publishedAt: z.string().nullable(),
});

const WorkflowVersionFieldChangeDTO = z.object({
  field: z.string(),
  before: z.string(),
  after: z.string(),
});

const WorkflowVersionNodeChangeDTO = z.object({
  kind: z.enum(['added', 'removed', 'modified']),
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  fields: z.array(WorkflowVersionFieldChangeDTO),
}).openapi('WorkflowVersionNodeChange');

const WorkflowVersionEdgeChangeDTO = z.object({
  kind: z.enum(['added', 'removed', 'modified']),
  from: z.string(),
  to: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
}).openapi('WorkflowVersionEdgeChange');

const WorkflowVersionDiffSummaryDTO = z.object({
  nodesAdded: z.number().int(),
  nodesRemoved: z.number().int(),
  nodesModified: z.number().int(),
  edgesAdded: z.number().int(),
  edgesRemoved: z.number().int(),
  edgesModified: z.number().int(),
});

export const WorkflowVersionDiffDTO = z
  .object({
    left: WorkflowVersionDiffSideDTO,
    right: WorkflowVersionDiffSideDTO,
    summary: WorkflowVersionDiffSummaryDTO,
    nodeChanges: z.array(WorkflowVersionNodeChangeDTO),
    edgeChanges: z.array(WorkflowVersionEdgeChangeDTO),
  })
  .openapi('WorkflowVersionDiff');

export const WorkflowTaskDTO = z
  .object({
    id: z.number().int(),
    instanceId: z.number().int(),
    nodeKey: z.string(),
    nodeName: z.string(),
    nodeType: z.string().nullable(),
    assigneeId: z.number().int().nullable(),
    assigneeName: z.string().nullable().optional(),
    assigneeAvatar: z.string().nullable().optional(),
    status: z.enum(['pending', 'approved', 'rejected', 'skipped', 'waiting']),
    comment: z.string().nullable(),
    signature: z.string().nullable().optional(),
    attachments: z.array(z.object({ name: z.string(), url: z.string(), size: z.number().optional() })).optional(),
    signatureRequired: z.boolean().optional(),
    actionAt: z.string().nullable(),
    originalAssigneeId: z.number().int().nullable().optional(),
    transferChain: z.array(z.number().int()).optional(),
    delegatedFromId: z.number().int().nullable().optional(),
    externalCallbackId: z.string().nullable().optional(),
    externalDispatchStatus: z.enum(['pending', 'dispatched', 'failed', 'fallback']).nullable().optional(),
    triggerDispatchStatus: z.enum(['pending', 'running', 'success', 'failed', 'retrying']).nullable().optional(),
    triggerAttempt: z.number().int().optional(),
    triggerStartedAt: z.string().nullable().optional(),
    triggerNextRetryAt: z.string().nullable().optional(),
    triggerLastError: z.string().nullable().optional(),
    actionButtons: z.record(z.string(), z.object({
      enabled: z.boolean(),
      displayName: z.string().optional(),
      opinionName: z.string().optional(),
      jumpToNodeKey: z.string().optional(),
      uploadRequired: z.boolean().optional(),
    })).nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('WorkflowTask');

export const WorkflowTaskUrgeDTO = z
  .object({
    id: z.number().int(),
    taskId: z.number().int(),
    instanceId: z.number().int(),
    urgerId: z.number().int().nullable(),
    urgerName: z.string().nullable(),
    message: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkflowTaskUrge');

export const WorkflowCommentDTO = z
  .object({
    id: z.number().int(),
    instanceId: z.number().int(),
    taskId: z.number().int().nullable().optional(),
    userId: z.number().int(),
    userName: z.string().nullable().optional(),
    userAvatar: z.string().nullable().optional(),
    content: z.string(),
    mentions: z.array(z.number().int()),
    mentionNames: z.array(z.string()).nullable().optional(),
    attachments: z.array(z.object({
      name: z.string(),
      url: z.string(),
      size: z.number().int().optional(),
    })),
    createdAt: z.string(),
  })
  .openapi('WorkflowComment');

export const WorkflowTaskConsultDTO = z
  .object({
    id: z.number().int(),
    taskId: z.number().int(),
    instanceId: z.number().int(),
    nodeName: z.string().nullable().optional(),
    inviterId: z.number().int(),
    inviterName: z.string().nullable().optional(),
    consulteeId: z.number().int(),
    consulteeName: z.string().nullable().optional(),
    consulteeAvatar: z.string().nullable().optional(),
    question: z.string().nullable(),
    opinion: z.string().nullable(),
    status: z.enum(['pending', 'replied', 'revoked']),
    repliedAt: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('WorkflowTaskConsult');

export const WorkflowInstanceDTO = z
  .object({
    id: z.number().int(),
    definitionId: z.number().int(),
    definitionName: z.string().nullable().optional(),
    categoryId: z.number().int().nullable().optional(),
    categoryName: z.string().nullable().optional(),
    title: z.string(),
    serialNo: z.string().nullable().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    allowResubmit: z.boolean().optional(),
    allowComment: z.boolean().optional(),
    formData: z.unknown().nullable(),
    formSnapshot: z.unknown().nullable().optional(),
    definitionSnapshot: z.unknown().nullable().optional(),
    status: z.enum(['draft', 'running', 'approved', 'rejected', 'withdrawn', 'cancelled']),
    currentNodeKey: z.string().nullable(),
    currentNodeKeys: z.array(z.string()).optional(),
    currentNodeName: z.string().nullable().optional(),
    currentNodeNames: z.array(z.string()).optional(),
    initiatorId: z.number().int(),
    initiatorName: z.string().nullable().optional(),
    initiatorAvatar: z.string().nullable().optional(),
    tenantId: z.number().int().nullable(),
    parentInstanceId: z.number().int().nullable().optional(),
    parentTaskId: z.number().int().nullable().optional(),
    parentTaskItemKey: z.string().nullable().optional(),
    parentTaskItemIndex: z.number().int().nullable().optional(),
    bizType: z.string().nullable().optional(),
    bizId: z.string().nullable().optional(),
    childInstances: z.array(z.object({
      id: z.number().int(),
      title: z.string(),
      status: z.enum(['draft', 'running', 'approved', 'rejected', 'withdrawn', 'cancelled']),
      parentTaskNodeKey: z.string().nullable().optional(),
      createdAt: z.string(),
    })).nullable().optional(),
    tasks: z.array(WorkflowTaskDTO).nullable().optional(),
    comments: z.array(WorkflowCommentDTO).optional(),
    consults: z.array(WorkflowTaskConsultDTO).optional(),
    myTaskStatus: z.enum(['pending', 'approved', 'rejected', 'skipped', 'waiting']).nullable().optional(),
    myActionAt: z.string().nullable().optional(),
    ccTaskId: z.number().int().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowInstance');

export const WorkflowInstanceListItemDTO = WorkflowInstanceDTO.omit({
  formData: true,
  formSnapshot: true,
  definitionSnapshot: true,
  tasks: true,
  comments: true,
  consults: true,
}).extend({
  pendingTaskId: z.number().int().optional(),
  pendingSignatureRequired: z.boolean().optional(),
  slaLevel: z.enum(['none', 'safe', 'warning', 'overdue']).optional(),
  slaDeadline: z.string().nullable().optional(),
  slaOverdueSec: z.number().int().nullable().optional(),
}).openapi('WorkflowInstanceListItem');

export const WorkflowInstanceAllDTO = z
  .object({
    stats: z.record(z.string(), z.number().int()),
    list: z.array(WorkflowInstanceListItemDTO),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('WorkflowInstanceAll');

export const WorkflowAutomationDTO = z
  .object({
    id: z.number().int(),
    definitionId: z.number().int(),
    definitionName: z.string().nullable().optional(),
    name: z.string(),
    trigger: z.enum(['approved', 'rejected', 'withdrawn', 'created']),
    actions: z.array(z.unknown()),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    tenantId: z.number().int().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowAutomation');

export const WorkflowTemplateDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string().nullable(),
    description: z.string().nullable(),
    categoryName: z.string().nullable(),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    flowData: z.unknown().nullable(),
    formSchema: z.unknown().nullable(),
    sort: z.number().int(),
    builtin: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowTemplate');

export const WorkflowQuickPhraseDTO = z
  .object({
    id: z.number().int(),
    userId: z.number().int().nullable(),
    content: z.string(),
    sort: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowQuickPhrase');

export const WorkflowDelegationDTO = z
  .object({
    id: z.number().int(),
    principalId: z.number().int(),
    principalName: z.string().nullable().optional(),
    delegateId: z.number().int(),
    delegateName: z.string().nullable().optional(),
    definitionId: z.number().int().nullable(),
    definitionName: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    startAt: z.string().nullable().optional(),
    endAt: z.string().nullable().optional(),
    enabled: z.boolean(),
    active: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowDelegation');

export const WorkflowBatchActionResultDTO = z
  .object({
    taskId: z.number().int(),
    success: z.boolean(),
    message: z.string().optional(),
  })
  .openapi('WorkflowBatchActionResult');

export const WorkflowBatchActionResponseDTO = z
  .object({
    succeeded: z.number().int(),
    failed: z.number().int(),
    results: z.array(WorkflowBatchActionResultDTO),
  })
  .openapi('WorkflowBatchActionResponse');

export const WorkflowInstanceBatchActionResultDTO = z
  .object({
    instanceId: z.number().int(),
    success: z.boolean(),
    message: z.string().optional(),
  })
  .openapi('WorkflowInstanceBatchActionResult');

export const WorkflowInstanceBatchActionResponseDTO = z
  .object({
    succeeded: z.number().int(),
    failed: z.number().int(),
    results: z.array(WorkflowInstanceBatchActionResultDTO),
  })
  .openapi('WorkflowInstanceBatchActionResponse');

export const WorkflowApproverPreviewNodeDTO = z
  .object({
    nodeKey: z.string(),
    nodeName: z.string(),
    nodeType: z.string(),
    approvers: z.array(z.object({ id: z.number().int(), name: z.string() })),
    approveMethod: z.string().nullable().optional(),
    branchLabel: z.string().nullable().optional(),
    empty: z.boolean().optional(),
  })
  .openapi('WorkflowApproverPreviewNode');

export const WorkflowSimulationTimelineItemDTO = z
  .object({
    step: z.number().int(),
    nodeKey: z.string(),
    nodeName: z.string(),
    nodeType: z.string(),
    status: z.enum(['entered', 'waiting', 'approved', 'rejected', 'autoApproved', 'skipped', 'blocked']),
    assignees: z.array(z.object({ id: z.number().int(), name: z.string() })).optional(),
    decision: z.enum(['approve', 'reject', 'skip', 'wait', 'auto']).optional(),
    reason: z.string().optional(),
    detail: z.string().optional(),
    nextNodeKeys: z.array(z.string()).optional(),
    estimatedMinutes: z.number().int().optional(),
  })
  .openapi('WorkflowSimulationTimelineItem');

export const WorkflowSimulationEdgeResultDTO = z
  .object({
    edgeId: z.string(),
    source: z.string(),
    target: z.string(),
    sourceKey: z.string().optional(),
    targetKey: z.string().optional(),
    label: z.string().nullable().optional(),
    taken: z.boolean(),
    reason: z.string().optional(),
    conditionMatched: z.boolean().nullable().optional(),
    conditionSummary: z.string().nullable().optional(),
    actualValue: z.string().nullable().optional(),
  })
  .openapi('WorkflowSimulationEdgeResult');

export const WorkflowSimulationNodeStateDTO = z
  .object({
    status: z.enum(['pending', 'active', 'done', 'skipped', 'error']),
    message: z.string().optional(),
  })
  .openapi('WorkflowSimulationNodeState');

export const WorkflowSimulationHealthIssueDTO = z
  .object({
    level: z.enum(['error', 'warning', 'info']),
    scope: z.enum(['flow', 'node', 'edge']),
    nodeKey: z.string().optional(),
    edgeId: z.string().optional(),
    message: z.string(),
    suggestion: z.string().optional(),
  })
  .openapi('WorkflowSimulationHealthIssue');

export const WorkflowSimulationBlockingPointDTO = z
  .object({
    nodeKey: z.string(),
    nodeName: z.string(),
    kind: z.enum(['humanTask', 'delay', 'external', 'subProcess', 'blocked']),
    reason: z.string(),
    estimatedMinutes: z.number().int(),
  })
  .openapi('WorkflowSimulationBlockingPoint');

export const WorkflowSimulationResultDTO = z
  .object({
    valid: z.boolean(),
    warnings: z.array(z.string()),
    result: z.enum(['finished', 'rejected', 'waiting', 'blocked', 'invalid', 'stepLimit']),
    timeline: z.array(WorkflowSimulationTimelineItemDTO),
    edgeResults: z.array(WorkflowSimulationEdgeResultDTO),
    nodeStates: z.record(z.string(), WorkflowSimulationNodeStateDTO),
    healthIssues: z.array(WorkflowSimulationHealthIssueDTO),
    pathSignature: z.array(z.string()),
    estimatedDurationMinutes: z.number().int(),
    blockingPoints: z.array(WorkflowSimulationBlockingPointDTO),
  })
  .openapi('WorkflowSimulationResult');

export const WorkflowScheduleDTO = z
  .object({
    id: z.number().int(),
    definitionId: z.number().int(),
    definitionName: z.string().nullable().optional(),
    name: z.string(),
    cronExpression: z.string(),
    initiatorId: z.number().int(),
    initiatorName: z.string().nullable().optional(),
    titleTemplate: z.string().nullable(),
    formData: z.record(z.string(), z.unknown()).nullable(),
    status: z.enum(['enabled', 'disabled']),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.string().nullable(),
    lastRunMessage: z.string().nullable(),
    nextRunAt: z.string().nullable(),
    tenantId: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowSchedule');

export const WorkflowSavedViewDTO = z
  .object({
    id: z.number().int(),
    userId: z.number().int(),
    pageKey: z.string(),
    name: z.string(),
    filters: z.record(z.string(), z.unknown()),
    isDefault: z.boolean(),
    sort: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowSavedView');

export const WorkflowRelationOptionDTO = z
  .object({
    instanceId: z.number().int(),
    title: z.string(),
    serialNo: z.string().nullable(),
    definitionName: z.string().nullable(),
    status: z.enum(['draft', 'running', 'approved', 'rejected', 'withdrawn', 'cancelled']),
    createdAt: z.string(),
  })
  .openapi('WorkflowRelationOption');

export const WorkflowAnalyticsDTO = z
  .object({
    statusCounts: z.array(z.object({
      status: z.enum(['draft', 'running', 'approved', 'rejected', 'withdrawn', 'cancelled']),
      count: z.number().int(),
    })),
    total: z.number().int(),
    avgDurationSec: z.number().nullable(),
    pendingTaskCount: z.number().int(),
    overdueTaskCount: z.number().int(),
    dueSoonTaskCount: z.number().int(),
    recentCreated: z.number().int(),
    rejectionRate: z.number().nullable(),
    timeoutRate: z.number().nullable(),
    definitionStats: z.array(z.object({
      definitionId: z.number().int(),
      definitionName: z.string(),
      total: z.number().int(),
      running: z.number().int(),
      approved: z.number().int(),
      rejected: z.number().int(),
      avgDurationSec: z.number().nullable(),
    })),
    nodeBottlenecks: z.array(z.object({
      definitionId: z.number().int(),
      definitionName: z.string(),
      nodeKey: z.string(),
      nodeName: z.string(),
      avgHandleSec: z.number().nullable(),
      pendingCount: z.number().int(),
      doneCount: z.number().int(),
    })),
    approverWorkloads: z.array(z.object({
      userId: z.number().int(),
      userName: z.string(),
      pendingCount: z.number().int(),
      handledCount: z.number().int(),
      oldestPendingSec: z.number().nullable(),
    })),
    trend: z.array(z.object({
      date: z.string(),
      created: z.number().int(),
      completed: z.number().int(),
    })),
  })
  .openapi('WorkflowAnalytics');

export const WorkflowOverdueTaskDTO = z
  .object({
    taskId: z.number().int(),
    instanceId: z.number().int(),
    instanceTitle: z.string(),
    serialNo: z.string().nullable().optional(),
    definitionName: z.string(),
    nodeName: z.string(),
    assigneeId: z.number().int().nullable(),
    assigneeName: z.string().nullable(),
    timeoutAt: z.string(),
    overdueSec: z.number(),
  })
  .openapi('WorkflowOverdueTask');
