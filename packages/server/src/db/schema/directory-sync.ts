import { pgTable, varchar, timestamp, pgEnum, integer, boolean, unique, text, index, jsonb } from 'drizzle-orm/pg-core';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants, users, departments } from './core';
import { tenantIdentityProviders } from './identity-providers';

export const directorySyncSourceTypeEnum = pgEnum('directory_sync_source_type', ['ldap', 'dingtalk', 'wechat_work', 'feishu', 'scim']);

export const directorySyncRunStatusEnum = pgEnum('directory_sync_run_status', ['running', 'success', 'partial', 'failed', 'aborted']);

export const directorySyncConflictStatusEnum = pgEnum('directory_sync_conflict_status', ['pending', 'resolved', 'ignored']);

/** 生命周期策略：源侧消失/离职人员的处置方式 */
export interface DirectorySyncLifecycleConfig {
  /** 源侧消失或停用时是否禁用本地账号 */
  disableOnLeave: boolean;
  /** 禁用账号时是否强制下线其全部会话 */
  kickSessions: boolean;
  /** 新建账号时授予的默认角色 */
  defaultRoleIds: number[];
}

/** 同步范围：为空表示全量 */
export interface DirectorySyncScopeConfig {
  /** 仅同步这些外部部门（含子树）；空数组或缺省 = 全部 */
  deptExternalIds?: string[];
  /** 排除的外部用户 ID */
  excludeUserExternalIds?: string[];
}

// ─── 同步源配置 ───────────────────────────────────────────────────────────────
export const directorySyncSources = pgTable('directory_sync_sources', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  type: directorySyncSourceTypeEnum().notNull(),
  status: statusEnum().notNull().default('disabled'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  /** LDAP/AD 源：绑定企业身份源（凭证与连接信息的单一事实源） */
  identityProviderId: integer().references(() => tenantIdentityProviders.id, { onDelete: 'set null' }),
  /** 平台 API 源：绑定 OAuth 配置的 provider（如 'dingtalk'），凭证从 oauth_configs 读取 */
  oauthProvider: varchar({ length: 32 }),
  /** 企业微信通讯录 Secret（独立于应用 Secret，仅同步使用） */
  contactSecret: text(),
  /** 平台回调 Token / SCIM Bearer Token */
  callbackToken: text(),
  /** 平台回调 AES Key（钉钉/企微加密模式 43 位；飞书 Encrypt Key） */
  callbackAesKey: text(),
  /** 回调 / SCIM URL 的随机路径段（防探测） */
  callbackUrlKey: varchar({ length: 64 }),
  /** 收到平台回调事件后置位，由调度 tick 消费并触发一次同步 */
  pendingCallbackSync: boolean().notNull().default(false),
  callbackLastEventAt: timestamp({ withTimezone: true }),
  /** 匹配键：未建立绑定的外部用户按此字段匹配本地账号 */
  matchKey: varchar({ length: 16 }).notNull().default('phone'),
  /** 字段映射覆盖（外部字段 → 本地字段），为空使用连接器默认映射 */
  fieldMapping: jsonb().$type<Record<string, string>>().notNull().default({}),
  scopeConfig: jsonb().$type<DirectorySyncScopeConfig>().notNull().default({}),
  /** 冲突策略：source=源覆盖本地 / local=保留本地 / suspend=挂起人工裁决 */
  conflictPolicy: varchar({ length: 16 }).notNull().default('suspend'),
  lifecycle: jsonb().$type<DirectorySyncLifecycleConfig>().notNull().default({
    disableOnLeave: true,
    kickSessions: true,
    defaultRoleIds: [],
  }),
  /** 是否同步部门树 */
  syncDepartments: boolean().notNull().default(true),
  /** 定时表达式；为空表示仅手动同步 */
  cronExpression: varchar({ length: 64 }),
  /** 熔断阈值：单次计划禁用人数占已绑定人数的百分比超过该值时中止同步 */
  circuitBreakerPercent: integer().notNull().default(30),
  nextRunAt: timestamp({ withTimezone: true }),
  lastRunAt: timestamp({ withTimezone: true }),
  lastRunStatus: directorySyncRunStatusEnum(),
  remark: text(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('directory_sync_sources_tenant_name_unique').on(t.tenantId, t.name),
  unique('directory_sync_sources_callback_key_unique').on(t.callbackUrlKey),
  index('directory_sync_sources_status_idx').on(t.status),
]);

export type DirectorySyncSourceRow = typeof directorySyncSources.$inferSelect;

export type NewDirectorySyncSource = typeof directorySyncSources.$inferInsert;

// ─── 同步运行记录（追加型日志，不加审计列）──────────────────────────────────────
export const directorySyncRuns = pgTable('directory_sync_runs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  sourceId: integer().notNull().references(() => directorySyncSources.id, { onDelete: 'cascade' }),
  triggerType: varchar({ length: 16 }).notNull().default('manual'),
  /** 预览模式：只计算差异不落库 */
  dryRun: boolean().notNull().default(false),
  status: directorySyncRunStatusEnum().notNull().default('running'),
  totalFetched: integer().notNull().default(0),
  deptCreated: integer().notNull().default(0),
  deptUpdated: integer().notNull().default(0),
  userCreated: integer().notNull().default(0),
  userLinked: integer().notNull().default(0),
  userUpdated: integer().notNull().default(0),
  userDisabled: integer().notNull().default(0),
  skipped: integer().notNull().default(0),
  conflictCount: integer().notNull().default(0),
  failedCount: integer().notNull().default(0),
  message: text(),
  errorMessage: text(),
  triggeredBy: integer().references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp({ withTimezone: true }).notNull(),
  finishedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('directory_sync_runs_source_idx').on(t.sourceId),
  index('directory_sync_runs_status_idx').on(t.status),
]);

export type DirectorySyncRunRow = typeof directorySyncRuns.$inferSelect;

export type NewDirectorySyncRun = typeof directorySyncRuns.$inferInsert;

// ─── 运行明细（每个对象的变更动作与字段 diff）───────────────────────────────────
export const directorySyncRunItems = pgTable('directory_sync_run_items', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  runId: integer().notNull().references(() => directorySyncRuns.id, { onDelete: 'cascade' }),
  entityType: varchar({ length: 16 }).notNull(),
  externalId: varchar({ length: 256 }).notNull(),
  name: varchar({ length: 128 }),
  action: varchar({ length: 16 }).notNull(),
  /** 是否已实际落库（dryRun 或失败时为 false） */
  applied: boolean().notNull().default(false),
  /** 字段级差异：{ 字段: { from, to } } */
  diff: jsonb().$type<Record<string, { from: unknown; to: unknown }> | null>(),
  message: text(),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  index('directory_sync_run_items_run_idx').on(t.runId),
  index('directory_sync_run_items_action_idx').on(t.action),
]);

export type DirectorySyncRunItemRow = typeof directorySyncRunItems.$inferSelect;

export type NewDirectorySyncRunItem = typeof directorySyncRunItems.$inferInsert;

// ─── 冲突挂起队列 ─────────────────────────────────────────────────────────────
export const directorySyncConflicts = pgTable('directory_sync_conflicts', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  sourceId: integer().notNull().references(() => directorySyncSources.id, { onDelete: 'cascade' }),
  runId: integer().references(() => directorySyncRuns.id, { onDelete: 'set null' }),
  entityType: varchar({ length: 16 }).notNull(),
  externalId: varchar({ length: 256 }).notNull(),
  name: varchar({ length: 128 }),
  /** multi_match=匹配到多个本地账号；field_conflict=两侧字段均有修改 */
  conflictType: varchar({ length: 32 }).notNull(),
  sourceData: jsonb().$type<Record<string, unknown> | null>(),
  localData: jsonb().$type<Record<string, unknown> | null>(),
  /** multi_match 时的候选本地用户 */
  candidateUserIds: jsonb().$type<number[]>().notNull().default([]),
  status: directorySyncConflictStatusEnum().notNull().default('pending'),
  /** 裁决方式：source / local / manual / ignored */
  resolution: varchar({ length: 16 }),
  resolvedBy: integer().references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp({ withTimezone: true }),
  ...timestampColumns(),
}, (t) => [
  index('directory_sync_conflicts_source_idx').on(t.sourceId),
  index('directory_sync_conflicts_status_idx').on(t.status),
]);

export type DirectorySyncConflictRow = typeof directorySyncConflicts.$inferSelect;

export type NewDirectorySyncConflict = typeof directorySyncConflicts.$inferInsert;

// ─── 用户绑定表（外部用户 ↔ 本地用户，externalData 存上次源侧快照用于三方对比）──
export const directorySyncUserLinks = pgTable('directory_sync_user_links', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  sourceId: integer().notNull().references(() => directorySyncSources.id, { onDelete: 'cascade' }),
  externalId: varchar({ length: 256 }).notNull(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  externalData: jsonb().$type<Record<string, unknown> | null>(),
  lastSeenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  ...timestampColumns(),
}, (t) => [
  unique('directory_sync_user_links_source_external_unique').on(t.sourceId, t.externalId),
  unique('directory_sync_user_links_source_user_unique').on(t.sourceId, t.userId),
  index('directory_sync_user_links_user_idx').on(t.userId),
]);

export type DirectorySyncUserLinkRow = typeof directorySyncUserLinks.$inferSelect;

export type NewDirectorySyncUserLink = typeof directorySyncUserLinks.$inferInsert;

// ─── 部门绑定表（外部部门 ↔ 本地部门）──────────────────────────────────────────
export const directorySyncDeptLinks = pgTable('directory_sync_dept_links', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  sourceId: integer().notNull().references(() => directorySyncSources.id, { onDelete: 'cascade' }),
  externalId: varchar({ length: 256 }).notNull(),
  departmentId: integer().notNull().references(() => departments.id, { onDelete: 'cascade' }),
  lastSeenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  ...timestampColumns(),
}, (t) => [
  unique('directory_sync_dept_links_source_external_unique').on(t.sourceId, t.externalId),
  index('directory_sync_dept_links_department_idx').on(t.departmentId),
]);

export type DirectorySyncDeptLinkRow = typeof directorySyncDeptLinks.$inferSelect;

export type NewDirectorySyncDeptLink = typeof directorySyncDeptLinks.$inferInsert;
