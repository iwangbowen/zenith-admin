import * as z from 'zod';
import { httpUrl } from '../core/validation';
import { isHttpUrl } from '../core/url';
import { WORKFLOW_SIGNATURE_POLICIES, WORKFLOW_TRIGGER_TYPES } from './constants';
import type { WorkflowNodeConfig, WorkflowEdge, WorkflowAdvancedSettings, WorkflowFlowData } from './types';

export const workflowSignaturePolicySchema = z.enum(WORKFLOW_SIGNATURE_POLICIES);

// ─── 工作流引擎 Schema ────────────────────────────────────────────────────────
export const workflowConditionOperatorSchema = z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'contains', 'isEmpty', 'isNotEmpty', 'between', 'withinDays', 'beforeDays']);

export const workflowEdgeConditionSchema = z.object({
  field: z.string().min(1),
  operator: workflowConditionOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean()]),
  source: z.enum(['form', 'starter']).optional(),
  aggregate: z.enum(['sum', 'count', 'avg']).optional(),
  aggregateField: z.string().optional(),
});

export const workflowConditionGroupSchema = z.object({
  type: z.enum(['and', 'or']),
  rules: z.array(workflowEdgeConditionSchema).min(1),
});

export const workflowNodeTypeSchema = z.enum([
  'start',
  'approve',
  'handler',
  'end',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'routeGateway',
  'ccNode',
  'delay',
  'trigger',
  'subProcess',
  'catchNode',
]);

export const workflowAssigneeTypeSchema = z.enum([
  'user', 'role', 'department', 'userGroup', 'post', 'deptMember',
  'initiator', 'initiatorLeader', 'initiatorDept', 'startUserDeptResponsible',
  'manager', 'multiLevelManager', 'multiLevelDeptHead',
  'formUser', 'formDepartment', 'nodeApprover',
  'initiatorSelect', 'initiatorSelectScope', 'approverSelect',
  'decision', 'expression',
]);

export const workflowApproveMethodSchema = z.enum(['and', 'or', 'sequential', 'ratio', 'random', 'auto']);

export const workflowApprovalTypeSchema = z.enum(['manual', 'autoApprove', 'autoReject']);

export const workflowEmptyAssigneeStrategySchema = z.enum(['autoApprove', 'assignToAdmin', 'reject', 'assignTo']);

export const workflowSameInitiatorStrategySchema = z.enum(['selfApprove', 'autoSkip', 'toDirectManager', 'toDeptHead']);

export const workflowDeduplicateStrategySchema = z.enum(['autoSkip', 'repeatApprove']);

export const workflowOperationPermissionSchema = z.enum([
  'opinionRequired',
]);

export const workflowFieldPermissionSchema = z.enum(['read', 'edit', 'hidden']);

export const workflowActionButtonKeySchema = z.enum([
  'approve', 'reject', 'transfer', 'delegate', 'addSign', 'reduceSign', 'return',
]);

export const workflowActionButtonConfigSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string().max(32).optional(),
  opinionName: z.string().max(32).optional(),
  jumpToNodeKey: z.string().optional(),
  /** 附件配置：不显示/选填/必填，默认 hidden */
  uploadMode: z.enum(['hidden', 'optional', 'required']).optional(),
});

export const workflowTimeoutConfigSchema = z.object({
  enabled: z.boolean(),
  duration: z.number().int().min(1),
  unit: z.enum(['minutes', 'hours', 'days']).optional(),
  action: z.enum(['remind', 'autoApprove', 'autoReject']),
  remindCount: z.number().int().min(1).optional(),
  escalateAction: z.enum(['none', 'autoApprove', 'autoReject', 'transferToManager']).optional(),
  escalateManagerLevel: z.number().int().min(1).optional(),
  escalateFallbackAction: z.enum(['none', 'autoApprove', 'autoReject']).optional(),
});

export const workflowCompensationActionSchema = z.object({
  type: z.enum(['none', 'http', 'connector', 'sms', 'email', 'updateData']),
  connectorId: z.number().int().optional(),
  /** http：绝对 http(s) URL（路径 / 查询可含 {{模板}}）；connector：相对 baseUrl 的路径 */
  url: z.string().max(1000).optional(),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().max(8000).optional(),
  templateId: z.number().int().optional(),
  recipients: z.array(z.string().max(200)).optional(),
  fieldKeys: z.array(z.string()).optional(),
  fieldValues: z.record(z.string(), z.string()).optional(),
  idempotencyKeyTemplate: z.string().max(200).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutMs: z.number().int().min(0).max(600000).optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'http' && value.url && !isHttpUrl(value.url.replace(/\{\{[^}]*\}\}/g, 'x'))) {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'HTTP 补偿动作的 URL 需为 http(s) 地址（主机部分不能是模板）' });
  }
});

export const workflowNodeFailurePolicySchema = z.object({
  action: z.enum(['continue', 'retry', 'compensate', 'fallback', 'notify', 'terminate']),
  maxRetries: z.number().int().min(0).max(10).optional(),
  fallbackNodeKey: z.string().optional(),
  fallbackAction: workflowCompensationActionSchema.optional(),
  compensation: workflowCompensationActionSchema.optional(),
  notifyUserIds: z.array(z.number().int()).nullable().optional(),
  continueAfter: z.boolean().optional(),
  sagaRollback: z.boolean().optional(),
});

export const workflowNodeConfigSchema = z.strictObject({
  key: z.string().min(1),
  type: workflowNodeTypeSchema,
  label: z.string().min(1),
  assigneeId: z.number().int().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  assigneeIds: z.array(z.number().int()).nullable().optional(),
  assigneeNames: z.array(z.string()).nullable().optional(),
  isDefault: z.boolean().optional(),
  assigneeType: workflowAssigneeTypeSchema.optional(),
  approvalType: workflowApprovalTypeSchema.optional(),
  excludeFromStats: z.boolean().optional(),
  userIds: z.array(z.number().int()).nullable().optional(),
  roleIds: z.array(z.number().int()).nullable().optional(),
  deptIds: z.array(z.number().int()).nullable().optional(),
  userGroupIds: z.array(z.number().int()).nullable().optional(),
  postIds: z.array(z.number().int()).nullable().optional(),
  postNames: z.array(z.string()).nullable().optional(),
  deptMemberDeptIds: z.array(z.number().int()).nullable().optional(),
  deptMemberDeptNames: z.array(z.string()).nullable().optional(),
  deptMemberIncludeChildren: z.boolean().optional(),
  selectScopeType: z.enum(['user', 'role', 'department', 'userGroup']).optional(),
  selectScopeIds: z.array(z.number().int()).nullable().optional(),
  assigneeExpression: z.string().max(2000).optional(),
  approveMethod: workflowApproveMethodSchema.optional(),
  approveRatio: z.number().int().min(1).max(100).optional(),
  emptyStrategy: workflowEmptyAssigneeStrategySchema.optional(),
  emptyAssignToIds: z.array(z.number().int()).nullable().optional(),
  emptyAssignToNames: z.array(z.string()).nullable().optional(),
  sameInitiatorStrategy: workflowSameInitiatorStrategySchema.optional(),
  deduplicateStrategy: workflowDeduplicateStrategySchema.optional(),
  operations: z.array(workflowOperationPermissionSchema).optional(),
  signaturePolicy: workflowSignaturePolicySchema.default('none'),
  actionButtons: z.record(workflowActionButtonKeySchema, workflowActionButtonConfigSchema).optional(),
  fieldPermissions: z.record(z.string(), workflowFieldPermissionSchema).optional(),
  timeout: workflowTimeoutConfigSchema.optional(),
  managerLevel: z.number().int().min(1).optional(),
  multiLevelEndType: z.enum(['topLevel', 'level', 'role']).optional(),
  multiLevelEndLevel: z.number().int().min(1).optional(),
  multiLevelEndRoleId: z.number().int().optional(),
  formUserField: z.string().optional(),
  formDeptField: z.string().optional(),
  formDeptHeadLevel: z.number().int().min(1).optional(),
  nodeApproverNodeId: z.string().optional(),
  onlyOnApprove: z.boolean().optional(),
  subProcessId: z.number().int().optional(),
  subProcessName: z.string().optional(),
  subProcessFieldMapping: z.record(z.string(), z.string()).optional(),
  subProcessOutputMapping: z.record(z.string(), z.string()).optional(),
  subProcessWaitChild: z.boolean().optional(),
  subProcessMode: z.enum(['single', 'multi']).optional(),
  subProcessMultiSource: z.string().optional(),
  subProcessMultiExecution: z.enum(['parallel', 'serial']).optional(),
  subProcessMultiItemKey: z.string().optional(),
  subProcessOnChildReject: z.enum(['abort', 'continue']).optional(),
  subProcessInitiator: z.enum(['parentInitiator', 'formField', 'specifiedUser']).optional(),
  subProcessInitiatorField: z.string().optional(),
  subProcessInitiatorUserId: z.number().int().optional(),
  subProcessIgnoreReject: z.boolean().optional(),
  catchAction: z.enum(['toAdmin', 'notify', 'terminate']).optional(),
  catchNotifyUserIds: z.array(z.number().int()).nullable().optional(),
  failurePolicy: workflowNodeFailurePolicySchema.optional(),
  isAsync: z.boolean().optional(),
  nodeListeners: z.array(z.object({
    type: z.literal('webhook'),
    url: httpUrl().max(1000),
    method: z.enum(['GET', 'POST']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    events: z.array(z.enum(['onCreate', 'onApprove', 'onReject'])).min(1, '至少选择一个事件'),
  })).optional(),
});

/** 节点配置：在设计器节点 schema 基础上补齐运行时扩展字段（触发器 / 外部审批 / 延迟 / 退回 / 决策） */
export const workflowNodeDataSchema: z.ZodType<WorkflowNodeConfig> = workflowNodeConfigSchema.extend({
  rejectStrategy: z.enum(['terminate', 'returnPrev', 'returnStart', 'returnToNode']).optional(),
  rejectToNodeKey: z.string().optional(),
  triggerConfig: z.strictObject({
    triggerType: z.enum(WORKFLOW_TRIGGER_TYPES),
    connectorId: z.int().optional(),
    webhookUrl: z.string().optional(),
    httpMethod: z.enum(['GET', 'POST', 'PUT']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    bodyTemplate: z.string().optional(),
    fieldKeys: z.array(z.string()).optional(),
    fieldValues: z.record(z.string(), z.string()).optional(),
    onFailure: z.enum(['continue', 'retry', 'block']).optional(),
    maxRetries: z.int().optional(),
    timeoutMs: z.int().optional(),
    callbackSignMode: z.enum(['none', 'hmacSha256']).optional(),
    callbackSecret: z.string().optional(),
  }).optional(),
  externalApproval: z.strictObject({
    enabled: z.boolean(),
    connectorId: z.int().optional(),
    url: z.string(),
    secret: z.string(),
    signMode: z.enum(['hmacSha256', 'none']).optional(),
    timeoutMs: z.int().optional(),
    fallbackStrategy: z.enum(['manual', 'autoApprove', 'autoReject']).optional(),
  }).optional(),
  delayType: z.enum(['fixed', 'toDate']).optional(),
  delayValue: z.number().optional(),
  delayUnit: z.enum(['minute', 'hour', 'day']).optional(),
  targetDate: z.string().optional(),
  returnMode: z.enum(['reexecute', 'backToOrigin']).optional(),
  decisionRuleKey: z.string().nullable().optional(),
  decisionRefKind: z.enum(['table', 'scorecard', 'flow']).nullable().optional(),
}).meta({ id: 'WorkflowNodeConfig' });

export const workflowEdgeSchema: z.ZodType<WorkflowEdge> = z.strictObject({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string().optional(),
  label: z.string().optional(),
  condition: workflowEdgeConditionSchema.nullable().optional(),
  conditions: z.array(workflowConditionGroupSchema).nullable().optional(),
  isDefault: z.boolean().optional(),
  isException: z.boolean().optional(),
}).meta({ id: 'WorkflowEdge' });

export const workflowAdvancedSettingsSchema: z.ZodType<WorkflowAdvancedSettings> = z.strictObject({
  allowWithdraw: z.boolean(),
  allowResubmit: z.boolean(),
  notifyInitiator: z.boolean(),
  approverDedupMode: z.enum(['none', 'all', 'consecutive']).optional(),
  allowComment: z.boolean().optional(),
  summaryFields: z.array(z.string()).optional(),
  serialNo: z.strictObject({
    enabled: z.boolean(),
    mode: z.enum(['structured', 'template']).optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    separator: z.string().optional(),
    dateFormat: z.enum(['none', 'YYYYMMDD', 'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYYMM', 'YYYY-MM', 'YYYY', 'YY', 'YYYYMMDDHHmmss']).optional(),
    seqLength: z.int().optional(),
    seqStart: z.int().optional(),
    seqStep: z.int().optional(),
    template: z.string().optional(),
    resetPeriod: z.enum(['never', 'daily', 'monthly', 'yearly']).optional(),
  }).optional(),
  notifyChannels: z.strictObject({
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    smsTemplateId: z.int().optional(),
  }).optional(),
  print: z.strictObject({
    onlyWhenApproved: z.boolean().optional(),
    watermark: z.boolean().optional(),
    watermarkText: z.string().max(64).optional(),
    autoArchive: z.boolean().optional(),
  }).optional(),
}).meta({ id: 'WorkflowAdvancedSettings' });

/** React Flow 节点 + 边 + 高级设置（流程定义 / 版本 / 模板 / 快照共用） */
export const workflowFlowDataSchema: z.ZodType<WorkflowFlowData> = z.strictObject({
  nodes: z.array(z.strictObject({
    id: z.string(),
    type: z.string().optional(),
    position: z.strictObject({ x: z.number(), y: z.number() }),
    data: workflowNodeDataSchema,
  })),
  edges: z.array(workflowEdgeSchema),
  settings: workflowAdvancedSettingsSchema.optional(),
}).meta({ id: 'WorkflowFlowData' });
