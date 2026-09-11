import { pgTable, varchar, timestamp, pgEnum, integer, bigint, boolean, unique, text, uniqueIndex, index, jsonb, smallint, real, foreignKey, uuid as pgUuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { WorkflowAutomationAction, WorkflowDefinitionSnapshot } from '@zenith/shared/workflow';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants, users } from './core';
import { managedFiles } from './files';
import { reportPrintTemplates } from './report';

// ─── 工作流引擎健康快照表（append-only，由定时任务 platform-wide 采集，驱动健康趋势 + 告警指标源）───
export const workflowEngineHealthSnapshots = pgTable('workflow_engine_health_snapshots', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 健康分 0-100 */
  healthScore: smallint().notNull(),
  /** 综合严重级别：healthy / warning / critical */
  severity: varchar({ length: 16 }).notNull().default('healthy'),
  /** 各内部队列积压总数（饱和度指标） */
  backlog: integer().notNull().default(0),
  /** 近 24h 事件错误率 0-1 */
  errorRate: real().notNull().default(0),
  criticalCount: integer().notNull().default(0),
  warningCount: integer().notNull().default(0),
  runningInstances: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('workflow_engine_health_snapshots_created_at_idx').on(t.createdAt),
]);

export type WorkflowEngineHealthSnapshotRow = typeof workflowEngineHealthSnapshots.$inferSelect;

export type NewWorkflowEngineHealthSnapshot = typeof workflowEngineHealthSnapshots.$inferInsert;

export const workflowDefinitionStatusEnum = pgEnum('workflow_definition_status', ['draft', 'published', 'disabled']);

export const workflowFormTypeEnum = pgEnum('workflow_form_type', ['designer', 'custom', 'external']);

export const workflowInstanceStatusEnum = pgEnum('workflow_instance_status', ['draft', 'running', 'suspended', 'returned', 'approved', 'rejected', 'withdrawn', 'cancelled']);

export const workflowTaskStatusEnum = pgEnum('workflow_task_status', ['pending', 'approved', 'rejected', 'skipped', 'waiting']);

export const workflowEventSignModeEnum = pgEnum('workflow_event_sign_mode', ['hmacSha256', 'none']);

export const workflowApproveMethodEnum = pgEnum('workflow_approve_method', ['and', 'or', 'sequential', 'ratio']);

// 统一作业账本枚举
export const workflowJobTypeEnum = pgEnum('workflow_job_type', [
  'delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch',
  'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery',
  'compensation_action',
]);

export const workflowJobStatusEnum = pgEnum('workflow_job_status', ['pending', 'running', 'paused', 'succeeded', 'failed', 'dead', 'canceled']);

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
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  code: varchar({ length: 64 }),
  icon: varchar({ length: 64 }),
  color: varchar({ length: 16 }),
  sort: integer().default(0).notNull(),
  description: text(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('workflow_categories_code_uniq').on(t.tenantId, t.code)]);

export type WorkflowCategoryRow = typeof workflowCategories.$inferSelect;

export type NewWorkflowCategory = typeof workflowCategories.$inferInsert;

// 表单库（流程表单设计，独立于流程定义、可被多个流程复用）
export const workflowForms = pgTable('workflow_forms', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  code: varchar({ length: 64 }),
  description: text(),
  categoryId: integer().references(() => workflowCategories.id, { onDelete: 'set null' }),
  schema: jsonb(), // { fields: WorkflowFormField[], settings: WorkflowFormSettings }
  status: statusEnum().notNull().default('enabled'),
  revision: integer().notNull().default(1), // 乐观锁版本号，每次更新 +1
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('workflow_forms_code_uniq').on(t.tenantId, t.code)]);

export type WorkflowFormRow = typeof workflowForms.$inferSelect;

export type NewWorkflowForm = typeof workflowForms.$inferInsert;

// 流程定义
export const workflowDefinitions = pgTable('workflow_definitions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  description: text(),
  categoryId: integer().references(() => workflowCategories.id, { onDelete: 'set null' }),
  initiatorScopeType: varchar({ length: 16 }).notNull().default('all'),
  initiatorScopeIds: jsonb(),
  flowData: jsonb(), // React Flow 节点+边 JSON
  formId: integer().references(() => workflowForms.id, { onDelete: 'set null' }), // 绑定的表单（实时引用最新表单）
  formType: workflowFormTypeEnum().default('designer').notNull(), // 表单类型：designer=表单库，custom=自定义业务页面
  customForm: jsonb(), // 自定义业务表单配置 { createComponent, viewComponent?, icon?, variables[] }
  // 审批单打印模板（报表打印设计器 sourceType=entity 的模板）；未绑定时按表单快照自动生成版式。
  // 外键在表级显式命名：drizzle 派生名超过 PG 63 字符标识符上限会被静默截断
  printTemplateId: integer(),
  status: workflowDefinitionStatusEnum().default('draft').notNull(),
  version: integer().default(1).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  // 发起工作台 / 交接扫描 / 自动化均按 (租户, published) 过滤
  index('workflow_definitions_tenant_status_idx').on(t.tenantId, t.status),
  // 决策表/流/评分卡引用扫描按 flowData @> containment 粗筛（rules.service findWorkflowGatewayUsages）
  index('workflow_definitions_flow_data_gin_idx').using('gin', t.flowData.op('jsonb_path_ops')),
  foreignKey({ name: 'workflow_definitions_print_template_fk', columns: [t.printTemplateId], foreignColumns: [reportPrintTemplates.id] }).onDelete('set null'),
]);

export type WorkflowDefinitionRow = typeof workflowDefinitions.$inferSelect;

export type NewWorkflowDefinition = typeof workflowDefinitions.$inferInsert;

// 流程定义版本快照（发布时写入一行）
export const workflowDefinitionVersions = pgTable('workflow_definition_versions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  definitionId: integer().notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  name: varchar({ length: 64 }).notNull(),
  description: text(),
  flowData: jsonb(),
  formId: integer(), // 发布时绑定的表单 ID 快照
  formType: workflowFormTypeEnum().default('designer').notNull(), // 发布时的表单类型快照
  customForm: jsonb(), // 发布时的自定义业务表单配置快照
  /** 发布时冻结的表单 schema 快照（{ name, schema }）；表单库后续编辑不影响已发布版本的历史查看 */
  formSchema: jsonb().$type<{ name: string | null; schema: unknown } | null>(),
  publishedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  publishedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
}, (t) => [index('workflow_definition_versions_tenant_idx').on(t.tenantId), unique('workflow_def_versions_def_ver_uniq').on(t.definitionId, t.version)]);

export type WorkflowDefinitionVersionRow = typeof workflowDefinitionVersions.$inferSelect;

export type NewWorkflowDefinitionVersion = typeof workflowDefinitionVersions.$inferInsert;

// 流程级自动化规则：当实例终结（通过/拒绝/撤回）或发起时执行的动作
export const workflowAutomationTriggerEnum = pgEnum('workflow_automation_trigger', ['approved', 'rejected', 'withdrawn', 'created']);

/** 动作配置形态以 shared 契约类型为唯一真相（webhook.bodyTemplate / updateField.fields 支持 {{form.x}} 等占位） */
export type WorkflowAutomationActionConfig = WorkflowAutomationAction;

export const workflowAutomations = pgTable('workflow_automations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  definitionId: integer().notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  name: varchar({ length: 128 }).notNull(),
  trigger: workflowAutomationTriggerEnum().notNull(),
  actions: jsonb().$type<WorkflowAutomationActionConfig[]>().notNull().default([]),
  status: statusEnum().notNull().default('enabled'),
  sort: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('workflow_automations_definition_idx').on(t.definitionId), index('workflow_automations_tenant_idx').on(t.tenantId)]);

export type WorkflowAutomationRow = typeof workflowAutomations.$inferSelect;

export type NewWorkflowAutomation = typeof workflowAutomations.$inferInsert;

// 自动化动作执行留痕：每个动作执行一次记一行（成功/失败/跳过），供管理员核对 Webhook 等副作用是否生效
export const workflowAutomationRuns = pgTable('workflow_automation_runs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 规则删除后保留历史记录（置空），靠 ruleName 冗余追溯 */
  ruleId: integer().references(() => workflowAutomations.id, { onDelete: 'set null' }),
  ruleName: varchar({ length: 128 }).notNull(),
  instanceId: integer().references(() => workflowInstances.id, { onDelete: 'set null' }),
  instanceTitle: varchar({ length: 256 }),
  trigger: workflowAutomationTriggerEnum().notNull(),
  actionIndex: integer().notNull(),
  actionType: varchar({ length: 32 }).notNull(),
  /** success | failed | skipped（幂等去重命中） */
  status: varchar({ length: 16 }).notNull(),
  error: varchar({ length: 512 }),
  durationMs: integer(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('workflow_automation_runs_rule_idx').on(t.ruleId),
  index('workflow_automation_runs_instance_idx').on(t.instanceId),
  index('workflow_automation_runs_created_idx').on(t.createdAt),
]);

export type WorkflowAutomationRunRow = typeof workflowAutomationRuns.$inferSelect;

// 流程定时发起：按 cron 周期自动发起流程实例
export const workflowSchedules = pgTable('workflow_schedules', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  definitionId: integer().notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  name: varchar({ length: 128 }).notNull(),
  /** 标准 cron 表达式（5 段） */
  cronExpression: varchar({ length: 64 }).notNull(),
  /** IANA 时区（如 Asia/Shanghai、America/New_York）；null = 默认 Asia/Shanghai */
  timezone: varchar({ length: 64 }),
  /** 自动发起时使用的发起人（必须在该流程发起范围内，系统以其身份创建实例） */
  initiatorId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 标题模板，支持 {{date}} {{datetime}} 占位 */
  titleTemplate: varchar({ length: 256 }),
  /** 自动发起时预填的表单数据 */
  formData: jsonb().$type<Record<string, unknown>>(),
  status: statusEnum().notNull().default('enabled'),
  lastRunAt: timestamp({ withTimezone: true }),
  lastRunStatus: varchar({ length: 16 }),
  lastRunMessage: varchar({ length: 512 }),
  /** 下次触发时间（调度器扫描 nextRunAt <= now 的启用规则执行） */
  nextRunAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('workflow_schedules_definition_idx').on(t.definitionId), index('workflow_schedules_tenant_idx').on(t.tenantId)]);

export type WorkflowScheduleRow = typeof workflowSchedules.$inferSelect;

export type NewWorkflowSchedule = typeof workflowSchedules.$inferInsert;

// 列表保存视图：用户为某个列表页保存的命名筛选条件
export const workflowSavedViews = pgTable('workflow_saved_views', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 列表页标识（如 my-applications / monitor / pending / cc / handled） */
  pageKey: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 64 }).notNull(),
  /** 保存的筛选条件（任意键值，前端各页自行约定） */
  filters: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  isDefault: boolean().notNull().default(false),
  sort: integer().notNull().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...timestampColumns(),
}, (t) => [index('workflow_saved_views_user_idx').on(t.userId), index('workflow_saved_views_tenant_idx').on(t.tenantId)]);

export type WorkflowSavedViewRow = typeof workflowSavedViews.$inferSelect;

export type NewWorkflowSavedView = typeof workflowSavedViews.$inferInsert;

// 表单远程数据源：登记式外部接口，供表单 select 字段拉取选项（仅登记 URL 可被代理调用，防 SSRF）
export const workflowDataSources = pgTable('workflow_data_sources', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull().unique(),
  /** 请求方法 GET / POST */
  method: varchar({ length: 8 }).notNull().default('GET'),
  url: varchar({ length: 1024 }).notNull(),
  /** 附加请求头（如鉴权 token）：JSON 键值对 AES-256-GCM 加密存储（经 lib/secret-crypto） */
  headersEncrypted: text(),
  /** 响应中数组所在路径，点分隔（如 data.list），留空表示响应根即数组 */
  itemsPath: varchar({ length: 128 }),
  /** 每项取值字段 */
  valueField: varchar({ length: 64 }).notNull(),
  /** 每项显示字段 */
  labelField: varchar({ length: 64 }).notNull(),
  /** 远程搜索时传入关键词的参数名（留空表示不支持远程搜索） */
  keywordParam: varchar({ length: 64 }),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  ...timestampColumns(),
});

export type WorkflowDataSourceRow = typeof workflowDataSources.$inferSelect;

export type NewWorkflowDataSource = typeof workflowDataSources.$inferInsert;

// 流程连接器：统一外部集成（HTTP / Webhook / IM / 邮件 / 短信 / MQ / DB）注册中心
export const workflowConnectorTypeEnum = pgEnum('workflow_connector_type', ['http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database']);

export const workflowConnectors = pgTable('workflow_connectors', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  code: varchar({ length: 64 }).notNull(),
  description: text(),
  type: workflowConnectorTypeEnum().notNull().default('http'),
  /** 调用配置（按 type 解释）：http → { baseUrl, method, headers, query, authType, contentType } */
  config: jsonb().notNull().default(sql`'{}'::jsonb`),
  /** 凭据（整体 JSON 经 AES-256-GCM 加密后的密文；明文绝不落库/回传） */
  credentialsEncrypted: text(),
  /** 单次调用超时（毫秒） */
  timeoutMs: integer().notNull().default(10000),
  /** 失败重试次数（5xx/网络错误，指数退避） */
  retryMax: integer().notNull().default(0),
  /** 熔断开关 */
  circuitBreakerEnabled: boolean().notNull().default(true),
  /** 熔断：连续失败阈值（达到则打开熔断，快速失败） */
  failureThreshold: integer().notNull().default(5),
  /** 熔断：打开后冷却秒数（之后进入半开试探） */
  cooldownSec: integer().notNull().default(60),
  /** 限流开关（与熔断并列：保护下游不被打挂） */
  rateLimitEnabled: boolean().notNull().default(false),
  /** 限流：滑动时间窗（秒） */
  rateLimitWindowSec: integer().notNull().default(1),
  /** 限流：窗口内最大调用次数（<=0 不限制） */
  rateLimitMax: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('workflow_connectors_code_uniq').on(t.tenantId, t.code)]);

export type WorkflowConnectorRow = typeof workflowConnectors.$inferSelect;

export type NewWorkflowConnector = typeof workflowConnectors.$inferInsert;

// 连接器调用审计（每次 invokeConnector 写一条，供调用统计/排障）
export const workflowConnectorInvocationSourceEnum = pgEnum('workflow_connector_invocation_source', ['test', 'trigger', 'external', 'webhook', 'manual']);

export const workflowConnectorInvocations = pgTable('workflow_connector_invocations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  connectorId: integer().notNull().references(() => workflowConnectors.id, { onDelete: 'cascade' }),
  source: workflowConnectorInvocationSourceEnum().notNull().default('manual'),
  ok: boolean().notNull(),
  status: integer(),
  durationMs: integer().notNull().default(0),
  requestUrl: varchar({ length: 1024 }),
  error: varchar({ length: 1024 }),
  tenantId: integer(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('workflow_connector_invocations_conn_idx').on(t.connectorId, t.createdAt)]);

export type WorkflowConnectorInvocationRow = typeof workflowConnectorInvocations.$inferSelect;

// 流程仿真用例（保存的测试场景：表单数据 + 决策 + 发起人，按定义归档，供回归仿真复用）
export const workflowSimulationCases = pgTable('workflow_simulation_cases', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  definitionId: integer().notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  name: varchar({ length: 64 }).notNull(),
  /** 测试发起人（可空，空表示用当前登录用户） */
  starterUserId: integer().references(() => users.id, { onDelete: 'set null' }),
  /** 测试表单数据 */
  formData: jsonb().notNull().default(sql`'{}'::jsonb`),
  /** 仿真决策序列（逐节点 approve/reject/skip/wait + reason + formPatch） */
  decisions: jsonb().notNull().default(sql`'[]'::jsonb`),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('workflow_simulation_cases_tenant_idx').on(t.tenantId), unique('workflow_simulation_cases_name_uniq').on(t.definitionId, t.name)]);

export type WorkflowSimulationCaseRow = typeof workflowSimulationCases.$inferSelect;

// 运行中实例迁移记录（append-only）：旧版本→新版本，节点映射快照与结果
export const workflowInstanceMigrations = pgTable('workflow_instance_migrations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  instanceId: integer().notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  definitionId: integer().notNull(),
  fromVersion: integer().notNull(),
  toVersion: integer().notNull(),
  nodeMap: jsonb().notNull().default(sql`'{}'::jsonb`),
  status: varchar({ length: 16 }).notNull().default('done'),
  note: text(),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('workflow_instance_migrations_tenant_idx').on(t.tenantId), index('wf_inst_migration_idx').on(t.instanceId)]);

export type WorkflowInstanceMigrationRow = typeof workflowInstanceMigrations.$inferSelect;

export type NewWorkflowInstanceMigration = typeof workflowInstanceMigrations.$inferInsert;

// 工作流补偿/人工修复工单（catch 节点异常生成，运维手动恢复/终止）
export const workflowCompensations = pgTable('workflow_compensations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  instanceId: integer().notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  nodeKey: varchar({ length: 64 }).notNull(),
  nodeName: varchar({ length: 64 }),
  errorMessage: varchar({ length: 1024 }),
  action: varchar({ length: 16 }).notNull().default('notify'),
  status: varchar({ length: 16 }).notNull().default('pending'),
  /** 自动反向 / 兜底动作执行状态：none（无自动动作）| pending | running | succeeded | failed */
  compensationActionStatus: varchar({ length: 16 }).notNull().default('none'),
  /** 失败节点 key（用于「恢复后继续推进」时重注 token） */
  failedNodeKey: varchar({ length: 64 }),
  /** 反向 / 兜底动作配置快照（WorkflowCompensationAction），供重试与审计 */
  actionPayload: jsonb(),
  resolution: text(),
  resolvedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('workflow_compensations_tenant_idx').on(t.tenantId), index('wf_compensation_instance_idx').on(t.instanceId), index('wf_compensation_status_idx').on(t.status)]);

/** 补偿工单处理历史（时间线：备注 / 附件 / 自动动作结果 / 恢复续跑 / 放行终止） */
export const workflowCompensationLogs = pgTable('workflow_compensation_logs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  compensationId: integer().notNull().references(() => workflowCompensations.id, { onDelete: 'cascade' }),
  /** 事件类型：note（备注）| attachment | auto（自动动作结果）| retry | resume（恢复续跑）| resolve | terminate */
  action: varchar({ length: 16 }).notNull(),
  note: text(),
  /** 附件：managed_files 的 { id, name, url } 数组 */
  attachments: jsonb(),
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('workflow_compensation_logs_operator_idx').on(t.operatorId), index('workflow_compensation_logs_tenant_idx').on(t.tenantId), index('wf_compensation_log_cid_idx').on(t.compensationId)]);

export type WorkflowCompensationRow = typeof workflowCompensations.$inferSelect;

export type NewWorkflowCompensation = typeof workflowCompensations.$inferInsert;

// 流程实例
export const workflowInstances = pgTable('workflow_instances', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  definitionId: integer().notNull().references(() => workflowDefinitions.id, { onDelete: 'restrict' }),
  definitionSnapshot: jsonb().$type<WorkflowDefinitionSnapshot>().notNull(), // 发起时的定义快照
  formSnapshot: jsonb(), // 发起时的表单快照（兼容旧 WorkflowFormField[]；新数据含 fields/settings/customForm）
  title: varchar({ length: 128 }).notNull(),
  /** 业务编号/流水号（按流程定义的编号规则在发起时生成，如 BX-20260620-0001） */
  serialNo: varchar({ length: 64 }),
  formData: jsonb(), // 填写的表单数据
  status: workflowInstanceStatusEnum().default('draft').notNull(),
  /** 加急/优先级：low/normal/high/urgent（发起人设置，审批列表据此置顶） */
  priority: varchar({ length: 16 }).notNull().default('normal'),
  currentNodeKey: varchar({ length: 64 }),
  initiatorId: integer().notNull().references(() => users.id, { onDelete: 'restrict' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  /** 子流程：父实例 ID（subProcess 节点触发产生的子实例填此字段） */
  parentInstanceId: integer(),
  /** 子流程：父实例中触发本子流程的 subProcess 任务 ID，子实例完成时用于唤醒父任务 */
  parentTaskId: integer(),
  /** 子流程多实例：父任务下当前循环项的幂等 key */
  parentTaskItemKey: varchar({ length: 128 }),
  /** 子流程多实例：父任务下当前循环项的序号（0-based） */
  parentTaskItemIndex: integer(),
  /** 业务实体接入：业务类型（如 biz_leave），普通流程为空 */
  bizType: varchar({ length: 64 }),
  /** 业务实体接入：业务记录主键（字符串，兼容各类业务 PK），与 bizType 组成 businessKey */
  bizId: varchar({ length: 64 }),
  /** 挂起时间（status=suspended 时有值，恢复后清空） */
  suspendedAt: timestamp(),
  /** 挂起原因（管理员填写） */
  suspendReason: varchar({ length: 500 }),
  // ─── 审批单归档件：终态时按流程设置自动生成的 PDF（不可变存证），文件删除时解绑 ───
  archiveFileId: pgUuid().references(() => managedFiles.id, { onDelete: 'set null' }),
  /** 归档件 SHA-256（hex），验真页与下载校验比对 */
  archiveSha256: varchar({ length: 64 }),
  /** 归档时使用的打印模板；null = 按表单快照自动版式 */
  archiveTemplateId: integer(),
  archivedAt: timestamp({ withTimezone: true }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('workflow_instances_definition_idx').on(t.definitionId), 
  // 业务键租户内唯一（仅活跃实例）：终态（approved/rejected/withdrawn/cancelled）实例不占用业务键，
  // 允许业务记录被驳回/撤回后重新发起；returned（退回待修改重提）仍占用业务键——重提是同一行
  // 的 UPDATE（returned→running），不会与自身冲突。状态列表与 shared WORKFLOW_ACTIVE_INSTANCE_STATUSES 保持一致。
  // tenant_id 可空（平台级/单租户数据），用 coalesce 归一为 0 保证空租户下依旧防重
  uniqueIndex('workflow_instances_biz_key_uniq')
    .on(sql`coalesce(${t.tenantId}, 0)`, t.bizType, t.bizId)
    .where(sql`${t.status} in ('draft', 'running', 'suspended', 'returned')`),
  uniqueIndex('workflow_instances_parent_task_item_key_idx').on(t.parentTaskId, t.parentTaskItemKey),
  // 全局监控 / 租户视角列表的高频组合条件
  index('workflow_instances_tenant_status_idx').on(t.tenantId, t.status),
  // 我的申请 / 交接扫描按发起人过滤的高频组合条件
  index('workflow_instances_initiator_status_idx').on(t.initiatorId, t.status),
]);

export type WorkflowInstanceRow = typeof workflowInstances.$inferSelect;

export type NewWorkflowInstance = typeof workflowInstances.$inferInsert;

// 审批任务
export const workflowTasks = pgTable('workflow_tasks', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  instanceId: integer().notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  nodeKey: varchar({ length: 64 }).notNull(),
  nodeName: varchar({ length: 64 }).notNull(),
  nodeType: workflowNodeTypeEnum(),
  assigneeId: integer().references(() => users.id, { onDelete: 'set null' }),
  status: workflowTaskStatusEnum().default('pending').notNull(),
  comment: text(),
  /** 手写签名（data URL / 图片地址，审批通过时若节点要求签名则写入） */
  signature: text(),
  /** 审批附件（[{name,url,size}]，审批通过时上传） */
  attachments: jsonb().$type<Array<{ name: string; url: string; size?: number }>>(),
  actionAt: timestamp({ withTimezone: true }),
  /** 顺序会签中的顺序（0-based），非顺序场景为 null */
  taskOrder: integer(),
  /** 多人审批方式（仅同一 nodeKey 多 task 时生效） */
  approveMethod: workflowApproveMethodEnum(),
  /** 比例会签阈值（1–100 百分比），仅 approveMethod='ratio' 时有意义 */
  approveRatio: integer(),
  /** 外部审批：回调 ID（task.status='waiting' 期间有效；派发/恢复由 workflow_jobs 接管） */
  externalCallbackId: varchar({ length: 64 }).unique('workflow_tasks_external_callback_id_unique'),
  /** 子流程（multi 多实例）：期望子实例总数（仅 subProcess 多实例 waiting 任务有值；单实例/非子流程为 null） */
  subTotal: integer(),
  /** 子流程（multi 多实例）：已结束的子实例数（用于汇聚 join 判定） */
  subDone: integer().default(0).notNull(),
  /** 任务最初的处理人（创建时快照，转办/委派不会修改） */
  originalAssigneeId: integer().references(() => users.id, { onDelete: 'set null' }),
  /** 委派来源（仅委派时设置，原 assignee 接手时清空） */
  delegatedFromId: integer().references(() => users.id, { onDelete: 'set null' }),
  /** 委派模式快照（分派时固化）：full=代理人直接代批；suggest=建议制回执；非委派任务为 null */
  delegationMode: varchar({ length: 16 }).$type<'full' | 'suggest'>(),
  /** 加签类型（before/after/parallel，非加签任务为 null）；before 挂起原任务的恢复判定依赖此列，禁止用 comment 前缀判定 */
  signType: varchar({ length: 8 }).$type<'before' | 'after' | 'parallel' | 'excluded'>(),
  /** 退回模式 backToOrigin：被退回任务记录发起退回的来源节点 key，通过后直接跳回该节点 */
  returnOriginNodeKey: varchar({ length: 64 }),
  /** 节点激活轮次 ID（同一次进入节点创建的一批任务共享；重入节点生成新值，完成判定只统计当前轮） */
  activationId: varchar({ length: 36 }).notNull(),
  /** 抄送已读时间（仅 ccNode 任务有意义；null 表示未读） */
  ccReadAt: timestamp({ withTimezone: true }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  // 会签完成检查 / 详情任务加载 / 待办扫描的高频组合条件
  index('workflow_tasks_instance_status_idx').on(t.instanceId, t.status),
  // 待我审批 / 我已办按处理人过滤的高频组合条件
  index('workflow_tasks_assignee_status_idx').on(t.assigneeId, t.status),
  // 运行时不变量：同一激活轮内同一节点、同一处理人至多一个活动任务。
  // 物理杜绝「驳回重提 / 转办 / 加签 / 委派回执」等路径残留或重复创建活动任务
  // （抄送等无阻塞语义任务为 skipped，外部审批 / 延时等无处理人任务 assignee 为空，均不在谓词内）
  uniqueIndex('wf_tasks_active_uniq')
    .on(t.instanceId, t.nodeKey, t.activationId, t.assigneeId)
    .where(sql`${t.status} in ('pending', 'waiting') and ${t.assigneeId} is not null`),
]);

export type WorkflowTaskRow = typeof workflowTasks.$inferSelect;

export type NewWorkflowTask = typeof workflowTasks.$inferInsert;

/** 转办动作类型：转办 / 委派 / 管理员改派 / 离职交接 / 超时升级转交 */
export const workflowTaskTransferActionEnum = pgEnum('workflow_task_transfer_action', ['transfer', 'delegate', 'reassign', 'handover', 'timeout']);

// 任务转办明细（替代原 transfer_chain 数组：完整回答"谁在何时因何把任务交给了谁"）
export const workflowTaskTransfers = pgTable('workflow_task_transfers', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  taskId: integer().notNull().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  instanceId: integer().notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  /** 移出方（系统超时转交等场景可能无原处理人） */
  fromUserId: integer().references(() => users.id, { onDelete: 'set null' }),
  /** 接收方 */
  toUserId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: workflowTaskTransferActionEnum().notNull(),
  reason: varchar({ length: 500 }),
  /** 操作人（本人转办=fromUserId；管理员改派/交接=管理员；系统超时=null） */
  operatorId: integer().references(() => users.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('workflow_task_transfers_operator_idx').on(t.operatorId), index('workflow_task_transfers_tenant_idx').on(t.tenantId), 
  index('wf_task_transfers_task_idx').on(t.taskId),
  index('wf_task_transfers_instance_idx').on(t.instanceId),
]);

export type WorkflowTaskTransferRow = typeof workflowTaskTransfers.$inferSelect;

// ─── 显式执行 Token（活动路径 / 网关汇聚的权威来源）──────────────────────────
// 每条活动执行路径 = 一行 token。替代"扫已完成任务行 + 重算 BFS"的隐式推导：
// fork 沿 branchPath 压入一帧分支栈、产生多条兄弟 token；join 在同组分支全部 parked
// 后消费它们并产出 1 条续接 token（弹出栈顶帧），构成可观测、可重放的执行树。
export const workflowTokens = pgTable('workflow_tokens', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  instanceId: integer().notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  /** token 当前停留的节点 key（frontier 人工/等待节点，或 parked 的网关 join 节点） */
  nodeKey: varchar({ length: 64 }).notNull(),
  status: workflowTokenStatusEnum().notNull().default('active'),
  /**
   * 分支栈：每帧 { id: fork 分支组 id, index: 组内序号, total: 组内分支数 }。
   * 空数组 = 主路径；fork 压栈、join 弹栈。join 汇聚判定 = 同 (父栈 + 帧 id) 下
   * total 个 index 全部 parked。自包含，无需回溯父 token。
   */
  branchPath: jsonb().$type<Array<{ id: string; index: number; total: number }>>().notNull().default([]),
  /** fork 处被消费的前驱 token（血缘/可观测，best-effort，可空） */
  parentTokenId: integer(),
  /** 子流程/多实例项作用域（预留） */
  scopeKey: varchar({ length: 128 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...timestampColumns(),
  consumedAt: timestamp(),
}, (t) => [index('workflow_tokens_tenant_idx').on(t.tenantId), 
  index('workflow_tokens_instance_status_idx').on(t.instanceId, t.status),
  index('workflow_tokens_parent_idx').on(t.parentTokenId),
  // 运行时不变量：同一实例、同一节点、同一分支路径至多一个活动 token，
  // 物理杜绝重复物化 / 清场遗漏导致的重复执行路径
  uniqueIndex('wf_tokens_active_uniq')
    .on(t.instanceId, t.nodeKey, t.branchPath)
    .where(sql`${t.status} = 'active'`),
]);

export type WorkflowTokenRow = typeof workflowTokens.$inferSelect;

export type NewWorkflowToken = typeof workflowTokens.$inferInsert;

// 任务催办记录：发起人或管理员对 pending 任务的催办流水
export const workflowTaskUrges = pgTable('workflow_task_urges', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  taskId: integer().notNull().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  instanceId: integer().notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  urgerId: integer().references(() => users.id, { onDelete: 'set null' }),
  urgerName: varchar({ length: 64 }),
  message: varchar({ length: 256 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('workflow_task_urges_task_idx').on(t.taskId), index('workflow_task_urges_instance_idx').on(t.instanceId)]);

export type WorkflowTaskUrgeRow = typeof workflowTaskUrges.$inferSelect;

export type NewWorkflowTaskUrge = typeof workflowTaskUrges.$inferInsert;

// ─── 工作流事件订阅 / 投递 / 触发器执行 ─────────────────────────────────────
export const workflowEventSubscriptions = pgTable('workflow_event_subscriptions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  description: varchar({ length: 256 }),
  /** 为 null 表示订阅全部流程；否则仅订阅指定流程 */
  definitionId: integer().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  /** 订阅的事件类型列表 */
  events: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  url: varchar({ length: 512 }).notNull(),
  /** HMAC 密钥（AES-256-GCM 加密存储，经 lib/secret-crypto） */
  secretEncrypted: text(),
  signMode: workflowEventSignModeEnum().default('hmacSha256').notNull(),
  /** 自定义请求头，JSON 字符串 */
  headers: text(),
  /** 经连接器投递：引用 http 连接器 id（设置后由连接器提供基础地址/鉴权/超时/重试/熔断，url 退化为相对路径） */
  connectorId: integer().references(() => workflowConnectors.id, { onDelete: 'set null' }),
  enabled: boolean().default(true).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  updatedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().notNull(),
}, (t) => [index('workflow_event_subscriptions_definition_idx').on(t.definitionId), index('workflow_event_subscriptions_tenant_idx').on(t.tenantId)]);

export type WorkflowEventSubscriptionRow = typeof workflowEventSubscriptions.$inferSelect;

export type NewWorkflowEventSubscription = typeof workflowEventSubscriptions.$inferInsert;

// ─── 工作流统一作业账本 ────────────────────────────────────────────────────────
// 所有"系统级异步动作"（delay 唤醒 / 审批超时 / 触发器派发 / 外部审批派发 /
// 子流程发起·汇聚 / 事件派发 / Webhook 投递）统一落到本表，由统一 Worker 消费。
// 统一作业账本：延时唤醒、超时、触发器派发、外部审批派发、子流程、事件派发、Webhook 投递与补偿动作
// 以及 workflow_tasks 上的 trigger*/external*/wakeAt/timeout* 调度列。
export const workflowJobs = pgTable('workflow_jobs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 作业类型，决定派发到哪个 handler */
  jobType: workflowJobTypeEnum().notNull(),
  status: workflowJobStatusEnum().notNull().default('pending'),
  /** 关联运行态（纯事件派发可空） */
  instanceId: integer().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  taskId: integer().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  nodeKey: varchar({ length: 64 }),
  /** 幂等键（如 delay:{taskId} / trigger:{taskId}:{attempt} / event:{eventId}），唯一去重 */
  idempotencyKey: varchar({ length: 160 }).unique('workflow_jobs_idempotency_key_unique'),
  /** 贯穿一次推进的所有异步动作，串起任务/事件/触发器/Webhook/子流程 */
  traceId: varchar({ length: 64 }),
  /** 因果父引用（`kind:refId` 或 `request`），链路时间线树形展示的触发源 */
  parentRef: varchar({ length: 32 }),
  /** 执行所需的上下文（事件 payload / 触发器配置 / 子流程参数等） */
  payload: jsonb().notNull().default(sql`'{}'::jsonb`),
  /** 优先级（复用实例 priority：low/normal/high/urgent，数值越小越先） */
  priority: integer().notNull().default(100),
  /** 已尝试次数 */
  attempts: integer().notNull().default(0),
  /** 最大尝试次数（超过进死信） */
  maxAttempts: integer().notNull().default(1),
  generation: integer().notNull().default(0),
  operationKey: varchar({ length: 64 }).notNull().default(sql`gen_random_uuid()::text`),
  executionTimeoutMs: integer().notNull().default(600_000),
  /** 何时应执行（delay=wakeAt、timeout=timeoutAt、retry=退避时间） */
  runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** 领取锁定时间（FOR UPDATE SKIP LOCKED 领取后写入，用于识别卡死 running） */
  lockedAt: timestamp({ withTimezone: true }),
  /** 领取者标识（worker/进程） */
  lockedBy: varchar({ length: 64 }),
  leaseToken: varchar({ length: 64 }),
  leaseUntil: timestamp({ withTimezone: true }),
  executionDeadline: timestamp({ withTimezone: true }),
  pausedRemainingMs: bigint({ mode: 'number' }),
  /** 最近一次错误 */
  lastError: text(),
  /** 执行结果（成功时写入，供审计/串联） */
  result: jsonb(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('workflow_jobs_task_idx').on(t.taskId), index('workflow_jobs_tenant_idx').on(t.tenantId), 
  index('workflow_jobs_due_idx').on(t.status, t.runAt),
  index('workflow_jobs_lease_idx').on(t.status, t.leaseUntil),
  index('workflow_jobs_type_status_idx').on(t.jobType, t.status),
  index('workflow_jobs_trace_idx').on(t.traceId),
  index('workflow_jobs_instance_idx').on(t.instanceId),
]);

export type WorkflowJobRow = typeof workflowJobs.$inferSelect;

export type NewWorkflowJob = typeof workflowJobs.$inferInsert;

// 作业每一次执行尝试的审计日志（取代 workflow_trigger_executions，泛化到所有 jobType）
export const workflowJobExecutions = pgTable('workflow_job_executions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  jobId: integer().notNull().references(() => workflowJobs.id, { onDelete: 'cascade' }),
  jobType: workflowJobTypeEnum().notNull(),
  attempt: integer().notNull().default(0),
  generation: integer().notNull().default(0),
  leaseToken: varchar({ length: 64 }).notNull().default(sql`gen_random_uuid()::text`),
  status: workflowJobExecutionStatusEnum().notNull().default('running'),
  /** HTTP 类作业（trigger/external/webhook）的请求/响应明细 */
  requestUrl: varchar({ length: 512 }),
  requestMethod: varchar({ length: 16 }),
  requestBody: text(),
  responseStatus: integer(),
  responseBody: text(),
  errorMessage: text(),
  durationMs: integer(),
  startedAt: timestamp({ withTimezone: true }),
  finishedAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'set null' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('workflow_job_executions_tenant_idx').on(t.tenantId), 
  index('workflow_job_executions_job_idx').on(t.jobId, t.attempt),
  uniqueIndex('workflow_job_executions_lease_token_unique').on(t.leaseToken),
  index('workflow_job_executions_type_idx').on(t.jobType, t.status),
]);

export type WorkflowJobExecutionRow = typeof workflowJobExecutions.$inferSelect;

export type NewWorkflowJobExecution = typeof workflowJobExecutions.$inferInsert;

// ─── 流程评论 / 沟通时间线 ────────────────────────────────────────────────────
// 审批人 / 抄送人 / 发起人均可在实例下自由留言（不影响审批流转），支持 @ 提及
export const workflowComments = pgTable('workflow_comments', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  instanceId: integer().notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  /** 关联的任务（在某审批任务上下文中评论时填写，可为空） */
  taskId: integer().references(() => workflowTasks.id, { onDelete: 'set null' }),
  /** 回复引用的父评论（楼中楼一层引用，父删除后置空保留本条） */
  parentId: integer().references((): AnyPgColumn => workflowComments.id, { onDelete: 'set null' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text().notNull(),
  /** @ 提及的用户 ID 列表 */
  mentions: jsonb().$type<number[]>().default([]).notNull(),
  /** 附件列表（{ name, url, size? }[]） */
  attachments: jsonb().$type<Array<{ name: string; url: string; size?: number }>>().default([]).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('workflow_comments_task_idx').on(t.taskId), index('workflow_comments_parent_idx').on(t.parentId), index('workflow_comments_instance_idx').on(t.instanceId), index('workflow_comments_user_idx').on(t.userId), index('workflow_comments_tenant_idx').on(t.tenantId)]);

export type WorkflowCommentRow = typeof workflowComments.$inferSelect;

export type NewWorkflowComment = typeof workflowComments.$inferInsert;

// ─── 审批意见常用语 ───────────────────────────────────────────────────────────
// userId 为 null 表示系统预置（所有人可见）；否则为个人常用语
export const workflowQuickPhrases = pgTable('workflow_quick_phrases', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer().references(() => users.id, { onDelete: 'cascade' }),
  content: varchar({ length: 255 }).notNull(),
  sort: integer().default(0).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...timestampColumns(),
}, (t) => [index('workflow_quick_phrases_user_idx').on(t.userId), index('workflow_quick_phrases_tenant_idx').on(t.tenantId)]);

export type WorkflowQuickPhraseRow = typeof workflowQuickPhrases.$inferSelect;

export type NewWorkflowQuickPhrase = typeof workflowQuickPhrases.$inferInsert;

// ─── 审批代理 / 离岗委托 ──────────────────────────────────────────────────────
// principal 在 [startAt, endAt] 区间内（或永久）将其待审批任务自动转交给 delegate
export const workflowDelegations = pgTable('workflow_delegations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 委托人（被代理人）：其待办将被转交 */
  principalId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 代理人（受托人）：接收待办 */
  delegateId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 限定的流程定义（为 null 表示对全部流程生效） */
  definitionId: integer().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  /** 代理模式：full=代理人直接代批（默认）；suggest=建议制，代理人意见回执给委托人确认 */
  mode: varchar({ length: 16 }).$type<'full' | 'suggest'>().notNull().default('full'),
  reason: varchar({ length: 255 }),
  /** 生效开始时间（为 null 表示立即生效） */
  startAt: timestamp({ withTimezone: true }),
  /** 生效结束时间（为 null 表示长期有效） */
  endAt: timestamp({ withTimezone: true }),
  enabled: boolean().default(true).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('workflow_delegations_definition_idx').on(t.definitionId), index('workflow_delegations_tenant_idx').on(t.tenantId)]);

export type WorkflowDelegationRow = typeof workflowDelegations.$inferSelect;

export type NewWorkflowDelegation = typeof workflowDelegations.$inferInsert;

// ─── 业务编号计数器 ───────────────────────────────────────────────────────────
// 每个流程定义 + 周期键（如 '20260620' / 'ALL'）维护一个自增序列，原子自增防并发
export const workflowSerialCounters = pgTable('workflow_serial_counters', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  definitionId: integer().notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  periodKey: varchar({ length: 16 }).notNull(),
  seq: integer().default(0).notNull(),
}, (t) => [unique('workflow_serial_counters_def_period_uniq').on(t.definitionId, t.periodKey)]);

export type WorkflowSerialCounterRow = typeof workflowSerialCounters.$inferSelect;

export type NewWorkflowSerialCounter = typeof workflowSerialCounters.$inferInsert;

// ─── 流程模板库 ───────────────────────────────────────────────────────────────
export const workflowTemplates = pgTable('workflow_templates', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  code: varchar({ length: 64 }),
  description: text(),
  categoryName: varchar({ length: 64 }),
  icon: varchar({ length: 64 }),
  color: varchar({ length: 16 }),
  /** 流程图数据（React Flow / process JSON），克隆时写入新流程定义的 flowData */
  flowData: jsonb(),
  /** 表单结构（{ fields, settings }），克隆时创建对应表单 */
  formSchema: jsonb(),
  sort: integer().default(0).notNull(),
  /** 系统内置模板（不可删除） */
  builtin: boolean().default(false).notNull(),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('workflow_templates_tenant_idx').on(t.tenantId), unique('workflow_templates_code_uniq').on(t.code)]);

export type WorkflowTemplateRow = typeof workflowTemplates.$inferSelect;

export type NewWorkflowTemplate = typeof workflowTemplates.$inferInsert;

// ─── 审批协办 / 邀请处理意见 ──────────────────────────────────────────────────
export const workflowTaskConsultStatusEnum = pgEnum('workflow_task_consult_status', ['pending', 'replied', 'revoked']);

export const workflowTaskConsults = pgTable('workflow_task_consults', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  taskId: integer().notNull().references(() => workflowTasks.id, { onDelete: 'cascade' }),
  instanceId: integer().notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  /** 发起协办的审批人 */
  inviterId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 被邀请协办的人 */
  consulteeId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  question: varchar({ length: 500 }),
  opinion: text(),
  status: workflowTaskConsultStatusEnum().default('pending').notNull(),
  repliedAt: timestamp({ withTimezone: true }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('workflow_task_consults_task_idx').on(t.taskId), index('workflow_task_consults_instance_idx').on(t.instanceId), index('workflow_task_consults_tenant_idx').on(t.tenantId)]);

export type WorkflowTaskConsultRow = typeof workflowTaskConsults.$inferSelect;

export type NewWorkflowTaskConsult = typeof workflowTaskConsults.$inferInsert;
