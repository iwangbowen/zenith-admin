import { buildListResult, listRows } from '../../lib/list-query';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import crypto from 'node:crypto';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import {
  directorySyncSources, directorySyncRuns, directorySyncRunItems, directorySyncConflicts,
  directorySyncUserLinks, tenantIdentityProviders, users,
  type DirectorySyncSourceRow, type DirectorySyncRunRow, type DirectorySyncRunItemRow, type DirectorySyncConflictRow,
} from '../../db/schema';
import { directorySyncSourceSchema, directorySyncRunSchema, directorySyncRunItemSchema, directorySyncConflictSchema, type CreateDirectorySyncSourceInput, type UpdateDirectorySyncSourceInput, type ResolveDirectorySyncConflictInput, type DirectorySyncEntityType, type DirectorySyncTriggerType, type DirectorySyncItemAction, type DirectorySyncMatchKey, type DirectorySyncConflictPolicy, type DirectorySyncConflictType, type DirectorySyncResolution, type directorySyncSourceContract, type directorySyncContract } from '@zenith/shared/identity';
import type { QueryOutputOf } from '@zenith/shared/core';
import { JOB_MONITOR_DIRECTORY_STUCK_MS, type JobStuckItem } from '@zenith/shared/platform';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { exactTenantCondition, resolveManagedTenantId, tenantScope } from '../../lib/tenant';
import { submitAsyncTask, mapAsyncTask } from '../../lib/task-center';
import { buildDirectoryConnector, type DirectoryConnectorTestResult } from './directory-sync-connectors';
import { computeNextRunAt, DIRECTORY_SYNC_TASK_TYPE } from './directory-sync-engine';
import { assertDefaultRolesGrantable } from './role-grant';
import { pickEntity } from '../../lib/entity-map';
import { formatDateTime } from '../../lib/datetime';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';

export const DIRECTORY_SYNC_STUCK_MS = JOB_MONITOR_DIRECTORY_STUCK_MS;

export function stuckDirectorySyncRunCondition(asOf = new Date()) {
  return and(eq(directorySyncRuns.status, 'running'), lt(directorySyncRuns.startedAt, new Date(asOf.getTime() - DIRECTORY_SYNC_STUCK_MS)));
}

/** 目录运行没有租约回收，超过一小时仍运行需要在同步日志中人工结案。 */
export async function getDirectorySyncHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const late = new Date(now.getTime() - 10 * 60_000);
  const [[row], lateCount, failedSources] = await Promise.all([
    db.select({
      running: sql<number>`count(*) filter (where ${directorySyncRuns.status} = 'running')::int`,
      stuck: sql<number>`count(*) filter (where ${stuckDirectorySyncRunCondition(now)})::int`,
      failed24h: sql<number>`count(*) filter (where ${directorySyncRuns.status} in ('failed', 'aborted') and ${directorySyncRuns.finishedAt} >= ${sql.param(since, directorySyncRuns.startedAt)})::int`,
      succeeded24h: sql<number>`count(*) filter (where ${directorySyncRuns.status} = 'success' and ${directorySyncRuns.finishedAt} >= ${sql.param(since, directorySyncRuns.startedAt)})::int`,
      partial24h: sql<number>`count(*) filter (where ${directorySyncRuns.status} = 'partial' and ${directorySyncRuns.finishedAt} >= ${sql.param(since, directorySyncRuns.startedAt)})::int`,
      failed1h: sql<number>`count(*) filter (where ${directorySyncRuns.status} in ('failed', 'aborted') and ${directorySyncRuns.finishedAt} >= ${sql.param(hour, directorySyncRuns.startedAt)})::int`,
    }).from(directorySyncRuns).where(or(eq(directorySyncRuns.status, 'running'), and(inArray(directorySyncRuns.status, ['success', 'partial', 'failed', 'aborted']), gte(directorySyncRuns.finishedAt, since)))),
    db.$count(directorySyncSources, and(eq(directorySyncSources.status, 'enabled'), sql`${directorySyncSources.type} <> 'scim' and nullif(trim(${directorySyncSources.cronExpression}), '') is not null`, lt(directorySyncSources.nextRunAt, late))),
    db.$count(directorySyncSources, and(eq(directorySyncSources.status, 'enabled'), eq(directorySyncSources.lastRunStatus, 'failed'))),
  ]);
  const issues: JobSourceRawSummary['issues'] = [];
  if (lateCount > 0) issues.push({ level: 'warn', message: `${lateCount} 个同步源的计划已超期 10 分钟` });
  if (failedSources > 0) issues.push({ level: 'warn', message: `${failedSources} 个启用同步源最近一次运行失败` });
  if ((row?.partial24h ?? 0) > 0) issues.push({ level: 'warn', message: `近 24 小时 ${row.partial24h} 次目录同步部分失败` });
  return {
    counts: { pending: 0, running: row?.running ?? 0, stuck: row?.stuck ?? 0, dead: null, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: null, failed1h: row?.failed1h ?? 0, issues,
  };
}

export async function listStuckDirectorySyncRuns(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({
    id: directorySyncRuns.id, status: directorySyncRuns.status, startedAt: directorySyncRuns.startedAt,
    message: directorySyncRuns.message, errorMessage: directorySyncRuns.errorMessage, sourceName: directorySyncSources.name,
  }).from(directorySyncRuns).innerJoin(directorySyncSources, eq(directorySyncSources.id, directorySyncRuns.sourceId))
    .where(stuckDirectorySyncRunCondition(now)).orderBy(directorySyncRuns.startedAt, directorySyncRuns.id).limit(limit);
  return rows.map((row) => ({
    source: 'directory-sync', refId: String(row.id), title: row.sourceName, status: row.status,
    startedAt: formatDateTime(row.startedAt), lastSeenAt: formatDateTime(row.startedAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - row.startedAt.getTime()) / 1000)),
    nodeId: null, detail: row.errorMessage ?? row.message,
    drillDown: { path: '/system/directory-sync/logs?status=running', label: '查看同步日志' },
  }));
}

const SOURCE_TENANT_SCOPE_MESSAGE = '无权为其他租户或平台配置同步源';

/**
 * 运行记录 / 冲突等子资源没有 tenantId 列，通过「所属同步源落在调用者租户作用域内」限定；
 * 无需隔离（单租户 / 平台全局视角）时返回 undefined。
 */
function manageableSourceScope(sourceIdColumn: AnyPgColumn, executor: DbExecutor = db) {
  const scope = tenantScope(directorySyncSources);
  if (!scope) return undefined;
  return inArray(sourceIdColumn, executor.select({ id: directorySyncSources.id }).from(directorySyncSources).where(scope));
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapDirectorySyncSource(row: DirectorySyncSourceRow & { identityProvider?: { name: string } | null }) {
  return pickEntity(directorySyncSourceSchema, row, {
    identityProviderName: row.identityProvider?.name ?? null,
    matchKey: row.matchKey as DirectorySyncMatchKey,
    fieldMapping: row.fieldMapping ?? {},
    scopeConfig: row.scopeConfig ?? {},
    conflictPolicy: row.conflictPolicy as DirectorySyncConflictPolicy,
    contactSecretSet: Boolean(row.contactSecret),
    callbackTokenSet: Boolean(row.callbackToken),
    callbackAesKeySet: Boolean(row.callbackAesKey),
  });
}

export function mapDirectorySyncRun(row: DirectorySyncRunRow & { source?: { name: string } | null }) {
  return pickEntity(directorySyncRunSchema, row, {
    sourceName: row.source?.name ?? null,
    triggerType: row.triggerType as DirectorySyncTriggerType,
  });
}

export function mapDirectorySyncRunItem(row: DirectorySyncRunItemRow) {
  return pickEntity(directorySyncRunItemSchema, row, {
    entityType: row.entityType as DirectorySyncEntityType,
    action: row.action as DirectorySyncItemAction,
  });
}

export function mapDirectorySyncConflict(row: DirectorySyncConflictRow & { source?: { name: string } | null; resolvedByUser?: { nickname: string } | null }) {
  return pickEntity(directorySyncConflictSchema, row, {
    sourceName: row.source?.name ?? null,
    entityType: row.entityType as DirectorySyncEntityType,
    conflictType: row.conflictType as DirectorySyncConflictType,
    candidateUserIds: row.candidateUserIds ?? [],
    resolution: (row.resolution ?? null) as DirectorySyncResolution | null,
    resolvedByNickname: row.resolvedByUser?.nickname ?? null,
  });
}

// ─── 同步源 CRUD ──────────────────────────────────────────────────────────────
type DirectorySyncSourceListFilter = Omit<QueryOutputOf<typeof directorySyncSourceContract.list>, 'page' | 'pageSize'>;

function buildSourceWhere(q: DirectorySyncSourceListFilter & { id?: number }) {
  return buildWhere(
    tenantScope(directorySyncSources),
    q.id !== undefined ? eq(directorySyncSources.id, q.id) : undefined,
    keywordCondition(q.keyword, [directorySyncSources.name, directorySyncSources.remark]),
    q.type ? eq(directorySyncSources.type, q.type) : undefined,
    q.status ? eq(directorySyncSources.status, q.status) : undefined,
  );
}

export async function listDirectorySyncSources(q: QueryOutputOf<typeof directorySyncSourceContract.list>) {
  const { page, pageSize } = q;
  const where = buildSourceWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(directorySyncSources, where),
    rows: () => db.query.directorySyncSources.findMany({
      where,
      with: { identityProvider: { columns: { name: true } } },
      orderBy: desc(directorySyncSources.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapDirectorySyncSource,
  });
}

/** 管理侧读取：id + 调用者租户作用域，越界一律 404（SCIM 回调与 worker 走各自的按 key / id 加载，不经此处） */
export async function ensureDirectorySyncSourceExists(id: number): Promise<DirectorySyncSourceRow> {
  return requireFirstRow(
    db.select().from(directorySyncSources)
      .where(and(eq(directorySyncSources.id, id), tenantScope(directorySyncSources)))
      .limit(1),
    '同步源不存在',
  );
}

export async function getDirectorySyncSource(id: number) {
  const row = await db.query.directorySyncSources.findFirst({
    where: and(eq(directorySyncSources.id, id), tenantScope(directorySyncSources)),
    with: { identityProvider: { columns: { name: true } } },
  });
  return mapDirectorySyncSource(requireRow(row, '同步源不存在'));
}

async function ensureBindingsValid(input: { type?: string; identityProviderId?: number | null; cronExpression?: string | null; tenantId: number | null }) {
  if (input.identityProviderId) {
    // 绑定的身份源必须与同步源同一归属，防止借他租户 / 平台的 LDAP 源按自己的 lifecycle 建号
    const [provider] = await db.select({ id: tenantIdentityProviders.id, type: tenantIdentityProviders.type })
      .from(tenantIdentityProviders)
      .where(and(
        eq(tenantIdentityProviders.id, input.identityProviderId),
        exactTenantCondition(tenantIdentityProviders.tenantId, input.tenantId),
      ))
      .limit(1);
    requireRow(provider, '绑定的企业身份源不存在或不属于当前租户', 400);
    if (provider.type !== 'ldap' && provider.type !== 'ad') {
      throw new HTTPException(400, { message: '绑定的企业身份源必须是 LDAP/AD 类型' });
    }
  }
  if (input.cronExpression?.trim() && !computeNextRunAt(input.cronExpression)) {
    throw new HTTPException(400, { message: 'cron 表达式无效' });
  }
}

export async function createDirectorySyncSource(data: CreateDirectorySyncSourceInput) {
  const tenantId = resolveManagedTenantId(data.tenantId, SOURCE_TENANT_SCOPE_MESSAGE);
  await ensureBindingsValid({ ...data, tenantId });
  await assertDefaultRolesGrantable(data.lifecycle.defaultRoleIds, tenantId);
  try {
    const [row] = await db.insert(directorySyncSources).values({
      name: data.name,
      type: data.type,
      status: data.status,
      tenantId,
      identityProviderId: data.identityProviderId ?? null,
      oauthProvider: data.oauthProvider ?? null,
      matchKey: data.matchKey,
      fieldMapping: data.fieldMapping,
      scopeConfig: data.scopeConfig,
      conflictPolicy: data.conflictPolicy,
      lifecycle: data.lifecycle,
      syncDepartments: data.syncDepartments,
      cronExpression: data.type === 'scim' ? null : (data.cronExpression ?? null),
      circuitBreakerPercent: data.circuitBreakerPercent,
      contactSecret: data.contactSecret?.trim() ? data.contactSecret.trim() : null,
      callbackToken: data.callbackToken?.trim() ? data.callbackToken.trim() : null,
      callbackAesKey: data.callbackAesKey?.trim() ? data.callbackAesKey.trim() : null,
      // 回调 / SCIM 地址的随机路径段（防探测），创建即生成
      callbackUrlKey: crypto.randomBytes(12).toString('hex'),
      nextRunAt: data.status === 'enabled' ? computeNextRunAt(data.cronExpression) : null,
      remark: data.remark ?? null,
    }).returning();
    return getDirectorySyncSource(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同名同步源已存在');
    throw err;
  }
}

export async function updateDirectorySyncSource(id: number, data: UpdateDirectorySyncSourceInput) {
  const before = await ensureDirectorySyncSourceExists(id);
  // 归属迁移只对平台管理员开放；其他人未传则沿用，传了不一致的值由 resolveManagedTenantId 拒绝
  const tenantId = data.tenantId === undefined
    ? before.tenantId
    : resolveManagedTenantId(data.tenantId, SOURCE_TENANT_SCOPE_MESSAGE);
  await ensureBindingsValid({
    type: before.type,
    identityProviderId: data.identityProviderId !== undefined ? data.identityProviderId : before.identityProviderId,
    cronExpression: data.cronExpression,
    tenantId,
  });
  const lifecycle = data.lifecycle ?? before.lifecycle;
  if (data.lifecycle !== undefined || tenantId !== before.tenantId) {
    await assertDefaultRolesGrantable(lifecycle?.defaultRoleIds ?? [], tenantId);
  }
  const cron = data.cronExpression !== undefined ? data.cronExpression : before.cronExpression;
  const status = data.status ?? before.status;
  try {
    await db.update(directorySyncSources).set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.tenantId !== undefined ? { tenantId } : {}),
      ...(data.identityProviderId !== undefined ? { identityProviderId: data.identityProviderId } : {}),
      ...(data.oauthProvider !== undefined ? { oauthProvider: data.oauthProvider } : {}),
      ...(data.matchKey !== undefined ? { matchKey: data.matchKey } : {}),
      ...(data.fieldMapping !== undefined ? { fieldMapping: data.fieldMapping } : {}),
      ...(data.scopeConfig !== undefined ? { scopeConfig: data.scopeConfig } : {}),
      ...(data.conflictPolicy !== undefined ? { conflictPolicy: data.conflictPolicy } : {}),
      ...(data.lifecycle !== undefined ? { lifecycle: data.lifecycle } : {}),
      ...(data.syncDepartments !== undefined ? { syncDepartments: data.syncDepartments } : {}),
      ...(data.cronExpression !== undefined ? { cronExpression: data.cronExpression } : {}),
      ...(data.circuitBreakerPercent !== undefined ? { circuitBreakerPercent: data.circuitBreakerPercent } : {}),
      // 缺省保持不变；空串视为不修改，null 显式清除
      ...(data.contactSecret !== undefined && data.contactSecret !== ''
        ? { contactSecret: data.contactSecret === null ? null : data.contactSecret.trim() }
        : {}),
      ...(data.callbackToken !== undefined && data.callbackToken !== ''
        ? { callbackToken: data.callbackToken === null ? null : data.callbackToken.trim() }
        : {}),
      ...(data.callbackAesKey !== undefined && data.callbackAesKey !== ''
        ? { callbackAesKey: data.callbackAesKey === null ? null : data.callbackAesKey.trim() }
        : {}),
      ...(data.remark !== undefined ? { remark: data.remark } : {}),
      // 存量源（P3 之前创建）没有回调 Key：更新时补生成
      ...(before.callbackUrlKey ? {} : { callbackUrlKey: crypto.randomBytes(12).toString('hex') }),
      // 启停或表达式变化后重算下次运行时间
      nextRunAt: status === 'enabled' ? computeNextRunAt(cron) : null,
    }).where(eq(directorySyncSources.id, id));
  } catch (err) {
    rethrowPgUniqueViolation(err, '同名同步源已存在');
    throw err;
  }
  return getDirectorySyncSource(id);
}

export async function deleteDirectorySyncSource(id: number) {
  await ensureDirectorySyncSourceExists(id);
  await db.delete(directorySyncSources).where(eq(directorySyncSources.id, id));
}

// ─── 连接测试与同步提交 ────────────────────────────────────────────────────────
export async function testDirectorySyncSourceConnection(id: number): Promise<DirectoryConnectorTestResult> {
  const source = await ensureDirectorySyncSourceExists(id);
  if (source.type === 'scim') {
    throw new HTTPException(400, { message: 'SCIM 源为 IdP 推送模式，请在 IdP 侧使用“测试连接”验证' });
  }
  return buildDirectoryConnector(source).test();
}

export async function submitDirectorySyncTask(id: number, dryRun: boolean) {
  const source = await ensureDirectorySyncSourceExists(id);
  if (source.type === 'scim') {
    throw new HTTPException(400, { message: 'SCIM 源为 IdP 推送模式，无需拉取同步' });
  }
  const row = await submitAsyncTask({
    taskType: DIRECTORY_SYNC_TASK_TYPE,
    title: dryRun ? `通讯录差异预览（${source.name}）` : `通讯录同步（${source.name}）`,
    payload: { sourceId: id, dryRun },
  });
  return mapAsyncTask(row);
}

// ─── 同步记录 ─────────────────────────────────────────────────────────────────
type DirectorySyncRunListFilter = Omit<QueryOutputOf<typeof directorySyncContract.listRuns>, 'page' | 'pageSize'>;

function buildRunWhere(q: DirectorySyncRunListFilter) {
  return buildWhere(
    manageableSourceScope(directorySyncRuns.sourceId),
    q.sourceId !== undefined ? eq(directorySyncRuns.sourceId, q.sourceId) : undefined,
    q.status ? eq(directorySyncRuns.status, q.status) : undefined,
    ...dateRangeConditions(directorySyncRuns.startedAt, q.startTime, q.endTime),
  );
}

export async function listDirectorySyncRuns(q: QueryOutputOf<typeof directorySyncContract.listRuns>) {
  const { page, pageSize } = q;
  const where = buildRunWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(directorySyncRuns, where),
    rows: () => db.query.directorySyncRuns.findMany({
      where,
      with: { source: { columns: { name: true } } },
      orderBy: desc(directorySyncRuns.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapDirectorySyncRun,
  });
}

export async function getDirectorySyncRun(id: number) {
  const row = await db.query.directorySyncRuns.findFirst({
    where: and(eq(directorySyncRuns.id, id), manageableSourceScope(directorySyncRuns.sourceId)),
    with: { source: { columns: { name: true } } },
  });
  return mapDirectorySyncRun(requireRow(row, '同步记录不存在'));
}

async function ensureRunManageable(runId: number): Promise<DirectorySyncRunRow> {
  return requireFirstRow(
    db.select().from(directorySyncRuns)
      .where(and(eq(directorySyncRuns.id, runId), manageableSourceScope(directorySyncRuns.sourceId)))
      .limit(1),
    '同步记录不存在',
  );
}

/** 仅结案监控判定卡死的记录；状态比较与写入在同一语句，迟到执行器不能改回成功。 */
export async function markDirectorySyncRunFailed(runId: number) {
  const run = await ensureRunManageable(runId);
  const source = await ensureDirectorySyncSourceExists(run.sourceId);
  const now = new Date();
  const message = '管理员手动标记卡死同步为失败';
  const changed = await db.transaction(async (tx) => {
    const [row] = await tx.update(directorySyncRuns).set({ status: 'failed', message, errorMessage: message, finishedAt: now })
      .where(and(eq(directorySyncRuns.id, runId), stuckDirectorySyncRunCondition(now), manageableSourceScope(directorySyncRuns.sourceId, tx))).returning();
    if (!row) throw new HTTPException(409, { message: '仅可标记运行超过一小时且尚未结束的同步记录' });
    if (!row.dryRun) {
      await tx.update(directorySyncSources).set({ lastRunAt: row.startedAt, lastRunStatus: 'failed', nextRunAt: computeNextRunAt(source.cronExpression, now) })
        .where(and(eq(directorySyncSources.id, row.sourceId), tenantScope(directorySyncSources)));
    }
    return row;
  });
  return mapDirectorySyncRun({ ...changed, source: { name: source.name } });
}

export async function listDirectorySyncRunItems(runId: number, q: QueryOutputOf<typeof directorySyncContract.listRunItems>) {
  await ensureRunManageable(runId);
  const { page, pageSize } = q;
  const where = buildWhere(
    eq(directorySyncRunItems.runId, runId),
    q.action ? eq(directorySyncRunItems.action, q.action) : undefined,
    q.entityType ? eq(directorySyncRunItems.entityType, q.entityType) : undefined,
  );
  return listRows({
    page,
    pageSize,
    table: directorySyncRunItems,
    where,
    orderBy: [directorySyncRunItems.id],
    map: mapDirectorySyncRunItem,
  });
}

/** 失败重试：对该记录所属同步源重新提交一次全量同步（引擎幂等，仅失败项会产生变化） */
export async function retryDirectorySyncRun(runId: number) {
  const run = await ensureRunManageable(runId);
  if (run.status === 'running') throw new HTTPException(400, { message: '该记录仍在执行中' });
  return submitDirectorySyncTask(run.sourceId, false);
}

// ─── 冲突处理 ─────────────────────────────────────────────────────────────────
type DirectorySyncConflictListFilter = Omit<QueryOutputOf<typeof directorySyncContract.listConflicts>, 'page' | 'pageSize'>;

function buildConflictWhere(q: DirectorySyncConflictListFilter) {
  return buildWhere(
    manageableSourceScope(directorySyncConflicts.sourceId),
    q.sourceId !== undefined ? eq(directorySyncConflicts.sourceId, q.sourceId) : undefined,
    q.status ? eq(directorySyncConflicts.status, q.status) : undefined,
    keywordCondition(q.keyword, [directorySyncConflicts.name, directorySyncConflicts.externalId]),
  );
}

export async function listDirectorySyncConflicts(q: QueryOutputOf<typeof directorySyncContract.listConflicts>) {
  const { page, pageSize } = q;
  const where = buildConflictWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(directorySyncConflicts, where),
    rows: () => db.query.directorySyncConflicts.findMany({
      where,
      with: {
        source: { columns: { name: true } },
        resolvedByUser: { columns: { nickname: true } },
      },
      orderBy: desc(directorySyncConflicts.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapDirectorySyncConflict,
  });
}

export async function ensureDirectorySyncConflictExists(id: number): Promise<DirectorySyncConflictRow> {
  return requireFirstRow(
    db.select().from(directorySyncConflicts)
      .where(and(eq(directorySyncConflicts.id, id), manageableSourceScope(directorySyncConflicts.sourceId)))
      .limit(1),
    '冲突记录不存在',
  );
}

/** 将源侧快照字段应用到本地用户 */
async function applySourceDataToUser(userId: number, sourceData: Record<string, unknown>, onlyFields?: string[]) {
  const patch: Record<string, unknown> = {};
  const fields = onlyFields ?? ['nickname', 'email', 'phone'];
  for (const field of fields) {
    if (field in sourceData && sourceData[field] != null && ['nickname', 'email', 'phone'].includes(field)) {
      patch[field] = field === 'nickname' ? String(sourceData[field]).slice(0, 32) : sourceData[field];
    }
  }
  if (Object.keys(patch).length > 0) {
    await db.update(users).set(patch).where(eq(users.id, userId));
  }
}

export async function resolveDirectorySyncConflict(id: number, input: ResolveDirectorySyncConflictInput, resolvedBy: number) {
  const conflict = await ensureDirectorySyncConflictExists(id);
  if (conflict.status !== 'pending') throw new HTTPException(400, { message: '该冲突已处理' });

  if (input.resolution === 'source') {
    if (conflict.conflictType === 'multi_match') {
      const targetUserId = input.targetUserId;
      if (!targetUserId) throw new HTTPException(400, { message: '请选择要绑定的本地账号' });
      if (!conflict.candidateUserIds.includes(targetUserId)) {
        throw new HTTPException(400, { message: '所选账号不在候选列表中' });
      }
      await db.transaction(async (tx) => {
        await tx.insert(directorySyncUserLinks).values({
          sourceId: conflict.sourceId,
          externalId: conflict.externalId,
          userId: targetUserId,
          externalData: conflict.sourceData,
          lastSeenAt: new Date(),
        }).onConflictDoNothing();
        if (conflict.sourceData) {
          const patch: Record<string, unknown> = {};
          for (const field of ['nickname', 'email', 'phone'] as const) {
            const value = conflict.sourceData[field];
            if (value != null) patch[field] = field === 'nickname' ? String(value).slice(0, 32) : value;
          }
          if (Object.keys(patch).length > 0) {
            await tx.update(users).set(patch).where(eq(users.id, targetUserId));
          }
        }
      });
    } else {
      const [maybeLink] = await db.select().from(directorySyncUserLinks).where(and(
        eq(directorySyncUserLinks.sourceId, conflict.sourceId),
        eq(directorySyncUserLinks.externalId, conflict.externalId),
      )).limit(1);
      const link = requireRow(maybeLink, '未找到该外部用户的本地绑定', 400);
      const conflictedFields = conflict.localData ? Object.keys(conflict.localData) : undefined;
      if (conflict.sourceData) {
        await applySourceDataToUser(link.userId, conflict.sourceData, conflictedFields);
        await db.update(directorySyncUserLinks).set({ externalData: conflict.sourceData }).where(eq(directorySyncUserLinks.id, link.id));
      }
    }
  }
  // resolution=local / manual：保留本地现状，仅登记裁决结果；引擎会跳过源数据未变化的已裁决冲突

  await db.update(directorySyncConflicts).set({
    status: 'resolved',
    resolution: input.resolution,
    resolvedBy,
    resolvedAt: new Date(),
  }).where(eq(directorySyncConflicts.id, id));
  return listConflictById(id);
}

async function listConflictById(id: number) {
  const row = await db.query.directorySyncConflicts.findFirst({
    where: eq(directorySyncConflicts.id, id),
    with: {
      source: { columns: { name: true } },
      resolvedByUser: { columns: { nickname: true } },
    },
  });
  return mapDirectorySyncConflict(requireRow(row, '冲突记录不存在'));
}

export async function ignoreDirectorySyncConflicts(ids: number[], resolvedBy: number) {
  const updated = await db.update(directorySyncConflicts).set({
    status: 'ignored',
    resolution: 'local',
    resolvedBy,
    resolvedAt: new Date(),
  }).where(and(
    inArray(directorySyncConflicts.id, ids),
    eq(directorySyncConflicts.status, 'pending'),
    manageableSourceScope(directorySyncConflicts.sourceId),
  )).returning({ id: directorySyncConflicts.id });
  return updated.length;
}
