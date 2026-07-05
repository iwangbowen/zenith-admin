import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, unique, text, uniqueIndex, index, jsonb, smallint, real } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { statusEnum } from './common';
import { auditColumns, tenants, users } from './core';

// ─── 工作流引擎健康快照表（append-only，由定时任务 platform-wide 采集，驱动健康趋势 + 告警指标源）───
export const workflowEngineHealthSnapshots = pgTable('workflow_engine_health_snapshots', {
  id: serial('id').primaryKey(),
  /** 健康分 0-100 */
  healthScore: smallint('health_score').notNull(),
  /** 综合严重级别：healthy / warning / critical */
  severity: varchar('severity', { length: 16 }).notNull().default('healthy'),
  /** 各内部队列积压总数（饱和度指标） */
  backlog: integer('backlog').notNull().default(0),
  /** 近 24h 事件错误率 0-1 */
  errorRate: real('error_rate').notNull().default(0),
  criticalCount: integer('critical_count').notNull().default(0),
  warningCount: integer('warning_count').notNull().default(0),
  runningInstances: integer('running_instances').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('workflow_engine_health_snapshots_created_at_idx').on(t.createdAt),
]);

export type WorkflowEngineHealthSnapshotRow = typeof workflowEngineHealthSnapshots.$inferSelect;

export type NewWorkflowEngineHealthSnapshot = typeof workflowEngineHealthSnapshots.$inferInsert;

export const workflowDefinitionStatusEnum = pgEnum('workflow_definition_status', ['draft', 'published', 'disabled']);

export const workflowFormTypeEnum = pgEnum('workflow_form_type', ['designer', 'custom', 'external']);

export const workflowInstanceStatusEnum = pgEnum('workflow_instance_status', ['draft', 'running', 'suspended', 'approved', 'rejected', 'withdrawn', 'cancelled']);

export const workflowTaskStatusEnum = pgEnum('workflow_task_status', ['pending', 'approved', 'rejected', 'skipped', 'waiting']);

export const workflowEventSignModeEnum = pgEnum('workflow_event_sign_mode', ['hmacSha256', 'none']);

export const workflowApproveMethodEnum = pgEnum('workflow_approve_method', ['and', 'or', 'sequential', 'ratio']);

// 统一作业账本枚举
export const workflowJobTypeEnum = pgEnum('workflow_job_type', [
  'delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch',
  'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery',
  'compensation_action',
]);

export const workflowJobStatusEnum = pgEnum('workflow_job_status', ['pending', 'running', 'succeeded', 'failed', 'dead', 'canceled']);

export const workflowJobExecutionStatusEnum = pgEnum('workflow_job_execution_status', ['running', 'succeeded', 'failed']);

export const workflowNodeTypeEnum = pgEnum('workflow_node_type', [
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

// 显式执行 Token 状态
export const workflowTokenStatusEnum = pgEnum('workflow_token_status', ['active', 'consumed', 'dead']);

// 流程分类
export const workflowCategories = pgTable('workflow_categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }),
  icon: varchar('icon', { length: 64 }),
  color: varchar('color', { length: 16 }),
  sort: integer('sort').default(0).notNull(),
  description: text('description'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('workflow_categories_code_uniq').on(t.tenantId, t.code)]);

export type WorkflowCategoryRow = typeof workflowCategories.$inferSelect;

export type NewWorkflowCategory = typeof workflowCategories.$inferInsert;

// 表单库（流程表单设计，独立于流程定义、可被多个流程复用）
export const workflowForms = pgTable('workflow_forms', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }),
  description: text('description'),
  categoryId: integer('category_id').references(() => workflowCategories.id, { onDelete: 'set null' }),
  schema: jsonb('schema'), // { fields: WorkflowFormField[], settings: WorkflowFormSettings }
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('workflow_forms_code_uniq').on(t.tenantId, t.code)]);

export type WorkflowFormRow = typeof workflowForms.$inferSelect;

export type NewWorkflowForm = typeof workflowForms.$inferInsert;

// 流程定义
export const workflowDefinitions = pgTable('workflow_definitions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  categoryId: integer('category_id').references(() => workflowCategories.id, { onDelete: 'set null' }),
  initiatorScopeType: varchar('initiator_scope_type', { length: 16 }).notNull().default('all'),
  initiatorScopeIds: jsonb('initiator_scope_ids'),
  flowData: jsonb('flow_data'), // React Flow 节点+边 JSON
  formId: integer('form_id').references(() => workflowForms.id, { onDelete: 'set null' }), // 绑定的表单（实时引用最新表单）
  formType: workflowFormTypeEnum('form_type').default('designer').notNull(), // 表单类型：designer=表单库，custom=自定义业务页面
  customForm: jsonb('custom_form'), // 自定义业务表单配置 { createComponent, viewComponent?, icon?, variables[] }
  status: workflowDefinitionStatusEnum('status').default('draft').notNull(),
  version: integer('version').default(1).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowDefinitionRow = typeof workflowDefinitions.$inferSelect;

export type NewWorkflowDefinition = typeof workflowDefinitions.$inferInsert;

// 流程定义版本快照（发布时写入一行）
export const workflowDefinitionVersions = pgTable('workflow_definition_versions', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  flowData: jsonb('flow_data'),
  formId: integer('form_id'), // 发布时绑定的表单 ID 快照
  formType: workflowFormTypeEnum('form_type').default('designer').notNull(), // 发布时的表单类型快照
  customForm: jsonb('custom_form'), // 发布时的自定义业务表单配置快照
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  publishedBy: integer('published_by').references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
}, (t) => [unique('workflow_def_versions_def_ver_uniq').on(t.definitionId, t.version)]);

export type WorkflowDefinitionVersionRow = typeof workflowDefinitionVersions.$inferSelect;

export type NewWorkflowDefinitionVersion = typeof workflowDefinitionVersions.$inferInsert;

// 流程级自动化规则：当实例终结（通过/拒绝/撤回）或发起时执行的动作
export const workflowAutomationTriggerEnum = pgEnum('workflow_automation_trigger', ['approved', 'rejected', 'withdrawn', 'created']);

export interface WorkflowAutomationActionStartWorkflow {
  type: 'startWorkflow';
  definitionId: number;
  titleTemplate?: string;
  formMapping?: Record<string, string>;
}
export interface WorkflowAutomationActionSendMessage {
  type: 'sendMessage';
  title: string;
  content: string;
  messageType?: 'info' | 'success' | 'warning' | 'error';
  recipients?: 'initiator' | { userIds: number[] };
  buttons?: Array<{ text: string; url: string }>;
}
export interface WorkflowAutomationActionWebhook {
  type: 'webhook';
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  /** 请求体模板，支持 {{form.x}} / {{instance.title}} 等占位 */
  bodyTemplate?: string;
}
export interface WorkflowAutomationActionUpdateField {
  type: 'updateField';
  /** 回写到实例 formData 的字段：key=字段 key，value 支持 {{form.x}} 占位或字面量 */
  fields: Record<string, string>;
}

export type WorkflowAutomationActionConfig =
  | WorkflowAutomationActionStartWorkflow
  | WorkflowAutomationActionSendMessage
  | WorkflowAutomationActionWebhook
  | WorkflowAutomationActionUpdateField;

export const workflowAutomations = pgTable('workflow_automations', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  trigger: workflowAutomationTriggerEnum('trigger').notNull(),
  actions: jsonb('actions').$type<WorkflowAutomationActionConfig[]>().notNull().default([]),
  status: statusEnum('status').notNull().default('enabled'),
  sort: integer('sort').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowAutomationRow = typeof workflowAutomations.$inferSelect;

export type NewWorkflowAutomation = typeof workflowAutomations.$inferInsert;

// 流程定时发起：按 cron 周期自动发起流程实例
export const workflowSchedules = pgTable('workflow_schedules', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  /** 标准 cron 表达式（5 段，tz=Asia/Shanghai） */
  cronExpression: varchar('cron_expression', { length: 64 }).notNull(),
  /** 自动发起时使用的发起人（必须在该流程发起范围内，系统以其身份创建实例） */
  initiatorId: integer('initiator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 标题模板，支持 {{date}} {{datetime}} 占位 */
  titleTemplate: varchar('title_template', { length: 256 }),
  /** 自动发起时预填的表单数据 */
  formData: jsonb('form_data').$type<Record<string, unknown>>(),
  status: statusEnum('status').notNull().default('enabled'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: varchar('last_run_status', { length: 16 }),
  lastRunMessage: varchar('last_run_message', { length: 512 }),
  /** 下次触发时间（调度器扫描 nextRunAt <= now 的启用规则执行） */
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowScheduleRow = typeof workflowSchedules.$inferSelect;

export type NewWorkflowSchedule = typeof workflowSchedules.$inferInsert;

// 列表保存视图：用户为某个列表页保存的命名筛选条件
export const workflowSavedViews = pgTable('workflow_saved_views', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 列表页标识（如 my-applications / monitor / pending / cc / handled） */
  pageKey: varchar('page_key', { length: 64 }).notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  /** 保存的筛选条件（任意键值，前端各页自行约定） */
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
  isDefault: boolean('is_default').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowSavedViewRow = typeof workflowSavedViews.$inferSelect;

export type NewWorkflowSavedView = typeof workflowSavedViews.$inferInsert;

// 表单远程数据源：登记式外部接口，供表单 select 字段拉取选项（仅登记 URL 可被代理调用，防 SSRF）
export const workflowDataSources = pgTable('workflow_data_sources', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  /** 请求方法 GET / POST */
  method: varchar('method', { length: 8 }).notNull().default('GET'),
  url: varchar('url', { length: 1024 }).notNull(),
  /** 附加请求头（如鉴权 token），JSON 键值 */
  headers: jsonb('headers').$type<Record<string, string>>(),
  /** 响应中数组所在路径，点分隔（如 data.list），留空表示响应根即数组 */
  itemsPath: varchar('items_path', { length: 128 }),
  /** 每项取值字段 */
  valueField: varchar('value_field', { length: 64 }).notNull(),
  /** 每项显示字段 */
  labelField: varchar('label_field', { length: 64 }).notNull(),
  /** 远程搜索时传入关键词的参数名（留空表示不支持远程搜索） */
  keywordParam: varchar('keyword_param', { length: 64 }),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowDataSourceRow = typeof workflowDataSources.$inferSelect;

export type NewWorkflowDataSource = typeof workflowDataSources.$inferInsert;

// 流程连接器：统一外部集成（HTTP / Webhook / IM / 邮件 / 短信 / MQ / DB）注册中心
export const workflowConnectorTypeEnum = pgEnum('workflow_connector_type', ['http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database']);

export const workflowConnectors = pgTable('workflow_connectors', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  description: text('description'),
  type: workflowConnectorTypeEnum('type').notNull().default('http'),
  /** 调用配置（按 type 解释）：http → { baseUrl, method, headers, query, authType, contentType } */
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  /** 凭据（整体 JSON 经 AES-256-GCM 加密后的密文；明文绝不落库/回传） */
  credentialsEncrypted: text('credentials_encrypted'),
  /** 单次调用超时（毫秒） */
  timeoutMs: integer('timeout_ms').notNull().default(10000),
  /** 失败重试次数（5xx/网络错误，指数退避） */
  retryMax: integer('retry_max').notNull().default(0),
  /** 熔断开关 */
  circuitBreakerEnabled: boolean('circuit_breaker_enabled').notNull().default(true),
  /** 熔断：连续失败阈值（达到则打开熔断，快速失败） */
  failureThreshold: integer('failure_threshold').notNull().default(5),
  /** 熔断：打开后冷却秒数（之后进入半开试探） */
  cooldownSec: integer('cooldown_sec').notNull().default(60),
  /** 限流开关（与熔断并列：保护下游不被打挂） */
  rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(false),
  /** 限流：滑动时间窗（秒） */
  rateLimitWindowSec: integer('rate_limit_window_sec').notNull().default(1),
  /** 限流：窗口内最大调用次数（<=0 不限制） */
  rateLimitMax: integer('rate_limit_max').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('workflow_connectors_code_uniq').on(t.tenantId, t.code)]);

export type WorkflowConnectorRow = typeof workflowConnectors.$inferSelect;

export type NewWorkflowConnector = typeof workflowConnectors.$inferInsert;

// 连接器调用审计（每次 invokeConnector 写一条，供调用统计/排障）
export const workflowConnectorInvocationSourceEnum = pgEnum('workflow_connector_invocation_source', ['test', 'trigger', 'external', 'webhook', 'manual']);

export const workflowConnectorInvocations = pgTable('workflow_connector_invocations', {
  id: serial('id').primaryKey(),
  connectorId: integer('connector_id').notNull().references(() => workflowConnectors.id, { onDelete: 'cascade' }),
  source: workflowConnectorInvocationSourceEnum('source').notNull().default('manual'),
  ok: boolean('ok').notNull(),
  status: integer('status'),
  durationMs: integer('duration_ms').notNull().default(0),
  requestUrl: varchar('request_url', { length: 1024 }),
  error: varchar('error', { length: 1024 }),
  tenantId: integer('tenant_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('workflow_connector_invocations_conn_idx').on(t.connectorId, t.createdAt)]);

export type WorkflowConnectorInvocationRow = typeof workflowConnectorInvocations.$inferSelect;

// 流程仿真用例（保存的测试场景：表单数据 + 决策 + 发起人，按定义归档，供回归仿真复用）
export const workflowSimulationCases = pgTable('workflow_simulation_cases', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  /** 测试发起人（可空，空表示用当前登录用户） */
  starterUserId: integer('starter_user_id').references(() => users.id, { onDelete: 'set null' }),
  /** 测试表单数据 */
  formData: jsonb('form_data').notNull().default(sql`'{}'::jsonb`),
  /** 仿真决策序列（逐节点 approve/reject/skip/wait + reason + formPatch） */
  decisions: jsonb('decisions').notNull().default(sql`'[]'::jsonb`),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('workflow_simulation_cases_name_uniq').on(t.definitionId, t.name)]);

export type WorkflowSimulationCaseRow = typeof workflowSimulationCases.$inferSelect;

// 运行中实例迁移记录（append-only）：旧版本→新版本，节点映射快照与结果
export const workflowInstanceMigrations = pgTable('workflow_instance_migrations', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull(),
  definitionId: integer('definition_id').notNull(),
  fromVersion: integer('from_version').notNull(),
  toVersion: integer('to_version').notNull(),
  nodeMap: jsonb('node_map').notNull().default(sql`'{}'::jsonb`),
  status: varchar('status', { length: 16 }).notNull().default('done'),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('wf_inst_migration_idx').on(t.instanceId)]);

export type WorkflowInstanceMigrationRow = typeof workflowInstanceMigrations.$inferSelect;

export type NewWorkflowInstanceMigration = typeof workflowInstanceMigrations.$inferInsert;

// 工作流补偿/人工修复工单（catch 节点异常生成，运维手动恢复/终止）
export const workflowCompensations = pgTable('workflow_compensations', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull(),
  nodeKey: varchar('node_key', { length: 64 }).notNull(),
  nodeName: varchar('node_name', { length: 64 }),
  errorMessage: varchar('error_message', { length: 1024 }),
  action: varchar('action', { length: 16 }).notNull().default('notify'),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  /** 自动反向 / 兜底动作执行状态：none（无自动动作）| pending | running | succeeded | failed */
  compensationActionStatus: varchar('compensation_action_status', { length: 16 }).notNull().default('none'),
  /** 失败节点 key（用于「恢复后继续推进」时重注 token） */
  failedNodeKey: varchar('failed_node_key', { length: 64 }),
  /** 反向 / 兜底动作配置快照（WorkflowCompensationAction），供重试与审计 */
  actionPayload: jsonb('action_payload'),
  resolution: text('resolution'),
  resolvedBy: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('wf_compensation_instance_idx').on(t.instanceId), index('wf_compensation_status_idx').on(t.status)]);

/** 补偿工单处理历史（时间线：备注 / 附件 / 自动动作结果 / 恢复续跑 / 放行终止） */
export const workflowCompensationLogs = pgTable('workflow_compensation_logs', {
  id: serial('id').primaryKey(),
  compensationId: integer('compensation_id').notNull().references(() => workflowCompensations.id, { onDelete: 'cascade' }),
  /** 事件类型：note（备注）| attachment | auto（自动动作结果）| retry | resume（恢复续跑）| resolve | terminate */
  action: varchar('action', { length: 16 }).notNull(),
  note: text('note'),
  /** 附件：managed_files 的 { id, name, url } 数组 */
  attachments: jsonb('attachments'),
  operatorId: integer('operator_id').references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('wf_compensation_log_cid_idx').on(t.compensationId)]);

export type WorkflowCompensationRow = typeof workflowCompensations.$inferSelect;

export type NewWorkflowCompensation = typeof workflowCompensations.$inferInsert;

// 流程实例
export const workflowInstances = pgTable('workflow_instances', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'restrict' }),
  definitionSnapshot: jsonb('definition_snapshot').notNull(), // 发起时的定义快照
  formSnapshot: jsonb('form_snapshot'), // 发起时的表单快照（兼容旧 WorkflowFormField[]；新数据含 fields/settings/customForm）
  title: varchar('title', { length: 128 }).notNull(),
  /** 业务编号/流水号（按流程定义的编号规则在发起时生成，如 BX-20260620-0001） */
  serialNo: varchar('serial_no', { length: 64 }),
  formData: jsonb('form_data'), // 填写的表单数据
  status: workflowInstanceStatusEnum('status').default('draft').notNull(),
  /** 加急/优先级：low/normal/high/urgent（发起人设置，审批列表据此置顶） */
  priority: varchar('priority', { length: 16 }).notNull().default('normal'),
  currentNodeKey: varchar('current_node_key', { length: 64 }),
  initiatorId: integer('initiator_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  /** 子流程：父实例 ID（subProcess 节点触发产生的子实例填此字段） */
  parentInstanceId: integer('parent_instance_id'),
  /** 子流程：父实例中触发本子流程的 subProcess 任务 ID，子实例完成时用于唤醒父任务 */
  parentTaskId: integer('parent_task_id'),
  /** 子流程多实例：父任务下当前循环项的幂等 key */
  parentTaskItemKey: varchar('parent_task_item_key', { length: 128 }),
  /** 子流程多实例：父任务下当前循环项的序号（0-based） */
  parentTaskItemIndex: integer('parent_task_item_index'),
  /** 业务实体接入：业务类型（如 biz_leave），普通流程为空 */
  bizType: varchar('biz_type', { length: 64 }),
  /** 业务实体接入：业务记录主键（字符串，兼容各类业务 PK），与 bizType 组成 businessKey */
  bizId: varchar('biz_id', { length: 64 }),
  /** 挂起时间（status=suspended 时有值，恢复后清空） */
  suspendedAt: timestamp('suspended_at'),
  /** 挂起原因（管理员填写） */
  suspendReason: varchar('suspend_reason', { length: 500 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  // 业务键租户内唯一：tenant_id 可空（平台级/单租户数据），用 coalesce 归一为 0 保证空租户下依旧防重
  uniqueIndex('workflow_instances_biz_key_uniq').on(sql`coalesce(${t.tenantId}, 0)`, t.bizType, t.bizId),
  uniqueIndex('workflow_instances_parent_task_item_key_idx').on(t.parentTaskId, t.parentTaskItemKey),
]);

export type WorkflowInstanceRow = typeof workflowInstances.$inferSelect;

export type NewWorkflowInstance = typeof workflowInstances.$inferInsert;

// 审批任务
export const workflowTasks = pgTable('workflow_tasks', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  nodeKey: varchar('node_key', { length: 64 }).notNull(),
  nodeName: varchar('node_name', { length: 64 }).notNull(),
  nodeType: workflowNodeTypeEnum('node_type'),
  assigneeId: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  status: workflowTaskStatusEnum('status').default('pending').notNull(),
  comment: text('comment'),
  /** 手写签名（data URL / 图片地址，审批通过时若节点要求签名则写入） */
  signature: text('signature'),
  /** 审批附件（[{name,url,size}]，审批通过时上传） */
  attachments: jsonb('attachments').$type<Array<{ name: string; url: string; size?: number }>>(),
  actionAt: timestamp('action_at', { withTimezone: true }),
  /** 顺序会签中的顺序（0-based），非顺序场景为 null */
  taskOrder: integer('task_order'),
  /** 多人审批方式（仅同一 nodeKey 多 task 时生效） */
  approveMethod: workflowApproveMethodEnum('approve_method'),
  /** 比例会签阈值（1–100 百分比），仅 approveMethod='ratio' 时有意义 */
  approveRatio: integer('approve_ratio'),
  /** 外部审批：回调 ID（task.status='waiting' 期间有效；派发/恢复由 workflow_jobs 接管） */
  externalCallbackId: varchar('external_callback_id', { length: 64 }).unique(),
  /** 子流程（multi 多实例）：期望子实例总数（仅 subProcess 多实例 waiting 任务有值；单实例/非子流程为 null） */
  subTotal: integer('sub_total'),
  /** 子流程（multi 多实例）：已结束的子实例数（用于汇聚 join 判定） */
  subDone: integer('sub_done').default(0).notNull(),
  /** 任务最初的处理人（创建时快照，转办/委派不会修改） */
  originalAssigneeId: integer('original_assignee_id').references(() => users.id, { onDelete: 'set null' }),
  /** 转办/委派链路上经手过的处理人 ID（含原始创建人） */
  transferChain: jsonb('transfer_chain').$type<number[]>().default([]).notNull(),
  /** 委派来源（仅委派时设置，原 assignee 接手时清空） */
  delegatedFromId: integer('delegated_from_id').references(() => users.id, { onDelete: 'set null' }),
  /** 退回模式 backToOrigin：被退回任务记录发起退回的来源节点 key，通过后直接跳回该节点 */
  returnOriginNodeKey: varchar('return_origin_node_key', { length: 64 }),
  /** 抄送已读时间（仅 ccNode 任务有意义；null 表示未读） */
  ccReadAt: timestamp('cc_read_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowTaskRow = typeof workflowTasks.$inferSelect;

export type NewWorkflowTask = typeof workflowTasks.$inferInsert;

// ─── 显式执行 Token（活动路径 / 网关汇聚的权威来源）──────────────────────────
// 每条活动执行路径 = 一行 token。替代"扫已完成任务行 + 重算 BFS"的隐式推导：
// fork 沿 branchPath 压入一帧分支栈、产生多条兄弟 token；join 在同组分支全部 parked
// 后消费它们并产出 1 条续接 token（弹出栈顶帧），构成可观测、可重放的执行树。
export const workflowTokens = pgTable('workflow_tokens', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  /** token 当前停留的节点 key（frontier 人工/等待节点，或 parked 的网关 join 节点） */
  nodeKey: varchar('node_key', { length: 64 }).notNull(),
  status: workflowTokenStatusEnum('status').notNull().default('active'),
  /**
   * 分支栈：每帧 { id: fork 分支组 id, index: 组内序号, total: 组内分支数 }。
   * 空数组 = 主路径；fork 压栈、join 弹栈。join 汇聚判定 = 同 (父栈 + 帧 id) 下
   * total 个 index 全部 parked。自包含，无需回溯父 token。
   */
  branchPath: jsonb('branch_path').$type<Array<{ id: string; index: number; total: number }>>().notNull().default([]),
  /** fork 处被消费的前驱 token（血缘/可观测，best-effort，可空） */
  parentTokenId: integer('parent_token_id'),
  /** 子流程/多实例项作用域（预留） */
  scopeKey: varchar('scope_key', { length: 128 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  consumedAt: timestamp('consumed_at'),
}, (t) => [
  index('workflow_tokens_instance_status_idx').on(t.instanceId, t.status),
  index('workflow_tokens_parent_idx').on(t.parentTokenId),
]);

export type WorkflowTokenRow = typeof workflowTokens.$inferSelect;

export type NewWorkflowToken = typeof workflowTokens.$inferInsert;

// 任务催办记录：发起人或管理员对 pending 任务的催办流水
export const workflowTaskUrges = pgTable('workflow_task_urges', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  urgerId: integer('urger_id').references(() => users.id, { onDelete: 'set null' }),
  urgerName: varchar('urger_name', { length: 64 }),
  message: varchar('message', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowTaskUrgeRow = typeof workflowTaskUrges.$inferSelect;

export type NewWorkflowTaskUrge = typeof workflowTaskUrges.$inferInsert;

// ─── 工作流事件订阅 / 投递 / 触发器执行 ─────────────────────────────────────
export const workflowEventSubscriptions = pgTable('workflow_event_subscriptions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  /** 为 null 表示订阅全部流程；否则仅订阅指定流程 */
  definitionId: integer('definition_id').references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  /** 订阅的事件类型列表，存为 JSON 数组字符串 */
  events: text('events').notNull(),
  url: varchar('url', { length: 512 }).notNull(),
  secret: varchar('secret', { length: 256 }),
  signMode: workflowEventSignModeEnum('sign_mode').default('hmacSha256').notNull(),
  /** 自定义请求头，JSON 字符串 */
  headers: text('headers'),
  /** 经连接器投递：引用 http 连接器 id（设置后由连接器提供基础地址/鉴权/超时/重试/熔断，url 退化为相对路径） */
  connectorId: integer('connector_id').references(() => workflowConnectors.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').default(true).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type WorkflowEventSubscriptionRow = typeof workflowEventSubscriptions.$inferSelect;

export type NewWorkflowEventSubscription = typeof workflowEventSubscriptions.$inferInsert;

// ─── 工作流统一作业账本 ────────────────────────────────────────────────────────
// 所有"系统级异步动作"（delay 唤醒 / 审批超时 / 触发器派发 / 外部审批派发 /
// 子流程发起·汇聚 / 事件派发 / Webhook 投递）统一落到本表，由统一 Worker 消费。
// 取代旧的 workflow_event_outbox / workflow_trigger_executions / workflow_event_deliveries
// 以及 workflow_tasks 上的 trigger*/external*/wakeAt/timeout* 调度列。
export const workflowJobs = pgTable('workflow_jobs', {
  id: serial('id').primaryKey(),
  /** 作业类型，决定派发到哪个 handler */
  jobType: workflowJobTypeEnum('job_type').notNull(),
  status: workflowJobStatusEnum('status').notNull().default('pending'),
  /** 关联运行态（纯事件派发可空） */
  instanceId: integer('instance_id').references(() => workflowInstances.id, { onDelete: 'cascade' }),
  taskId: integer('task_id').references(() => workflowTasks.id, { onDelete: 'cascade' }),
  nodeKey: varchar('node_key', { length: 64 }),
  /** 幂等键（如 delay:{taskId} / trigger:{taskId}:{attempt} / event:{eventId}），唯一去重 */
  idempotencyKey: varchar('idempotency_key', { length: 160 }).unique(),
  /** 贯穿一次推进的所有异步动作，串起任务/事件/触发器/Webhook/子流程 */
  traceId: varchar('trace_id', { length: 64 }),
  /** 执行所需的上下文（事件 payload / 触发器配置 / 子流程参数等） */
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  /** 优先级（复用实例 priority：low/normal/high/urgent，数值越小越先） */
  priority: integer('priority').notNull().default(100),
  /** 已尝试次数 */
  attempts: integer('attempts').notNull().default(0),
  /** 最大尝试次数（超过进死信） */
  maxAttempts: integer('max_attempts').notNull().default(1),
  /** 何时应执行（delay=wakeAt、timeout=timeoutAt、retry=退避时间） */
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  /** 领取锁定时间（FOR UPDATE SKIP LOCKED 领取后写入，用于识别卡死 running） */
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  /** 领取者标识（worker/进程） */
  lockedBy: varchar('locked_by', { length: 64 }),
  /** 最近一次错误 */
  lastError: text('last_error'),
  /** 执行结果（成功时写入，供审计/串联） */
  result: jsonb('result'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('workflow_jobs_due_idx').on(t.status, t.runAt),
  index('workflow_jobs_type_status_idx').on(t.jobType, t.status),
  index('workflow_jobs_trace_idx').on(t.traceId),
  index('workflow_jobs_instance_idx').on(t.instanceId),
]);

export type WorkflowJobRow = typeof workflowJobs.$inferSelect;

export type NewWorkflowJob = typeof workflowJobs.$inferInsert;

// 作业每一次执行尝试的审计日志（取代 workflow_trigger_executions，泛化到所有 jobType）
export const workflowJobExecutions = pgTable('workflow_job_executions', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().references(() => workflowJobs.id, { onDelete: 'cascade' }),
  jobType: workflowJobTypeEnum('job_type').notNull(),
  attempt: integer('attempt').notNull().default(0),
  status: workflowJobExecutionStatusEnum('status').notNull().default('running'),
  /** HTTP 类作业（trigger/external/webhook）的请求/响应明细 */
  requestUrl: varchar('request_url', { length: 512 }),
  requestMethod: varchar('request_method', { length: 16 }),
  requestBody: text('request_body'),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('workflow_job_executions_job_idx').on(t.jobId),
  index('workflow_job_executions_type_idx').on(t.jobType, t.status),
]);

export type WorkflowJobExecutionRow = typeof workflowJobExecutions.$inferSelect;

export type NewWorkflowJobExecution = typeof workflowJobExecutions.$inferInsert;

// ─── 流程评论 / 沟通时间线 ────────────────────────────────────────────────────
// 审批人 / 抄送人 / 发起人均可在实例下自由留言（不影响审批流转），支持 @ 提及
export const workflowComments = pgTable('workflow_comments', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  /** 关联的任务（在某审批任务上下文中评论时填写，可为空） */
  taskId: integer('task_id').references(() => workflowTasks.id, { onDelete: 'set null' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  /** @ 提及的用户 ID 列表 */
  mentions: jsonb('mentions').$type<number[]>().default([]).notNull(),
  /** 附件列表（{ name, url, size? }[]） */
  attachments: jsonb('attachments').$type<Array<{ name: string; url: string; size?: number }>>().default([]).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowCommentRow = typeof workflowComments.$inferSelect;

export type NewWorkflowComment = typeof workflowComments.$inferInsert;

// ─── 审批意见常用语 ───────────────────────────────────────────────────────────
// userId 为 null 表示系统预置（所有人可见）；否则为个人常用语
export const workflowQuickPhrases = pgTable('workflow_quick_phrases', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  content: varchar('content', { length: 255 }).notNull(),
  sort: integer('sort').default(0).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowQuickPhraseRow = typeof workflowQuickPhrases.$inferSelect;

export type NewWorkflowQuickPhrase = typeof workflowQuickPhrases.$inferInsert;

// ─── 审批代理 / 离岗委托 ──────────────────────────────────────────────────────
// principal 在 [startAt, endAt] 区间内（或永久）将其待审批任务自动转交给 delegate
export const workflowDelegations = pgTable('workflow_delegations', {
  id: serial('id').primaryKey(),
  /** 委托人（被代理人）：其待办将被转交 */
  principalId: integer('principal_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 代理人（受托人）：接收待办 */
  delegateId: integer('delegate_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 限定的流程定义（为 null 表示对全部流程生效） */
  definitionId: integer('definition_id').references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  reason: varchar('reason', { length: 255 }),
  /** 生效开始时间（为 null 表示立即生效） */
  startAt: timestamp('start_at', { withTimezone: true }),
  /** 生效结束时间（为 null 表示长期有效） */
  endAt: timestamp('end_at', { withTimezone: true }),
  enabled: boolean('enabled').default(true).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type WorkflowDelegationRow = typeof workflowDelegations.$inferSelect;

export type NewWorkflowDelegation = typeof workflowDelegations.$inferInsert;

// ─── 业务编号计数器 ───────────────────────────────────────────────────────────
// 每个流程定义 + 周期键（如 '20260620' / 'ALL'）维护一个自增序列，原子自增防并发
export const workflowSerialCounters = pgTable('workflow_serial_counters', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  periodKey: varchar('period_key', { length: 16 }).notNull(),
  seq: integer('seq').default(0).notNull(),
}, (t) => [unique('workflow_serial_counters_def_period_uniq').on(t.definitionId, t.periodKey)]);

export type WorkflowSerialCounterRow = typeof workflowSerialCounters.$inferSelect;

export type NewWorkflowSerialCounter = typeof workflowSerialCounters.$inferInsert;

// ─── 流程模板库 ───────────────────────────────────────────────────────────────
export const workflowTemplates = pgTable('workflow_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }),
  description: text('description'),
  categoryName: varchar('category_name', { length: 64 }),
  icon: varchar('icon', { length: 64 }),
  color: varchar('color', { length: 16 }),
  /** 流程图数据（React Flow / process JSON），克隆时写入新流程定义的 flowData */
  flowData: jsonb('flow_data'),
  /** 表单结构（{ fields, settings }），克隆时创建对应表单 */
  formSchema: jsonb('form_schema'),
  sort: integer('sort').default(0).notNull(),
  /** 系统内置模板（不可删除） */
  builtin: boolean('builtin').default(false).notNull(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('workflow_templates_code_uniq').on(t.code)]);

export type WorkflowTemplateRow = typeof workflowTemplates.$inferSelect;

export type NewWorkflowTemplate = typeof workflowTemplates.$inferInsert;

// ─── 审批协办 / 邀请处理意见 ──────────────────────────────────────────────────
export const workflowTaskConsultStatusEnum = pgEnum('workflow_task_consult_status', ['pending', 'replied', 'revoked']);

export const workflowTaskConsults = pgTable('workflow_task_consults', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  /** 发起协办的审批人 */
  inviterId: integer('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 被邀请协办的人 */
  consulteeId: integer('consultee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  question: varchar('question', { length: 500 }),
  opinion: text('opinion'),
  status: workflowTaskConsultStatusEnum('status').default('pending').notNull(),
  repliedAt: timestamp('replied_at', { withTimezone: true }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type WorkflowTaskConsultRow = typeof workflowTaskConsults.$inferSelect;

export type NewWorkflowTaskConsult = typeof workflowTaskConsults.$inferInsert;
