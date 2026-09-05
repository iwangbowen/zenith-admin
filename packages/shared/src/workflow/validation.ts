import * as z from 'zod';
import { dateRangeBound } from '../core/api-schemas';
import { httpUrl, lazyRecursive, linkUrl, partialForUpdate } from '../core/validation';
import { isHttpUrl } from '../core/url';
import { WORKFLOW_EVENT_SIGN_MODES, WORKFLOW_EVENT_TYPES, WORKFLOW_JOB_TYPES } from './constants';
import type { WorkflowFieldVisibilityRuleGroup, WorkflowFormCascaderNode, WorkflowFormField } from './types';

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
  'signature', 'opinionRequired',
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

export const workflowNodeConfigSchema = z.looseObject({
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

export const workflowFieldVisibilityConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'in', 'contains', 'gt', 'lt', 'gte', 'lte', 'isEmpty', 'notEmpty']),
  value: z.unknown(),
});

/** 规则组（支持嵌套子组）：rules 项为「单条条件」或「子组」 */
export const workflowFieldVisibilityRuleGroupSchema: z.ZodType<WorkflowFieldVisibilityRuleGroup> = lazyRecursive(() =>
  z.object({
    logic: z.enum(['and', 'or']),
    rules: z.array(z.union([workflowFieldVisibilityRuleGroupSchema, workflowFieldVisibilityConditionSchema])),
  })
).meta({ id: 'WorkflowFieldVisibilityRuleGroup' });

export const workflowFormCascaderNodeSchema: z.ZodType<WorkflowFormCascaderNode> = lazyRecursive(() =>
  z.object({
    value: z.string().min(1),
    label: z.string().optional(),
    children: z.array(workflowFormCascaderNodeSchema).optional(),
  })
).meta({ id: 'WorkflowFormCascaderNode' });

export const workflowFormFieldSchema: z.ZodType<WorkflowFormField> = lazyRecursive(() =>
  z.object({
    key: z.string().min(1, '字段 key 不能为空'),
    label: z.string().min(1, '字段标签不能为空'),
    type: z.enum([
      'text', 'textarea', 'number', 'date', 'dateRange', 'time',
      'select', 'multiSelect', 'autoComplete', 'radio', 'checkbox', 'switch', 'slider', 'tags', 'colorPicker',
      'amount',
      'phone', 'email', 'idCard', 'url', 'password', 'pinCode', 'rate', 'formula',
      'attachment', 'image',
      'region', 'signature', 'richtext',
      'userSelect', 'deptSelect', 'dictSelect', 'relation',
      'cascader', 'nps', 'matrix', 'location',
      'detail', 'description', 'serialNumber',
      'row', 'divider', 'group', 'tabs', 'steps',
    ]),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    helpText: z.string().optional(),
    options: z.array(z.string()).optional(),
    optionItems: z.array(z.object({
      value: z.string(),
      label: z.string().optional(),
      color: z.string().optional(),
      disabled: z.boolean().optional(),
      imageUrl: z.string().optional(),
    })).optional(),
    allowOther: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    visibilityCondition: workflowFieldVisibilityConditionSchema.optional(),
    visibilityRules: workflowFieldVisibilityRuleGroupSchema.optional(),
    requiredRules: workflowFieldVisibilityRuleGroupSchema.optional(),
    readOnlyRules: workflowFieldVisibilityRuleGroupSchema.optional(),
    children: z.array(workflowFormFieldSchema).optional(),
    precision: z.number().int().min(0).max(6).optional(),
    step: z.number().optional(),
    unit: z.string().optional(),
    currency: z.string().optional(),
    amountInWords: z.boolean().optional(),
    dateFormat: z.string().optional(),
    timeFormat: z.string().optional(),
    regionLevel: z.enum(['province', 'city', 'district']).optional(),
    dictCode: z.string().optional(),
    multiple: z.boolean().optional(),
    relationDefinitionId: z.number().int().positive().optional(),
    relationDisplayField: z.string().optional(),
    sliderMarks: z.boolean().optional(),
    cascaderOptions: z.array(workflowFormCascaderNodeSchema).optional(),
    cascaderChangeOnSelect: z.boolean().optional(),
    npsMinLabel: z.string().optional(),
    npsMaxLabel: z.string().optional(),
    matrixRows: z.array(z.string()).optional(),
    matrixColumns: z.array(z.string()).optional(),
    alpha: z.boolean().optional(),
    labelPosition: z.enum(['top', 'left', 'inset']).optional(),
    labelAlign: z.enum(['left', 'right']).optional(),
    labelWidth: z.number().int().min(40).max(400).optional(),
    columnSpan: z.number().int().min(1).max(24).optional(),
    readOnly: z.boolean().optional(),
    hidden: z.boolean().optional(),
    maxCount: z.number().int().min(1).optional(),
    description: z.string().optional(),
    serialPrefix: z.string().optional(),
    rateMax: z.number().int().min(1).max(10).optional(),
    formula: z.string().optional(),
    defaultFormula: z.string().optional(),
    validationFormula: z.string().optional(),
    validationMessage: z.string().optional(),
    detailSummary: z.boolean().optional(),
    detailColumnWidth: z.number().int().min(40).max(800).optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    patternMessage: z.string().optional(),
    unique: z.boolean().optional(),
    compareRules: z.array(z.object({
      operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
      field: z.string().min(1),
      message: z.string().optional(),
    })).optional(),
    dateLimit: z.enum(['none', 'noPast', 'noFuture', 'custom']).optional(),
    minDate: z.string().optional(),
    maxDate: z.string().optional(),
    accept: z.string().optional(),
    maxSize: z.number().positive().optional(),
    daysFromKey: z.string().optional(),
    optionsFrom: z.object({
      sourceKey: z.string().min(1),
      mapping: z.record(z.string(), z.array(z.string())),
    }).optional(),
    autoFill: z.object({
      targets: z.array(z.string()),
      byOption: z.record(z.string(), z.record(z.string(), z.string())),
      dataSourceFieldMap: z.record(z.string(), z.string()).optional(),
    }).optional(),
    dataSourceId: z.number().int().positive().optional(),
    columns: z.array(z.object({
      span: z.number().min(1).max(24),
      fields: z.array(workflowFormFieldSchema),
    })).optional(),
    panes: z.array(z.object({
      title: z.string(),
      fields: z.array(workflowFormFieldSchema),
    })).optional(),
    title: z.string().optional(),
    collapsible: z.boolean().optional(),
    defaultCollapsed: z.boolean().optional(),
  })
).meta({ id: 'WorkflowFormField' });

// ─── 流程分类 ─────────────────────────────────────────────────────────────────
export const createWorkflowCategorySchema = z.object({
  name: z.string().min(1).max(64),
  code: z.string().max(64).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  color: z.string().max(16).nullable().optional(),
  sort: z.number().int().optional(),
  description: z.string().max(500).nullable().optional(),
});

export const updateWorkflowCategorySchema = partialForUpdate(createWorkflowCategorySchema);

export type CreateWorkflowCategoryInput = z.input<typeof createWorkflowCategorySchema>;

export type UpdateWorkflowCategoryInput = z.input<typeof updateWorkflowCategorySchema>;

// ─── 表单库 ─────────────────────────────────────────────────────────────────

export const workflowFormSettingsSchema = z.object({
  description: z.string().max(500).optional(),
  submitButtonText: z.string().max(32).optional(),
  labelPosition: z.enum(['top', 'left', 'inset']).optional(),
  labelAlign: z.enum(['left', 'right']).optional(),
  labelWidth: z.number().int().min(40).max(400).optional(),
});

export const workflowFormSchemaSchema = z.object({
  fields: z.array(workflowFormFieldSchema).default([]),
  settings: workflowFormSettingsSchema.optional(),
});

export const createWorkflowFormSchema = z.object({
  name: z.string().min(1, '表单名称不能为空').max(64),
  code: z.string().max(64).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  schema: workflowFormSchemaSchema.nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateWorkflowFormSchema = partialForUpdate(createWorkflowFormSchema).extend({
  /** 乐观锁：客户端持有的 revision，与当前不一致时返回 409 */
  expectedRevision: z.number().int().min(1).optional(),
  /** 字段 key 重命名映射（旧 key → 新 key），服务端级联更新引用该表单的流程定义 flowData */
  renamedKeys: z.record(z.string(), z.string()).optional(),
});

export type CreateWorkflowFormInput = z.input<typeof createWorkflowFormSchema>;

export type UpdateWorkflowFormInput = z.input<typeof updateWorkflowFormSchema>;

// ─── 表单远程数据源 ──────────────────────────────────────────────────────────
export const createWorkflowDataSourceSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  method: z.enum(['GET', 'POST']).default('GET'),
  url: httpUrl('URL 需以 http:// 或 https:// 开头').max(1024),
  headers: z.record(z.string(), z.string()).optional(),
  itemsPath: z.string().max(128).optional(),
  valueField: z.string().min(1, '取值字段不能为空').max(64),
  labelField: z.string().min(1, '显示字段不能为空').max(64),
  keywordParam: z.string().max(64).optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const updateWorkflowDataSourceSchema = partialForUpdate(createWorkflowDataSourceSchema);

export type CreateWorkflowDataSourceInput = z.input<typeof createWorkflowDataSourceSchema>;

export type UpdateWorkflowDataSourceInput = z.input<typeof updateWorkflowDataSourceSchema>;

// ── 流程连接器 ──
/** 连接器类型（仅含运行时已实现调用的类型；mq/database 尚无 adapter，暂不开放创建） */
export const workflowConnectorTypeSchema = z.enum(['http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu']);

/** 凭据明文（按 authType 解释；落库前整体 AES 加密，绝不回传） */
export const workflowConnectorCredentialsSchema = z.object({
  token: z.string().max(2048).optional(),
  username: z.string().max(256).optional(),
  password: z.string().max(2048).optional(),
  apiKey: z.string().max(2048).optional(),
});

export const createWorkflowConnectorSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  code: z.string().min(1, '编码不能为空').max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, '编码以字母开头，仅含字母/数字/下划线/连字符'),
  description: z.string().max(512).nullable().optional(),
  type: workflowConnectorTypeSchema.default('http'),
  config: z.record(z.string(), z.unknown()).default({}),
  credentials: workflowConnectorCredentialsSchema.optional(),
  timeoutMs: z.number().int().min(100).max(120000).default(10000),
  retryMax: z.number().int().min(0).max(10).default(0),
  circuitBreakerEnabled: z.boolean().default(true),
  failureThreshold: z.number().int().min(1).max(100).default(5),
  cooldownSec: z.number().int().min(1).max(3600).default(60),
  rateLimitEnabled: z.boolean().default(false),
  rateLimitWindowSec: z.number().int().min(1).max(3600).default(1),
  rateLimitMax: z.number().int().min(0).max(100000).default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateWorkflowConnectorSchema = partialForUpdate(createWorkflowConnectorSchema).extend({
  /** true=清空凭据；不传且 credentials 也不传=保留原凭据 */
  clearCredentials: z.boolean().optional(),
});

/** 测试调用：对连接器发一次探测请求（http: 相对 baseUrl 的 path + 方法 + body 覆盖） */
export const testWorkflowConnectorSchema = z.object({
  path: z.string().max(1024).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  body: z.unknown().optional(),
});

export type CreateWorkflowConnectorInput = z.input<typeof createWorkflowConnectorSchema>;

export type UpdateWorkflowConnectorInput = z.input<typeof updateWorkflowConnectorSchema>;

export type TestWorkflowConnectorInput = z.infer<typeof testWorkflowConnectorSchema>;

export const workflowFormTypeSchema = z.enum(['designer', 'custom', 'external']);

export const workflowCustomFormVariableSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  type: z.enum(['string', 'number', 'boolean', 'date', 'user', 'dept']),
});

export const workflowCustomFormConfigSchema = z.object({
  // 允许草稿期为空（便于先存草稿再补全）；发布时强制校验非空
  createComponent: z.string().max(256),
  viewComponent: z.string().max(256).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  variables: z.array(workflowCustomFormVariableSchema).optional(),
});

export const createWorkflowDefinitionSchema = z.object({
  name: z.string().min(1, '流程名称不能为空').max(64),
  description: z.string().max(500).nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
  initiatorScopeType: z.enum(['all', 'users', 'departments', 'roles']).default('all'),
  initiatorScopeIds: z.array(z.number().int()).nullable().optional(),
  flowData: z.record(z.string(), z.unknown()).nullable().optional(),
  formId: z.number().int().positive().nullable().optional(),
  formType: workflowFormTypeSchema.default('designer'),
  customForm: workflowCustomFormConfigSchema.nullable().optional(),
  status: z.enum(['draft', 'published', 'disabled']).default('draft'),
});

export const updateWorkflowDefinitionSchema = partialForUpdate(createWorkflowDefinitionSchema);

// 流程级自动化规则
const workflowAutomationActionStartWorkflowSchema = z.object({
  type: z.literal('startWorkflow'),
  definitionId: z.number().int().positive('请选择目标流程'),
  titleTemplate: z.string().max(128).optional(),
  formMapping: z.record(z.string(), z.string()).optional(),
});

const workflowAutomationActionSendMessageSchema = z.object({
  type: z.literal('sendMessage'),
  title: z.string().min(1, '消息标题不能为空').max(128),
  content: z.string().min(1, '消息内容不能为空').max(2000),
  messageType: z.enum(['info', 'success', 'warning', 'error']).optional(),
  recipients: z
    .union([z.literal('initiator'), z.object({ userIds: z.array(z.number().int().positive()).min(1) })])
    .optional(),
  buttons: z
    .array(z.object({ text: z.string().min(1).max(32), url: linkUrl().min(1).max(512) }))
    .max(3, '按钮最多 3 个')
    .optional(),
});

const workflowAutomationActionWebhookSchema = z.object({
  type: z.literal('webhook'),
  url: httpUrl('Webhook 地址需为合法的 http(s) URL').max(512),
  method: z.enum(['GET', 'POST', 'PUT']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().max(4000).optional(),
});

const workflowAutomationActionUpdateFieldSchema = z.object({
  type: z.literal('updateField'),
  fields: z.record(z.string(), z.string()).refine((v) => Object.keys(v).length > 0, '至少配置 1 个字段'),
});

export const workflowAutomationActionSchema = z.discriminatedUnion('type', [
  workflowAutomationActionStartWorkflowSchema,
  workflowAutomationActionSendMessageSchema,
  workflowAutomationActionWebhookSchema,
  workflowAutomationActionUpdateFieldSchema,
]);

export const createWorkflowAutomationSchema = z.object({
  definitionId: z.number().int().positive('请选择流程'),
  name: z.string().min(1, '规则名称不能为空').max(128),
  trigger: z.enum(['approved', 'rejected', 'withdrawn', 'created']),
  actions: z.array(workflowAutomationActionSchema).min(1, '至少配置 1 个动作').max(10),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  sort: z.number().int().nonnegative().default(0),
});

export const updateWorkflowAutomationSchema = partialForUpdate(createWorkflowAutomationSchema);

export type WorkflowAutomationActionInput = z.infer<typeof workflowAutomationActionSchema>;

export type CreateWorkflowAutomationInput = z.infer<typeof createWorkflowAutomationSchema>;

export type UpdateWorkflowAutomationInput = z.infer<typeof updateWorkflowAutomationSchema>;

// ── 流程定时发起 ──
export const createWorkflowScheduleSchema = z.object({
  definitionId: z.number().int().positive('请选择流程'),
  name: z.string().min(1, '规则名称不能为空').max(128),
  cronExpression: z.string().min(1, '请输入 cron 表达式').max(64),
  /** IANA 时区（如 Asia/Shanghai、America/New_York）；空 = 默认 Asia/Shanghai */
  timezone: z.string().max(64).nullable().optional(),
  initiatorId: z.number().int().positive('请选择发起人'),
  titleTemplate: z.string().max(256).nullable().optional(),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateWorkflowScheduleSchema = partialForUpdate(createWorkflowScheduleSchema);

export type CreateWorkflowScheduleInput = z.infer<typeof createWorkflowScheduleSchema>;

export type UpdateWorkflowScheduleInput = z.infer<typeof updateWorkflowScheduleSchema>;

// ── 列表保存视图 ──
export const createWorkflowSavedViewSchema = z.object({
  pageKey: z.string().min(1).max(64),
  name: z.string().min(1, '视图名称不能为空').max(64),
  filters: z.record(z.string(), z.unknown()).default({}),
  isDefault: z.boolean().optional(),
  sort: z.number().int().nonnegative().optional(),
});

export const updateWorkflowSavedViewSchema = partialForUpdate(createWorkflowSavedViewSchema).omit({ pageKey: true });

export type CreateWorkflowSavedViewInput = z.infer<typeof createWorkflowSavedViewSchema>;

export type UpdateWorkflowSavedViewInput = z.infer<typeof updateWorkflowSavedViewSchema>;

// ── 提交前审批链路预览 ──
export const previewWorkflowSchema = z.object({
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type PreviewWorkflowInput = z.infer<typeof previewWorkflowSchema>;

// ── 流程仿真 ──
export const workflowSimulationDecisionSchema = z.object({
  nodeKey: z.string().min(1, '节点标识不能为空'),
  action: z.enum(['approve', 'reject', 'skip', 'wait']),
  assigneeId: z.number().int().positive().optional(),
  reason: z.string().max(256).optional(),
  formPatch: z.record(z.string(), z.unknown()).optional(),
});

export const workflowSimulationOptionsSchema = z.object({
  maxSteps: z.number().int().min(1).max(500).optional(),
  mockDelay: z.boolean().optional(),
  mockTrigger: z.boolean().optional(),
  expandSubProcess: z.boolean().optional(),
});

export const simulateWorkflowSchema = z.object({
  definitionId: z.number().int().positive().optional(),
  flowData: z.looseObject({}).nullable().optional(),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
  starterUserId: z.number().int().positive().optional(),
  decisions: z.array(workflowSimulationDecisionSchema).max(200).optional(),
  options: workflowSimulationOptionsSchema.optional(),
}).refine((v) => v.definitionId || v.flowData, {
  message: 'definitionId 和 flowData 至少需要提供一个',
});

export type SimulateWorkflowInput = z.infer<typeof simulateWorkflowSchema>;

/** 保存仿真用例（按 definitionId + name 归档，重名覆盖） */
export const saveWorkflowSimulationCaseSchema = z.object({
  definitionId: z.number().int().positive(),
  name: z.string().min(1, '用例名称不能为空').max(64),
  starterUserId: z.number().int().positive().nullish(),
  formData: z.record(z.string(), z.unknown()).default({}),
  decisions: z.array(workflowSimulationDecisionSchema).max(200).default([]),
});

export type SaveWorkflowSimulationCaseInput = z.input<typeof saveWorkflowSimulationCaseSchema>;

export const workflowHealthCheckSchema = z.object({
  definitionId: z.number().int().positive().optional(),
  flowData: z.looseObject({}).nullable().optional(),
  /** 设计器草稿：当前绑定表单的字段（key + 类型），用于条件/表达式字段引用与类型兼容性实时校验 */
  formFields: z.array(z.object({ key: z.string(), type: z.string().optional() })).optional(),
}).refine((v) => v.definitionId || v.flowData, {
  message: 'definitionId 和 flowData 至少需要提供一个',
});

export type WorkflowHealthCheckInput = z.infer<typeof workflowHealthCheckSchema>;

// ── 主动抄送 / 转发 ──
export const forwardInstanceSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1, '请选择抄送人').max(50),
  note: z.string().max(256).optional(),
});

export type ForwardInstanceInput = z.infer<typeof forwardInstanceSchema>;

export const workflowPriorityEnum = z.enum(['low', 'normal', 'high', 'urgent']);

export const workflowSelectedApproversSchema = z.record(
  z.string().min(1),
  z.array(z.number().int().positive()).min(1, '请选择审批人').max(50),
);

export const createWorkflowInstanceSchema = z.object({
  definitionId: z.number().int().positive('请选择流程'),
  title: z.string().min(1, '申请标题不能为空').max(128),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
  /** 加急/优先级（默认 normal） */
  priority: workflowPriorityEnum.optional(),
  /** 发起时自选抄送人（提交后立即抄送，与流程内 ccNode 并存） */
  ccUserIds: z.array(z.number().int().positive()).max(50).optional(),
  /** 发起时按节点选择审批人：{ [nodeKey]: userIds } */
  selectedInitiatorApprovers: workflowSelectedApproversSchema.optional(),
});

/** 审批动作附件（[{name,url,size}]）—— 各动作通用 */
export const workflowTaskAttachmentSchema = z.object({
  name: z.string().max(255),
  url: linkUrl().max(1024),
  size: z.number().int().nonnegative().optional(),
});

export const workflowTaskAttachmentsSchema = z.array(workflowTaskAttachmentSchema);

export const approveWorkflowTaskSchema = z.object({
  comment: z.string().max(500).optional(),
  /** 手写签名（data URL，节点要求签名时必填） */
  signature: z.string().max(2_000_000).optional(),
  attachments: workflowTaskAttachmentsSchema.optional(),
  /** 当紧邻的下一节点为 approverSelect 类型时，由当前审批人按节点指定审批人：{ [nodeKey]: userIds } */
  selectedNextApprovers: workflowSelectedApproversSchema.optional(),
  /** 审批人对节点「可编辑」字段的修改（{ 字段key: 新值 }），服务端按节点 fieldPermissions 白名单过滤后合并进实例 formData */
  formUpdates: z.record(z.string(), z.unknown()).optional(),
});

export const rejectWorkflowTaskSchema = z.object({
  comment: z.string().min(1, '驳回原因不能为空').max(500),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const transferWorkflowTaskSchema = z.object({
  targetUserId: z.number().int().positive('请选择转办人'),
  comment: z.string().max(500).optional(),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const delegateWorkflowTaskSchema = z.object({
  targetUserId: z.number().int().positive('请选择委派人'),
  comment: z.string().max(500).optional(),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const addSignWorkflowTaskSchema = z.object({
  targetUserIds: z.array(z.number().int().positive()).min(1, '请选择加签人'),
  position: z.enum(['before', 'after', 'parallel']).default('parallel'),
  /** 多加签人时的会签/或签模式：and=全部通过(会签), or=任一通过(或签)。仅 parallel 生效 */
  signMode: z.enum(['and', 'or']).optional(),
  comment: z.string().max(500).optional(),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const reduceSignWorkflowTaskSchema = z.object({
  targetTaskIds: z.array(z.number().int().positive()).min(1, '请选择要减签的任务'),
  comment: z.string().max(500).optional(),
});

export const returnWorkflowTaskSchema = z.object({
  targetNodeKeys: z.array(z.string().min(1)).min(1, '请选择退回节点').max(20),
  comment: z.string().min(1, '退回原因不能为空').max(500),
  attachments: workflowTaskAttachmentsSchema.optional(),
});

export const urgeWorkflowTaskSchema = z.object({
  message: z.string().max(256).optional(),
});

export const addInstanceCcSchema = z.object({
  nodeKey: z.string().min(1, '请选择抄送节点'),
  userIds: z.array(z.number().int().positive()).min(1, '请选择抄送人'),
});

// ── 草稿 / 重新提交 ──
export const createWorkflowInstanceWithDraftSchema = createWorkflowInstanceSchema.extend({
  /** true = 保存为草稿（不进入审批流转） */
  asDraft: z.boolean().optional(),
});

export const submitWorkflowDraftSchema = z.object({
  /** 草稿提交时补充发起人自选审批人 */
  selectedInitiatorApprovers: workflowSelectedApproversSchema.optional(),
});

export const updateWorkflowInstanceSchema = z.object({
  title: z.string().min(1, '申请标题不能为空').max(128).optional(),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
  priority: workflowPriorityEnum.optional(),
});

// ── 批量审批 ──
export const batchApproveWorkflowTaskSchema = z.object({
  taskIds: z.array(z.number().int().positive()).min(1, '请选择任务').max(200),
  comment: z.string().max(500).optional(),
});

export const batchRejectWorkflowTaskSchema = z.object({
  taskIds: z.array(z.number().int().positive()).min(1, '请选择任务').max(200),
  comment: z.string().min(1, '驳回原因不能为空').max(500),
});

// ── 批量撤回 / 批量催办（跨实例，发起人/管理员维度）──
export const batchWithdrawWorkflowInstanceSchema = z.object({
  instanceIds: z.array(z.number().int().positive()).min(1, '请选择流程').max(200),
  comment: z.string().max(500).optional(),
});

export const batchUrgeWorkflowInstanceSchema = z.object({
  instanceIds: z.array(z.number().int().positive()).min(1, '请选择流程').max(200),
  message: z.string().max(256).optional(),
});

// ── 流程定义导入（自包含 JSON）──
export const importWorkflowDefinitionSchema = z.object({
  name: z.string().min(1, '流程名称不能为空').max(128),
  description: z.string().max(512).nullable().optional(),
  categoryName: z.string().max(64).nullable().optional(),
  flowData: z.unknown(),
  formType: workflowFormTypeSchema.optional(),
  customForm: workflowCustomFormConfigSchema.nullable().optional(),
  form: z.object({
    name: z.string().max(128),
    description: z.string().max(512).nullable().optional(),
    schema: z.unknown(),
  }).nullable().optional(),
  schemaVersion: z.number().int().positive().optional(),
});

// ── 流程评论 ──
export const createWorkflowCommentSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(2000),
  taskId: z.number().int().positive().nullable().optional(),
  /** 回复引用的父评论 ID（须属于同一实例） */
  parentId: z.number().int().positive().nullable().optional(),
  mentions: z.array(z.number().int().positive()).max(50).optional(),
  attachments: z.array(z.object({
    name: z.string().max(255),
    url: linkUrl().max(1024),
    size: z.number().int().nonnegative().optional(),
  })).max(20).optional(),
});

// ── 审批意见常用语 ──
export const createWorkflowQuickPhraseSchema = z.object({
  content: z.string().min(1, '内容不能为空').max(255),
  sort: z.number().int().nonnegative().default(0),
});

export const updateWorkflowQuickPhraseSchema = partialForUpdate(createWorkflowQuickPhraseSchema);

// ── 审批代理 / 离岗委托 ──
export const createWorkflowDelegationSchema = z.object({
  /** 委托人（被代理人）；不传则默认当前登录用户 */
  principalId: z.number().int().positive().optional(),
  delegateId: z.number().int().positive('请选择代理人'),
  definitionId: z.number().int().positive().nullable().optional(),
  /** full=代理人直接代批（默认）；suggest=建议制回执 */
  mode: z.enum(['full', 'suggest']).default('full'),
  reason: z.string().max(255).nullable().optional(),
  startAt: z.string().max(32).nullable().optional(),
  endAt: z.string().max(32).nullable().optional(),
  enabled: z.boolean().default(true),
});

export const updateWorkflowDelegationSchema = partialForUpdate(createWorkflowDelegationSchema);

// ── 管理员强制操作 ──
export const jumpWorkflowInstanceSchema = z.object({
  /** 强制跳转到的目标节点 key */
  targetNodeKey: z.string().min(1, '请选择目标节点'),
  /** 跳转原因：强制干预必须留痕（审计与任务备注） */
  comment: z.string().trim().min(2, '请填写跳转原因').max(500),
});

export const reassignWorkflowTaskSchema = z.object({
  targetUserId: z.number().int().positive('请选择新的处理人'),
  comment: z.string().max(500).optional(),
});

/** 管理员挂起流程实例 */
export const suspendWorkflowInstanceSchema = z.object({
  reason: z.string().min(1, '请填写挂起原因').max(500),
});

/** 离职交接：把 fromUser 名下未处理待办批量移交 toUser */
export const workflowHandoverSchema = z.object({
  fromUserId: z.number().int().positive('请选择交接人'),
  toUserId: z.number().int().positive('请选择接手人'),
  /** 同时停用交接人名下启用中的审批代理规则（默认 true） */
  disableDelegations: z.boolean().optional(),
  comment: z.string().max(255).optional(),
});

// ── 流程模板 ──
export const createWorkflowTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空').max(64),
  code: z.string().max(64).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  categoryName: z.string().max(64).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  color: z.string().max(16).nullable().optional(),
  flowData: z.record(z.string(), z.unknown()).nullable().optional(),
  formSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  sort: z.number().int().nonnegative().default(0),
});

export const updateWorkflowTemplateSchema = partialForUpdate(createWorkflowTemplateSchema);

/** 从现有流程定义另存为模板 */
export const saveAsTemplateSchema = z.object({
  definitionId: z.number().int().positive('请选择流程定义'),
  name: z.string().min(1, '模板名称不能为空').max(64),
  code: z.string().max(64).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  color: z.string().max(16).nullable().optional(),
});

/** 从模板创建流程定义 */
export const cloneFromTemplateSchema = z.object({
  name: z.string().min(1, '流程名称不能为空').max(64).optional(),
  description: z.string().max(512).nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
});

/** 批量推进卡死实例：按流程定义 + 节点 + 卡死时长筛选活动 Token 后逐个跳过推进 */
export const batchSkipStuckTokensSchema = z.object({
  definitionId: z.number().int().positive(),
  nodeKey: z.string().min(1, '请指定节点').max(64),
  olderThanMinutes: z.number().int().nonnegative().max(100000).optional(),
  /** 恢复原因：批量强制干预必须留痕（审计与任务备注） */
  reason: z.string().trim().min(2, '请填写恢复原因').max(256),
});

export type BatchSkipStuckTokensInput = z.infer<typeof batchSkipStuckTokensSchema>;

// ── 审批协办 ──
export const createWorkflowConsultSchema = z.object({
  consulteeIds: z.array(z.number().int().positive()).min(1, '请选择协办人').max(20),
  question: z.string().max(500).optional(),
});

export const replyWorkflowConsultSchema = z.object({
  opinion: z.string().min(1, '协办意见不能为空').max(1000),
});

// ── 撤回已办 ──
export const recallWorkflowTaskSchema = z.object({
  comment: z.string().max(500).optional(),
});

export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>;

export type UpdateWorkflowDefinitionInput = z.infer<typeof updateWorkflowDefinitionSchema>;

export type CreateWorkflowInstanceInput = z.infer<typeof createWorkflowInstanceSchema>;

export type ApproveWorkflowTaskInput = z.infer<typeof approveWorkflowTaskSchema>;

export type RejectWorkflowTaskInput = z.infer<typeof rejectWorkflowTaskSchema>;

export type TransferWorkflowTaskInput = z.infer<typeof transferWorkflowTaskSchema>;

export type DelegateWorkflowTaskInput = z.infer<typeof delegateWorkflowTaskSchema>;

export type AddSignWorkflowTaskInput = z.infer<typeof addSignWorkflowTaskSchema>;

export type ReduceSignWorkflowTaskInput = z.infer<typeof reduceSignWorkflowTaskSchema>;

export type ReturnWorkflowTaskInput = z.infer<typeof returnWorkflowTaskSchema>;

export type UrgeWorkflowTaskInput = z.infer<typeof urgeWorkflowTaskSchema>;

export type AddInstanceCcInput = z.infer<typeof addInstanceCcSchema>;

export type CreateWorkflowInstanceWithDraftInput = z.infer<typeof createWorkflowInstanceWithDraftSchema>;

export type SubmitWorkflowDraftInput = z.infer<typeof submitWorkflowDraftSchema>;

export type UpdateWorkflowInstanceInput = z.infer<typeof updateWorkflowInstanceSchema>;

export type BatchApproveWorkflowTaskInput = z.infer<typeof batchApproveWorkflowTaskSchema>;

export type BatchRejectWorkflowTaskInput = z.infer<typeof batchRejectWorkflowTaskSchema>;

export type BatchWithdrawWorkflowInstanceInput = z.infer<typeof batchWithdrawWorkflowInstanceSchema>;

export type BatchUrgeWorkflowInstanceInput = z.infer<typeof batchUrgeWorkflowInstanceSchema>;

export type ImportWorkflowDefinitionInput = z.infer<typeof importWorkflowDefinitionSchema>;

export type CreateWorkflowCommentInput = z.infer<typeof createWorkflowCommentSchema>;

export type CreateWorkflowQuickPhraseInput = z.infer<typeof createWorkflowQuickPhraseSchema>;

export type UpdateWorkflowQuickPhraseInput = z.infer<typeof updateWorkflowQuickPhraseSchema>;

export type CreateWorkflowDelegationInput = z.infer<typeof createWorkflowDelegationSchema>;

export type UpdateWorkflowDelegationInput = z.infer<typeof updateWorkflowDelegationSchema>;

export type JumpWorkflowInstanceInput = z.infer<typeof jumpWorkflowInstanceSchema>;

export type ReassignWorkflowTaskInput = z.infer<typeof reassignWorkflowTaskSchema>;

export type CreateWorkflowTemplateInput = z.infer<typeof createWorkflowTemplateSchema>;

export type UpdateWorkflowTemplateInput = z.infer<typeof updateWorkflowTemplateSchema>;

export type SaveAsTemplateInput = z.infer<typeof saveAsTemplateSchema>;

export type CloneFromTemplateInput = z.infer<typeof cloneFromTemplateSchema>;

export type CreateWorkflowConsultInput = z.infer<typeof createWorkflowConsultSchema>;

export type ReplyWorkflowConsultInput = z.infer<typeof replyWorkflowConsultSchema>;

export type RecallWorkflowTaskInput = z.infer<typeof recallWorkflowTaskSchema>;

// ── 事件订阅 ──
export const createWorkflowEventSubscriptionSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).nullish(),
  definitionId: z.number().int().nullish(),
  events: z.array(z.enum(WORKFLOW_EVENT_TYPES)).min(1),
  url: z.string().min(1).regex(/^https?:\/\//i, '必须是 http:// 或 https:// 开头的 URL'),
  secret: z.string().max(256).nullish(),
  signMode: z.enum(WORKFLOW_EVENT_SIGN_MODES).optional(),
  headers: z.record(z.string(), z.string()).nullish(),
  connectorId: z.number().int().positive().nullish(),
  enabled: z.boolean().optional(),
});

export const updateWorkflowEventSubscriptionSchema = partialForUpdate(createWorkflowEventSubscriptionSchema);

export const toggleWorkflowEventSubscriptionSchema = z.object({ enabled: z.boolean() });

/** 按筛选批量重放投递（含补发已成功） */
export const replayWorkflowEventDeliveriesSchema = z.object({
  subscriptionId: z.number().int().positive().optional(),
  eventType: z.enum(WORKFLOW_EVENT_TYPES).optional(),
  status: z.enum(['success', 'failed', 'pending', 'all']).optional(),
  startAt: dateRangeBound('起始时间'),
  endAt: dateRangeBound('结束时间'),
});

export type CreateWorkflowEventSubscriptionInput = z.input<typeof createWorkflowEventSubscriptionSchema>;

export type UpdateWorkflowEventSubscriptionInput = z.input<typeof updateWorkflowEventSubscriptionSchema>;

export type ReplayWorkflowEventDeliveriesInput = z.infer<typeof replayWorkflowEventDeliveriesSchema>;

// ── 执行 Token 运维 ──
export const workflowTokenOpSchema = z.object({ reason: z.string().max(255).optional() });

// ── 补偿工单 ──
export const resolveWorkflowCompensationSchema = z.object({
  action: z.enum(['resolve', 'terminate']),
  resolution: z.string().optional(),
});

export const addWorkflowCompensationNoteSchema = z.object({
  note: z.string().max(4000).optional(),
  attachments: z.array(z.object({ id: z.number().int(), name: z.string(), url: z.string() })).optional(),
});

// ── 流程引擎运维 ──
/** 运维动作筛选条件（jobType 由动作固定，此处为附加维度） */
export const workflowEngineActionFilterSchema = z.object({
  instanceId: z.number().int().positive().optional(),
  olderThanMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

/** 重试 / 改参重放作业 */
export const workflowJobRetrySchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
});

/** 批量重试作业：选中的作业 id + 可选限流速率 */
export const workflowJobBatchRetrySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  ratePerSecond: z.number().int().min(1).max(200).optional(),
});

/** 死信条件重放过滤条件（多维：类型/实例/traceId/错误原因/入库时长） */
export const workflowJobReplayFilterSchema = z.object({
  status: z.enum(['dead', 'failed']).optional(),
  jobType: z.enum(WORKFLOW_JOB_TYPES).optional(),
  instanceId: z.number().int().positive().optional(),
  traceId: z.string().trim().min(1).max(128).optional(),
  reasonKeyword: z.string().trim().min(1).max(200).optional(),
  olderThanMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
});

/** 死信重放：过滤条件 + 限流（ratePerSecond 条/秒错峰）+ 单次上限 limit */
export const workflowJobReplaySchema = workflowJobReplayFilterSchema.extend({
  ratePerSecond: z.number().int().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export type WorkflowEngineActionFilterInput = z.infer<typeof workflowEngineActionFilterSchema>;

export type WorkflowJobReplayFilterInput = z.infer<typeof workflowJobReplayFilterSchema>;

export type WorkflowJobReplayInput = z.infer<typeof workflowJobReplaySchema>;

// ── 公开回调（外部审批 / 触发器） ──
export const workflowExternalCallbackSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(1024).optional(),
  approverName: z.string().min(1).max(64).optional(),
});

export const workflowTriggerCallbackSchema = z.object({
  comment: z.string().max(1024).optional(),
  callerName: z.string().min(1).max(64).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type WorkflowExternalCallbackInput = z.infer<typeof workflowExternalCallbackSchema>;

export type WorkflowTriggerCallbackInput = z.infer<typeof workflowTriggerCallbackSchema>;
