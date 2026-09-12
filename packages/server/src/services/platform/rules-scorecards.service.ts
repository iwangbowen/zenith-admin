/**
 * 评分卡服务（规则中心）：CRUD、发布快照与求值。
 * 发布采用单快照（publishedSnapshot），运行时按快照执行；编辑态求值仅用于测试。
 */
import { and, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import type {
  RuleScorecardEvaluateResult,
  RuleScorecardGrade,
  RuleScorecardVariable,
} from '@zenith/shared/rules';
import { stableStringify } from '@zenith/shared/core';
import type { CreateRuleScorecardInput, UpdateRuleScorecardInput } from '@zenith/shared/rules';
import { ruleScorecardContract } from '@zenith/shared/rules';
import { db } from '../../db';
import { ruleScorecards, ruleAssetVersions } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { evaluateScorecard, type ScorecardLike } from '../../lib/rules-scorecard';
import { recordRuleExecution, snapshotRuleScope } from './rules-executions.service';
import { invalidateRuleRuntimeCache } from './rules-runtime-cache';
import { findWorkflowGatewayUsages } from './rules.service';

type Row = typeof ruleScorecards.$inferSelect;

interface ScorecardSnapshot {
  baseScore: number;
  variables: RuleScorecardVariable[];
  grades: RuleScorecardGrade[];
}

function draftSnapshot(row: Row): ScorecardSnapshot {
  return {
    baseScore: row.baseScore,
    variables: (row.variables ?? []) as RuleScorecardVariable[],
    grades: (row.grades ?? []) as RuleScorecardGrade[],
  };
}

export function mapRuleScorecard(row: Row) {
  const snapshot = row.publishedSnapshot as ScorecardSnapshot | null;
  const dirty = row.status === 'published' && snapshot != null
    ? stableStringify(draftSnapshot(row)) !== stableStringify(snapshot)
    : undefined;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    baseScore: row.baseScore,
    variables: (row.variables ?? []) as RuleScorecardVariable[],
    grades: (row.grades ?? []) as RuleScorecardGrade[],
    version: row.version,
    publishedAt: formatNullableDateTime(row.publishedAt),
    dirty,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureRuleScorecard(id: number): Promise<Row> {
  const tc = tenantCondition(ruleScorecards, currentUser());
  return requireFirstRow(
    db.select().from(ruleScorecards).where(buildWhere(eq(ruleScorecards.id, id), tc)).limit(1),
    '评分卡不存在',
  );
}

export async function listRuleScorecards(q: QueryOutputOf<typeof ruleScorecardContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    tenantCondition(ruleScorecards, currentUser()),
    keywordCondition(q.keyword, [ruleScorecards.name]),
    q.status ? eq(ruleScorecards.status, q.status) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(ruleScorecards, where),
    rows: () => db.select().from(ruleScorecards).where(where).orderBy(desc(ruleScorecards.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapRuleScorecard,
  });
}

export async function getRuleScorecard(id: number) {
  return mapRuleScorecard(await ensureRuleScorecard(id));
}

export async function createRuleScorecard(input: CreateRuleScorecardInput) {
  ensureVariableKeysUnique((input.variables ?? []) as RuleScorecardVariable[]);
  try {
    const [row] = await db.insert(ruleScorecards).values({
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      baseScore: input.baseScore ?? 0,
      variables: input.variables ?? [],
      grades: input.grades ?? [],
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    return mapRuleScorecard(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '评分卡 key 已存在');
    throw err;
  }
}

export async function updateRuleScorecard(id: number, input: UpdateRuleScorecardInput) {
  const before = await ensureRuleScorecard(id);
  // 编辑乐观锁：携带打开编辑时的 updatedAt，不一致说明已被他人修改
  if (input.expectedUpdatedAt && formatDateTime(before.updatedAt) !== input.expectedUpdatedAt) {
    throw new HTTPException(409, { message: '评分卡已被他人修改，请刷新后重试' });
  }
  if (input.variables !== undefined) ensureVariableKeysUnique(input.variables as RuleScorecardVariable[]);
  const [row] = await db.update(ruleScorecards).set({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    ...(input.baseScore !== undefined ? { baseScore: input.baseScore } : {}),
    ...(input.variables !== undefined ? { variables: input.variables } : {}),
    ...(input.grades !== undefined ? { grades: input.grades } : {}),
  }).where(eq(ruleScorecards.id, id)).returning();
  invalidateRuleRuntimeCache();
  return mapRuleScorecard(row);
}

export async function deleteRuleScorecard(id: number): Promise<void> {
  const row = await ensureRuleScorecard(id);
  const usages = await findWorkflowGatewayUsages(row.key, 'scorecard', row.tenantId ?? null);
  if (usages.length > 0) {
    const names = usages.slice(0, 3).map((u) => u.name).join('、');
    throw new HTTPException(400, { message: `评分卡「${row.name}」被 ${usages.length} 处工作流引用（${names}${usages.length > 3 ? ' 等' : ''}），请先解除引用后再删除` });
  }
  await db.delete(ruleScorecards).where(eq(ruleScorecards.id, id));
  invalidateRuleRuntimeCache();
}

function ensureVariableKeysUnique(variables: RuleScorecardVariable[]): void {
  const seen = new Set<string>();
  for (const v of variables) {
    if (seen.has(v.key)) throw new HTTPException(400, { message: `变量 key 重复：${v.key}` });
    seen.add(v.key);
  }
}

/** 发布门禁：至少一个变量且各变量至少一个分段；等级映射按 minScore 唯一 */
function ensureScorecardPublishable(row: Row): void {
  const variables = (row.variables ?? []) as RuleScorecardVariable[];
  if (variables.length === 0) throw new HTTPException(400, { message: '评分卡至少需要一个变量' });
  for (const v of variables) {
    if (!v.bands || v.bands.length === 0) throw new HTTPException(400, { message: `变量「${v.label || v.key}」至少需要一个分段` });
  }
  const grades = (row.grades ?? []) as RuleScorecardGrade[];
  const mins = new Set<number>();
  for (const g of grades) {
    if (mins.has(g.minScore)) throw new HTTPException(400, { message: `等级映射 minScore 重复：${g.minScore}` });
    mins.add(g.minScore);
  }
}

/** 发布：固化快照并写版本历史，version +1（首次发布保持 1），状态置 published */
export async function publishRuleScorecard(id: number) {
  const row = await ensureRuleScorecard(id);
  ensureScorecardPublishable(row);
  const nextVersion = row.publishedSnapshot == null ? row.version : row.version + 1;
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(ruleScorecards).set({
      status: 'published',
      publishedAt: new Date(),
      publishedSnapshot: draftSnapshot(row),
      version: nextVersion,
    }).where(eq(ruleScorecards.id, id)).returning();
    await tx.insert(ruleAssetVersions).values({
      refKind: 'scorecard', refId: id, version: nextVersion,
      snapshot: { name: row.name, description: row.description, ...draftSnapshot(row) },
      publishedBy: currentUser()?.userId ?? null,
      tenantId: row.tenantId,
    }).onConflictDoNothing();
    return u;
  });
  invalidateRuleRuntimeCache();
  return mapRuleScorecard(updated);
}

/** 版本历史（元信息，不含快照体） */
export async function listRuleScorecardVersions(id: number) {
  await ensureRuleScorecard(id);
  const rows = await db.select({
    id: ruleAssetVersions.id, refKind: ruleAssetVersions.refKind, refId: ruleAssetVersions.refId,
    version: ruleAssetVersions.version, publishedBy: ruleAssetVersions.publishedBy, publishedAt: ruleAssetVersions.publishedAt,
  }).from(ruleAssetVersions)
    .where(and(eq(ruleAssetVersions.refKind, 'scorecard'), eq(ruleAssetVersions.refId, id)))
    .orderBy(desc(ruleAssetVersions.version));
  return rows.map((r) => ({ ...r, refKind: 'scorecard' as const, publishedAt: formatDateTime(r.publishedAt) }));
}

/** 回滚：用历史版本快照覆盖当前编辑态并置为草稿（不动 publishedSnapshot，线上继续跑既有发布） */
export async function rollbackRuleScorecard(id: number, version: number) {
  await ensureRuleScorecard(id);
  const v = await requireFirstRow(
    db.select().from(ruleAssetVersions)
      .where(and(eq(ruleAssetVersions.refKind, 'scorecard'), eq(ruleAssetVersions.refId, id), eq(ruleAssetVersions.version, version))).limit(1),
    `版本 v${version} 不存在`,
  );
  const snapshot = v.snapshot as { name: string; description: string | null; baseScore: number; variables: RuleScorecardVariable[]; grades: RuleScorecardGrade[] };
  const [row] = await db.update(ruleScorecards)
    .set({
      name: snapshot.name, description: snapshot.description ?? null,
      baseScore: snapshot.baseScore ?? 0, variables: snapshot.variables ?? [], grades: snapshot.grades ?? [],
      status: 'draft',
    })
    .where(eq(ruleScorecards.id, id)).returning();
  invalidateRuleRuntimeCache();
  return mapRuleScorecard(row);
}

export async function toggleRuleScorecard(id: number, enabled: boolean) {
  const row = await ensureRuleScorecard(id);
  if (enabled && row.publishedSnapshot == null) {
    throw new HTTPException(400, { message: '评分卡尚未发布过，请先发布' });
  }
  const [updated] = await db.update(ruleScorecards)
    .set({ status: enabled ? 'published' : 'disabled' })
    .where(eq(ruleScorecards.id, id)).returning();
  invalidateRuleRuntimeCache();
  return mapRuleScorecard(updated);
}

/** 测试求值：按编辑态（草稿）求值，评估「若现在发布」的行为。留痕 source=test */
export async function testEvaluateRuleScorecard(id: number, input: Record<string, unknown>): Promise<RuleScorecardEvaluateResult> {
  const row = await ensureRuleScorecard(id);
  const res = evaluateScorecard(draftSnapshot(row), snapshotRuleScope(input));
  recordRuleExecution({
    refKind: 'scorecard', refId: row.id, ruleKey: row.key, version: null, caller: 'admin.test',
    source: 'test', matched: true, hitPolicy: null,
    input: snapshotRuleScope(input),
    outputs: { totalScore: res.totalScore, baseScore: res.baseScore, grade: res.grade, decision: res.decision },
    matchedRowIds: [], tenantId: row.tenantId ?? null,
  });
  return res;
}

/** 运行时求值：按 key 取发布快照执行（disabled/未发布视为不可用）。留痕 source=manual */
export async function evaluateRuleScorecardByKey(key: string, input: Record<string, unknown>): Promise<RuleScorecardEvaluateResult> {
  const tc = tenantCondition(ruleScorecards, currentUser());
  const [row] = await db.select().from(ruleScorecards).where(buildWhere(
    eq(ruleScorecards.key, key),
    eq(ruleScorecards.status, 'published'),
    tc,
  )).limit(1);
  requireRow(row, `评分卡不可用：${key}`);
  if (row.publishedSnapshot == null) throw new HTTPException(404, { message: `评分卡不可用：${key}` });
  const res = evaluateScorecard(row.publishedSnapshot as ScorecardLike, snapshotRuleScope(input));
  recordRuleExecution({
    refKind: 'scorecard', refId: row.id, ruleKey: key, version: row.version,
    caller: 'admin.evaluate', source: 'manual',
    matched: true, hitPolicy: null,
    input: snapshotRuleScope(input),
    outputs: { totalScore: res.totalScore, baseScore: res.baseScore, grade: res.grade, decision: res.decision },
    matchedRowIds: [], tenantId: row.tenantId ?? null,
  });
  return res;
}
