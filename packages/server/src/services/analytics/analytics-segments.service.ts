/**
 * 行为中心阶段 1：用户分群 CRUD + 规则 SQL 构建 + 成员物化。
 *
 * 安全设计：
 *  - 规则仅支持 event / attribute 两类原子条件（AnalyticsSegmentCondition 判别联合已在 shared 层杜绝 cohort 嵌套）
 *  - 条件 → distinctId 集合的 SQL 全部走白名单列 / 参数化比较（见 analytics-property-filter），不做 Node 内存 IN 展开
 *  - AND 用 SQL INTERSECT、OR 用 SQL UNION，全部下推数据库执行
 *  - 所有读写强制 tenantScope / currentCreateTenantId，物化任务通过 ensureSegmentExists 在任务执行上下文重新校验归属
 */
import { and, desc, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { analyticsUserSegments, analyticsSegmentMembers, analyticsUserProfiles, userEvents } from '../../db/schema';
import type { AnalyticsUserSegmentRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import type { AnalyticsSegmentRule, AnalyticsSegmentEventCondition, AnalyticsSegmentAttributeCondition, CreateAnalyticsUserSegmentInput, UpdateAnalyticsUserSegmentInput } from '@zenith/shared/analytics';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentCreateTenantId, tenantScope, exactTenantCondition } from '../../lib/tenant';
import { startOfDaysAgo } from '../../lib/analytics-helpers';
import logger from '../../lib/logger';
import { buildJsonPropertyCondition, buildColumnCompareCondition, PROPERTY_KEY_RE } from './analytics-property-filter';

export function mapSegment(row: AnalyticsUserSegmentRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    rules: row.rules,
    status: row.status,
    estimatedSize: row.estimatedSize,
    snapshotAt: formatNullableDateTime(row.snapshotAt),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 规则合法性校验（字段白名单，禁止 cohort 嵌套已在 zod discriminatedUnion 层保证）───
const ATTRIBUTE_DIRECT_FIELDS = new Set(['identityType', 'userId', 'memberId']);
const ATTRIBUTE_PROPERTY_FIELD_RE = /^property\.([a-zA-Z0-9_.-]{1,64})$/;

function validateRules(rules: AnalyticsSegmentRule): void {
  if (rules.conditions.length < 1 || rules.conditions.length > 10) {
    throw new HTTPException(400, { message: '分群条件数量需在 1~10 之间' });
  }
  for (const condition of rules.conditions) {
    if (condition.type === 'event') {
      for (const f of condition.properties ?? []) {
        if (!PROPERTY_KEY_RE.test(f.key)) throw new HTTPException(400, { message: `非法的属性 key：${f.key}` });
      }
      continue;
    }
    const field = condition.field;
    if (!ATTRIBUTE_DIRECT_FIELDS.has(field) && !ATTRIBUTE_PROPERTY_FIELD_RE.test(field)) {
      throw new HTTPException(400, { message: `不支持的属性字段：${field}` });
    }
  }
}

// ─── 列表 / 详情 ──────────────────────────────────────────────────────────────
export interface SegmentListQuery { page?: number; pageSize?: number; keyword?: string; status?: string }

export async function listSegments(q: SegmentListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const conditions: (SQL | undefined)[] = [];
  conditions.push(keywordCondition(q.keyword, [analyticsUserSegments.name], 'ilike'));
  if (q.status) conditions.push(eq(analyticsUserSegments.status, q.status as 'enabled' | 'disabled'));
  const where = buildWhere(...conditions, tenantScope(analyticsUserSegments));

  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(analyticsUserSegments, where),
    rows: () => db.select().from(analyticsUserSegments).where(where).orderBy(desc(analyticsUserSegments.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapSegment,
  });
}

/** 取分群行并校验 tenant 归属；不存在或无权访问时抛 404。供路由与物化任务共用作为唯一鉴权入口。 */
export async function ensureSegmentExists(id: number): Promise<AnalyticsUserSegmentRow> {
  const where = buildWhere(eq(analyticsUserSegments.id, id), tenantScope(analyticsUserSegments));
  const [row] = await db.select().from(analyticsUserSegments).where(where).limit(1);
  return requireRow(row, '分群不存在');
}

/** 供其他模块（漏斗 segmentId、事件分析 segmentId）复用的只读归属校验。 */
export async function ensureSegmentAccessible(id: number): Promise<AnalyticsUserSegmentRow> {
  return ensureSegmentExists(id);
}

/** 分群成员 distinctId 子查询（用于 IN 过滤），调用方需先 ensureSegmentAccessible 校验归属。 */
export function segmentMemberDistinctIdSubquery(segmentId: number) {
  return db.select({ distinctId: analyticsSegmentMembers.distinctId }).from(analyticsSegmentMembers).where(eq(analyticsSegmentMembers.segmentId, segmentId));
}

export async function getSegmentDetail(id: number) {
  return mapSegment(await ensureSegmentExists(id));
}

// ─── 创建 / 更新 / 删除 ───────────────────────────────────────────────────────
export async function createSegment(input: CreateAnalyticsUserSegmentInput) {
  validateRules(input.rules);
  try {
    const [row] = await db.insert(analyticsUserSegments).values({
      tenantId: currentCreateTenantId(),
      name: input.name,
      description: input.description ?? null,
      rules: input.rules,
      status: input.status ?? 'enabled',
    }).returning();
    return mapSegment(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '分群名称已存在');
    throw err;
  }
}

export async function updateSegment(id: number, input: UpdateAnalyticsUserSegmentInput) {
  await ensureSegmentExists(id);
  if (input.rules) validateRules(input.rules);
  try {
    const [row] = await db.update(analyticsUserSegments).set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.rules !== undefined ? { rules: input.rules } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    }).where(eq(analyticsUserSegments.id, id)).returning();
    return mapSegment(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '分群名称已存在');
    throw err;
  }
}

export async function deleteSegment(id: number) {
  await ensureSegmentExists(id);
  await db.delete(analyticsUserSegments).where(eq(analyticsUserSegments.id, id));
}

// ─── 成员分页 ─────────────────────────────────────────────────────────────────
export interface SegmentMembersQuery { page?: number; pageSize?: number }
export async function listSegmentMembers(id: number, q: SegmentMembersQuery) {
  await ensureSegmentExists(id);
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const where = eq(analyticsSegmentMembers.segmentId, id);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(analyticsSegmentMembers, where),
    rows: () => db.select().from(analyticsSegmentMembers).where(where).orderBy(desc(analyticsSegmentMembers.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: (r) => ({
      id: r.id,
      segmentId: r.segmentId,
      tenantId: r.tenantId,
      distinctId: r.distinctId,
      identityType: r.identityType,
      userId: r.userId,
      memberId: r.memberId,
      snapshotAt: formatDateTime(r.snapshotAt),
    }),
  });
}

// ─── 规则 → distinctId 集合 SQL 构建 ─────────────────────────────────────────
function buildEventConditionSelect(condition: AnalyticsSegmentEventCondition, tenantId: number | null): SQL {
  const conditions: SQL[] = [
    eq(userEvents.eventName, condition.eventName),
    gte(userEvents.createdAt, startOfDaysAgo(condition.days)),
    isNotNull(userEvents.distinctId),
    exactTenantCondition(sql`${userEvents.tenantId}`, tenantId),
  ];
  for (const f of condition.properties ?? []) conditions.push(buildJsonPropertyCondition(userEvents.properties, f));
  const where = and(...conditions);
  const minCount = condition.minCount ?? 1;
  if (minCount <= 1) {
    return sql`(SELECT DISTINCT ${userEvents.distinctId} AS distinct_id FROM ${userEvents} WHERE ${where})`;
  }
  return sql`(SELECT ${userEvents.distinctId} AS distinct_id FROM ${userEvents} WHERE ${where} GROUP BY ${userEvents.distinctId} HAVING COUNT(*) >= ${minCount})`;
}

function buildAttributeConditionSelect(condition: AnalyticsSegmentAttributeCondition, tenantId: number | null): SQL {
  const conditions: SQL[] = [exactTenantCondition(sql`${analyticsUserProfiles.tenantId}`, tenantId)];
  if (condition.field === 'identityType') {
    conditions.push(buildColumnCompareCondition(analyticsUserProfiles.identityType, condition.op, condition.value));
  } else if (condition.field === 'userId') {
    conditions.push(buildColumnCompareCondition(analyticsUserProfiles.userId, condition.op, condition.value));
  } else if (condition.field === 'memberId') {
    conditions.push(buildColumnCompareCondition(analyticsUserProfiles.memberId, condition.op, condition.value));
  } else {
    const match = ATTRIBUTE_PROPERTY_FIELD_RE.exec(condition.field);
    if (!match) throw new HTTPException(400, { message: `不支持的属性字段：${condition.field}` });
    conditions.push(buildJsonPropertyCondition(analyticsUserProfiles.properties, { key: match[1], op: condition.op, value: condition.value }));
  }
  return sql`(SELECT DISTINCT ${analyticsUserProfiles.distinctId} AS distinct_id FROM ${analyticsUserProfiles} WHERE ${and(...conditions)})`;
}

/** 将分群规则编译为 distinctId 集合 SQL（AND→INTERSECT，OR→UNION），全部下推数据库执行。导出供单测验证注入防护与 AND/OR 语义。 */
export function buildSegmentDistinctIdSql(rules: AnalyticsSegmentRule, tenantId: number | null): SQL {
  const selects = rules.conditions.map((c) => (c.type === 'event' ? buildEventConditionSelect(c, tenantId) : buildAttributeConditionSelect(c, tenantId)));
  if (selects.length === 1) return selects[0];
  const joiner = rules.operator === 'AND' ? sql` INTERSECT ` : sql` UNION `;
  return sql.join(selects, joiner);
}

// ─── 物化 ─────────────────────────────────────────────────────────────────────
/**
 * 重算并物化分群成员快照：事务内清空旧快照 + INSERT ... SELECT 写入新成员 + 回写 estimatedSize/snapshotAt。
 * 通过 ensureSegmentExists 在调用者（HTTP 请求或异步任务恢复的 currentUser() 上下文）身份下重新校验 tenant 归属，
 * 避免任务执行期跨租户误算。
 */
export async function materializeSegment(segmentId: number, executor?: DbExecutor): Promise<{ estimatedSize: number }> {
  const segment = await ensureSegmentExists(segmentId);
  return materializeSegmentRow(segment, executor);
}

/**
 * 物化核心：不做归属校验，调用方负责。
 * 定时刷新是平台级作业（无登录用户上下文），无法走 `ensureSegmentExists` 的 tenantScope，
 * 因此拆出本函数供 cron 逐个租户的分群复用。
 */
async function materializeSegmentRow(segment: AnalyticsUserSegmentRow, executor?: DbExecutor): Promise<{ estimatedSize: number }> {
  const segmentId = segment.id;
  const distinctIdSql = buildSegmentDistinctIdSql(segment.rules, segment.tenantId);

  const run = async (tx: DbExecutor) => {
    await tx.delete(analyticsSegmentMembers).where(eq(analyticsSegmentMembers.segmentId, segmentId));
    await tx.execute(sql`
      INSERT INTO analytics_segment_members (segment_id, tenant_id, distinct_id, identity_type, user_id, member_id, snapshot_at)
      SELECT ${segmentId}, p.tenant_id, m.distinct_id, p.identity_type, p.user_id, p.member_id, now()
      FROM (${distinctIdSql}) AS m
      JOIN analytics_user_profiles p ON p.distinct_id = m.distinct_id AND p.tenant_id IS NOT DISTINCT FROM ${segment.tenantId}
      ON CONFLICT (segment_id, distinct_id) DO NOTHING
    `);
    const [{ count }] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(analyticsSegmentMembers)
      .where(eq(analyticsSegmentMembers.segmentId, segmentId));
    await tx.update(analyticsUserSegments).set({ estimatedSize: count, snapshotAt: new Date() }).where(eq(analyticsUserSegments.id, segmentId));
    return { estimatedSize: count };
  };

  if (executor) return run(executor);
  return db.transaction((tx) => run(tx));
}

/**
 * 定时重算全部启用中的分群（cron）。
 *
 * 分群快照不自动刷新时会静默过期——触达活动会按几天前的成员名单发送，
 * 且分析页的 segmentId 过滤结果与实际人群不符，两者都不报错，极难发现。
 *
 * 单个分群失败不影响其余分群：规则可能引用了已删除的属性 key，
 * 一个坏分群不应阻塞整批刷新。
 */
export async function refreshAllSegments(): Promise<{ total: number; succeeded: number; failed: number }> {
  const segments = await db
    .select()
    .from(analyticsUserSegments)
    .where(eq(analyticsUserSegments.status, 'enabled'));

  let succeeded = 0;
  let failed = 0;
  for (const segment of segments) {
    try {
      await materializeSegmentRow(segment);
      succeeded++;
    } catch (err) {
      failed++;
      logger.error('[analytics-segments] 分群定时刷新失败', { segmentId: segment.id, name: segment.name, err });
    }
  }
  return { total: segments.length, succeeded, failed };
}
