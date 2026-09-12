import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, dateRangeQuery, entityStatusQuery, entityStatusSchema, idParam, idQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import {
  DIRECTORY_SYNC_CONFLICT_POLICIES,
  DIRECTORY_SYNC_CONFLICT_STATUSES,
  DIRECTORY_SYNC_CONFLICT_TYPES,
  DIRECTORY_SYNC_ENTITY_TYPES,
  DIRECTORY_SYNC_ITEM_ACTIONS,
  DIRECTORY_SYNC_MATCH_KEYS,
  DIRECTORY_SYNC_RESOLUTIONS,
  DIRECTORY_SYNC_RUN_STATUSES,
  DIRECTORY_SYNC_SOURCE_TYPES,
  DIRECTORY_SYNC_TRIGGER_TYPES,
} from '../constants';
import { createDirectorySyncSourceSchema, resolveDirectorySyncConflictSchema, updateDirectorySyncSourceSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 同步源的生命周期策略 */
const lifecycleSchema = z.object({
  disableOnLeave: z.boolean().meta({ description: '源侧消失或停用时禁用本地账号' }),
  kickSessions: z.boolean().meta({ description: '禁用账号时强制下线其全部会话' }),
  defaultRoleIds: z.array(z.int()).meta({ description: '新建账号授予的默认角色' }),
});

export type DirectorySyncLifecycle = z.infer<typeof lifecycleSchema>;

/** 同步范围（为空 = 全量） */
const scopeSchema = z.object({
  deptExternalIds: z.array(z.string()).optional(),
  excludeUserExternalIds: z.array(z.string()).optional(),
});

export type DirectorySyncScope = z.infer<typeof scopeSchema>;

export const directorySyncSourceSchema = z.object({
  id: z.int(),
  name: z.string(),
  type: z.enum(DIRECTORY_SYNC_SOURCE_TYPES),
  status: entityStatusSchema,
  tenantId: z.int().nullable(),
  identityProviderId: z.int().nullable().meta({ description: 'LDAP/AD 源绑定的企业身份源' }),
  identityProviderName: z.string().nullable().optional(),
  oauthProvider: z.string().nullable().meta({ description: '平台 API 源绑定的 OAuth provider（如 dingtalk）' }),
  matchKey: z.enum(DIRECTORY_SYNC_MATCH_KEYS),
  fieldMapping: z.record(z.string(), z.string()).meta({ description: '字段映射：本地字段 → 源侧标准字段或 __ignore__（不同步）' }),
  scopeConfig: scopeSchema,
  conflictPolicy: z.enum(DIRECTORY_SYNC_CONFLICT_POLICIES),
  lifecycle: lifecycleSchema,
  syncDepartments: z.boolean(),
  cronExpression: z.string().nullable(),
  circuitBreakerPercent: z.int(),
  contactSecretSet: z.boolean().optional().meta({ description: '企业微信通讯录 Secret 是否已配置（明文不回显）' }),
  callbackTokenSet: z.boolean().optional().meta({ description: '回调 Token / SCIM Bearer Token 是否已配置（明文不回显）' }),
  callbackAesKeySet: z.boolean().optional().meta({ description: '回调 AES Key 是否已配置（明文不回显）' }),
  callbackUrlKey: z.string().nullable().meta({ description: '回调 / SCIM URL 的随机路径段' }),
  callbackLastEventAt: z.string().nullable().meta({ description: '最近一次收到平台回调事件的时间' }),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.enum(DIRECTORY_SYNC_RUN_STATUSES).nullable(),
  remark: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DirectorySyncSource' });

export type DirectorySyncSource = z.infer<typeof directorySyncSourceSchema>;

export const directorySyncRunSchema = z.object({
  id: z.int(),
  sourceId: z.int(),
  sourceName: z.string().nullable().optional(),
  triggerType: z.enum(DIRECTORY_SYNC_TRIGGER_TYPES),
  dryRun: z.boolean(),
  status: z.enum(DIRECTORY_SYNC_RUN_STATUSES),
  totalFetched: z.int(),
  deptCreated: z.int(),
  deptUpdated: z.int(),
  userCreated: z.int(),
  userLinked: z.int(),
  userUpdated: z.int(),
  userDisabled: z.int(),
  skipped: z.int(),
  conflictCount: z.int(),
  failedCount: z.int(),
  message: z.string().nullable(),
  errorMessage: z.string().nullable(),
  triggeredBy: z.int().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'DirectorySyncRun' });

export type DirectorySyncRun = z.infer<typeof directorySyncRunSchema>;

export const directorySyncRunItemSchema = z.object({
  id: z.int(),
  runId: z.int(),
  entityType: z.enum(DIRECTORY_SYNC_ENTITY_TYPES),
  externalId: z.string(),
  name: z.string().nullable(),
  action: z.enum(DIRECTORY_SYNC_ITEM_ACTIONS),
  applied: z.boolean(),
  diff: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })).nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'DirectorySyncRunItem' });

export type DirectorySyncRunItem = z.infer<typeof directorySyncRunItemSchema>;

export const directorySyncConflictSchema = z.object({
  id: z.int(),
  sourceId: z.int(),
  sourceName: z.string().nullable().optional(),
  runId: z.int().nullable(),
  entityType: z.enum(DIRECTORY_SYNC_ENTITY_TYPES),
  externalId: z.string(),
  name: z.string().nullable(),
  conflictType: z.enum(DIRECTORY_SYNC_CONFLICT_TYPES),
  sourceData: z.record(z.string(), z.unknown()).nullable(),
  localData: z.record(z.string(), z.unknown()).nullable(),
  candidateUserIds: z.array(z.int()),
  status: z.enum(DIRECTORY_SYNC_CONFLICT_STATUSES),
  resolution: z.enum(DIRECTORY_SYNC_RESOLUTIONS).nullable(),
  resolvedBy: z.int().nullable(),
  resolvedByNickname: z.string().nullable().optional(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DirectorySyncConflict' });

export type DirectorySyncConflict = z.infer<typeof directorySyncConflictSchema>;

export const directorySyncConnectionTestSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  sampleUsers: z.array(z.object({
    externalId: z.string(),
    username: z.string(),
    nickname: z.string(),
  })),
}).meta({ id: 'DirectorySyncConnectionTest' });

export type DirectorySyncConnectionTest = z.infer<typeof directorySyncConnectionTestSchema>;


// ─── 契约：同步源 ────────────────────────────────────────────────────────────

export const directorySyncSourceListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称模糊匹配' }),
  type: queryEnum(DIRECTORY_SYNC_SOURCE_TYPES),
  status: entityStatusQuery,
});

export const directorySyncSourceContract = defineContract('/api/directory-sync/sources', {
  list: op.get('/', { query: directorySyncSourceListQuery, response: paginated(directorySyncSourceSchema), summary: '同步源列表' }),
  create: op.post('/', { body: createDirectorySyncSourceSchema, response: directorySyncSourceSchema, summary: '创建同步源' }),
  detail: op.get('/{id}', { params: idParam, response: directorySyncSourceSchema, summary: '同步源详情' }),
  update: op.put('/{id}', { params: idParam, body: updateDirectorySyncSourceSchema, response: directorySyncSourceSchema, summary: '更新同步源' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除同步源' }),
  test: op.post('/{id}/test', { params: idParam, response: directorySyncConnectionTestSchema, summary: '测试同步源连接' }),
  preview: op.post('/{id}/preview', { params: idParam, response: asyncTaskSchema, summary: '预览差异（dry-run，任务中心执行）' }),
  run: op.post('/{id}/run', { params: idParam, response: asyncTaskSchema, summary: '立即同步（任务中心执行）' }),
}, { tags: ['通讯录同步'] });

// ─── 契约：同步记录 / 冲突 ───────────────────────────────────────────────────

export const directorySyncRunListQuery = paginationQuery.extend({
  sourceId: idQuery(),
  status: queryEnum(DIRECTORY_SYNC_RUN_STATUSES),
  ...dateRangeQuery('开始时间'),
});

export const directorySyncRunItemListQuery = paginationQuery.extend({
  action: queryEnum(DIRECTORY_SYNC_ITEM_ACTIONS),
  entityType: queryEnum(DIRECTORY_SYNC_ENTITY_TYPES),
});

export const directorySyncConflictListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按外部 ID / 名称模糊匹配' }),
  sourceId: idQuery(),
  status: queryEnum(DIRECTORY_SYNC_CONFLICT_STATUSES),
});

export const directorySyncContract = defineContract('/api/directory-sync', {
  listRuns: op.get('/runs', { query: directorySyncRunListQuery, response: paginated(directorySyncRunSchema), summary: '同步记录列表' }),
  runDetail: op.get('/runs/{id}', { params: idParam, response: directorySyncRunSchema, summary: '同步记录详情' }),
  listRunItems: op.get('/runs/{id}/items', { params: idParam, query: directorySyncRunItemListQuery, response: paginated(directorySyncRunItemSchema), summary: '同步记录差异明细' }),
  retryRun: op.post('/runs/{id}/retry', { params: idParam, response: asyncTaskSchema, summary: '失败重试（对所属源重新执行同步）' }),
  listConflicts: op.get('/conflicts', { query: directorySyncConflictListQuery, response: paginated(directorySyncConflictSchema), summary: '冲突列表' }),
  ignoreConflicts: op.post('/conflicts/ignore', { body: batchIdsBody, summary: '批量忽略冲突' }),
  resolveConflict: op.post('/conflicts/{id}/resolve', { params: idParam, body: resolveDirectorySyncConflictSchema, response: directorySyncConflictSchema, summary: '裁决冲突' }),
}, { tags: ['通讯录同步'] });
