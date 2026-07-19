import { and, desc, eq, like, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type {
  RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleHitPolicy, RuleEvaluateResult, RuleTestRunResult, RuleCaseResult,
} from '@zenith/shared';
import { db } from '../../db';
import { ruleDecisionTables, ruleDecisionTableVersions, ruleTestCases, ruleDecisionExecutions } from '../../db/schema';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { escapeLike } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { evaluateDecisionTable } from '../../lib/rules-engine';
import { diffDecisionSnapshots } from '../../lib/rules-version-diff';

type TableRow = typeof ruleDecisionTables.$inferSelect;
type VersionRow = typeof ruleDecisionTableVersions.$inferSelect;

/** 发布快照会固化的字段序列化（用于 dirty 判定：编辑态 vs 最新快照） */
const snapshotComparable = (r: { name: string; description: string | null; hitPolicy: string; inputs: unknown; outputs: unknown; rules: unknown }) =>
  JSON.stringify([r.name, r.description ?? null, r.hitPolicy, r.inputs ?? [], r.outputs ?? [], r.rules ?? []]);

async function latestVersionOf(tableId: number): Promise<VersionRow | null> {
  const [v] = await db.select().from(ruleDecisionTableVersions)
    .where(eq(ruleDecisionTableVersions.tableId, tableId))
    .orderBy(desc(ruleDecisionTableVersions.version)).limit(1);
  return v ?? null;
}

export function mapDecisionTable(row: TableRow, latestVersion?: VersionRow | null) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    categoryId: row.categoryId ?? null,
    status: row.status,
    hitPolicy: row.hitPolicy,
    inputs: (row.inputs ?? []) as RuleDecisionInput[],
    outputs: (row.outputs ?? []) as RuleDecisionOutput[],
    rules: (row.rules ?? []) as RuleDecisionRow[],
    version: row.version,
    publishedAt: formatNullableDateTime(row.publishedAt),
    dirty: latestVersion === undefined ? undefined : (latestVersion ? snapshotComparable(row) !== snapshotComparable(latestVersion) : false),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapDecisionTableVersion(row: VersionRow) {
  return {
    id: row.id,
    tableId: row.tableId,
    version: row.version,
    name: row.name,
    hitPolicy: row.hitPolicy,
    inputs: (row.inputs ?? []) as RuleDecisionInput[],
    outputs: (row.outputs ?? []) as RuleDecisionOutput[],
    rules: (row.rules ?? []) as RuleDecisionRow[],
    publishedAt: formatDateTime(row.publishedAt),
    publishedBy: row.publishedBy ?? null,
  };
}

export async function ensureDecisionTable(id: number): Promise<TableRow> {
  const tc = tenantCondition(ruleDecisionTables, currentUser());
  const conds = [eq(ruleDecisionTables.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(ruleDecisionTables).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '决策表不存在' });
  return row;
}

export interface ListDecisionTablesQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'draft' | 'published' | 'disabled';
}

export async function listDecisionTables(q: ListDecisionTablesQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const tc = tenantCondition(ruleDecisionTables, currentUser());
  const conds = [];
  if (tc) conds.push(tc);
  if (q.keyword) conds.push(like(ruleDecisionTables.name, `%${escapeLike(q.keyword)}%`));
  if (q.status) conds.push(eq(ruleDecisionTables.status, q.status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(ruleDecisionTables, where),
    db.select().from(ruleDecisionTables).where(where).orderBy(desc(ruleDecisionTables.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  // dirty 标记：批量取本页各表最新快照并与编辑态对比
  const ids = rows.map((r) => r.id);
  const versionRows = ids.length
    ? await db.select().from(ruleDecisionTableVersions).where(inArray(ruleDecisionTableVersions.tableId, ids)).orderBy(desc(ruleDecisionTableVersions.version))
    : [];
  const latestByTable = new Map<number, VersionRow>();
  for (const v of versionRows) if (!latestByTable.has(v.tableId)) latestByTable.set(v.tableId, v);
  return { list: rows.map((r) => mapDecisionTable(r, latestByTable.get(r.id) ?? null)), total, page, pageSize };
}

export async function getDecisionTable(id: number) {
  const row = await ensureDecisionTable(id);
  return mapDecisionTable(row, await latestVersionOf(id));
}

export async function getDecisionTableBeforeAudit(id: number) {
  return getDecisionTable(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
}

export interface CreateDecisionTableInput {
  key: string;
  name: string;
  description?: string | null;
  categoryId?: number | null;
  hitPolicy?: RuleHitPolicy;
  inputs?: RuleDecisionInput[];
  outputs?: RuleDecisionOutput[];
  rules?: RuleDecisionRow[];
}

export async function createDecisionTable(input: CreateDecisionTableInput) {
  try {
    const [row] = await db.insert(ruleDecisionTables).values({
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      hitPolicy: input.hitPolicy ?? 'first',
      inputs: input.inputs ?? [],
      outputs: input.outputs ?? [],
      rules: input.rules ?? [],
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    return mapDecisionTable(row, null);
  } catch (err) {
    rethrowPgUniqueViolation(err, '决策表 key 已存在');
  }
}

export type UpdateDecisionTableInput = Partial<Omit<CreateDecisionTableInput, 'key'>> & { expectedUpdatedAt?: string };

export async function updateDecisionTable(id: number, input: UpdateDecisionTableInput) {
  const current = await ensureDecisionTable(id);
  // 编辑乐观锁：打开编辑后被他人修改过则拒绝提交
  if (input.expectedUpdatedAt && formatDateTime(current.updatedAt) !== input.expectedUpdatedAt) {
    throw new HTTPException(409, { message: '决策表已被他人修改，请刷新后重试' });
  }
  const tc = tenantCondition(ruleDecisionTables, currentUser());
  const conds = [eq(ruleDecisionTables.id, id)];
  if (tc) conds.push(tc);
  const patch: Partial<typeof ruleDecisionTables.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
  if (input.hitPolicy !== undefined) patch.hitPolicy = input.hitPolicy;
  if (input.inputs !== undefined) patch.inputs = input.inputs;
  if (input.outputs !== undefined) patch.outputs = input.outputs;
  if (input.rules !== undefined) patch.rules = input.rules;
  const [row] = await db.update(ruleDecisionTables).set(patch).where(and(...conds)).returning();
  if (!row) throw new HTTPException(404, { message: '决策表不存在' });
  invalidateRuleRuntimeCache();
  return mapDecisionTable(row, await latestVersionOf(id));
}

export async function deleteDecisionTable(id: number): Promise<void> {
  await ensureDecisionTable(id);
  const tc = tenantCondition(ruleDecisionTables, currentUser());
  const conds = [eq(ruleDecisionTables.id, id)];
  if (tc) conds.push(tc);
  await db.delete(ruleDecisionTables).where(and(...conds));
  invalidateRuleRuntimeCache();
}

export async function deleteDecisionTables(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const tc = tenantCondition(ruleDecisionTables, currentUser());
  const conds = [inArray(ruleDecisionTables.id, ids)];
  if (tc) conds.push(tc);
  await db.delete(ruleDecisionTables).where(and(...conds));
  invalidateRuleRuntimeCache();
}

/** 启用/停用：停用后运行时求值不可用；启用恢复为已发布（曾发布过）或草稿 */
export async function toggleDecisionTable(id: number, enabled: boolean) {
  const row = await ensureDecisionTable(id);
  const nextStatus = enabled ? (row.publishedAt ? 'published' as const : 'draft' as const) : 'disabled' as const;
  if (row.status === nextStatus) return mapDecisionTable(row, await latestVersionOf(id));
  const [updated] = await db.update(ruleDecisionTables).set({ status: nextStatus })
    .where(eq(ruleDecisionTables.id, id)).returning();
  invalidateRuleRuntimeCache();
  return mapDecisionTable(updated, await latestVersionOf(id));
}

/** 发布：写版本快照、版本号 +1、状态置 published、记录发布时间 */
export async function publishDecisionTable(id: number) {
  const row = await ensureDecisionTable(id);
  if (!row.inputs || (row.inputs as RuleDecisionInput[]).length === 0) throw new HTTPException(400, { message: '决策表至少需要一个输入列' });
  if (!row.outputs || (row.outputs as RuleDecisionOutput[]).length === 0) throw new HTTPException(400, { message: '决策表至少需要一个输出列' });
  if (!row.rules || (row.rules as RuleDecisionRow[]).length === 0) throw new HTTPException(400, { message: '决策表至少需要一条规则' });
  // 发布门禁：用例必须全部通过；存在用例时规则行需 100% 覆盖
  const run = await runTestCases(id);
  if (run.failed > 0) throw new HTTPException(400, { message: `发布受阻：${run.failed}/${run.total} 个测试用例未通过` });
  if (run.total > 0 && run.coverage < 100) throw new HTTPException(400, { message: `发布受阻：规则覆盖率 ${run.coverage}%，未覆盖行 ${run.uncoveredRowIds.join(', ')}` });
  const mapped = await db.transaction(async (tx) => {
    await tx.insert(ruleDecisionTableVersions).values({
      tableId: row.id,
      version: row.version,
      name: row.name,
      description: row.description,
      hitPolicy: row.hitPolicy,
      inputs: row.inputs,
      outputs: row.outputs,
      rules: row.rules,
      publishedBy: currentUser()?.userId ?? null,
      tenantId: row.tenantId,
    });
    const [updated] = await tx.update(ruleDecisionTables)
      .set({ status: 'published', publishedAt: new Date(), version: row.version + 1 })
      .where(eq(ruleDecisionTables.id, id)).returning();
    // 刚发布：编辑态与最新快照必然一致
    return { ...mapDecisionTable(updated), dirty: false };
  });
  // 事务提交后再失效，避免提交前被旧数据回填
  invalidateRuleRuntimeCache();
  return mapped;
}

export async function listDecisionTableVersions(id: number) {
  await ensureDecisionTable(id);
  const rows = await db.select().from(ruleDecisionTableVersions)
    .where(eq(ruleDecisionTableVersions.tableId, id)).orderBy(desc(ruleDecisionTableVersions.version));
  return rows.map(mapDecisionTableVersion);
}

// ─── 运行时快照解析与缓存 ──────────────────────────────────────────────────────
// 缓存已解析的运行时快照（含"不可用"负缓存），发布/回滚/更新/删除/启停时全量失效；
// TTL 兜底防多实例部署下的长期漂移。
interface RuntimeSnapshot {
  tableId: number;
  tenantId: number | null;
  hitPolicy: RuleHitPolicy;
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
}
const RUNTIME_CACHE_TTL_MS = 60_000;
const runtimeCache = new Map<string, { at: number; value: RuntimeSnapshot | null }>();

export function invalidateRuleRuntimeCache(): void {
  runtimeCache.clear();
}

/** 运行时求值使用的租户：显式指定 > 当前登录用户生效租户 > 无上下文（member/cron 场景） */
function runtimeTenantId(explicit?: number | null): number | null | undefined {
  if (explicit !== undefined) return explicit;
  const u = currentUserOrNull();
  if (!u) return undefined;
  return u.viewingTenantId ?? u.tenantId ?? null;
}

/** 按 key + 租户解析决策表行：租户精确匹配优先，回退平台级（tenantId 为 null）表 */
async function resolveTableRowByKey(key: string, tenantId: number | null | undefined): Promise<TableRow | null> {
  const candidates = await db.select().from(ruleDecisionTables).where(eq(ruleDecisionTables.key, key));
  if (candidates.length === 0) return null;
  if (tenantId != null) {
    const exact = candidates.find((r) => r.tenantId === tenantId);
    if (exact) return exact;
  }
  const global = candidates.find((r) => r.tenantId == null);
  if (global) return global;
  // 无租户上下文且无平台级表：仅剩单一候选时使用（兼容单租户历史数据）
  return tenantId === undefined && candidates.length === 1 ? candidates[0] : null;
}

/**
 * 加载运行时快照：已发布/曾发布的表用发布版本快照（默认最新，可 pin 指定版本），
 * 编辑态修改不影响线上；disabled 或从未发布的草稿运行时不可用。
 * published 但无快照的历史数据回退当前配置（兼容旧库）。
 */
async function loadRuntimeSnapshot(key: string, opts?: { tenantId?: number | null; version?: number }): Promise<RuntimeSnapshot | null> {
  const tenantId = runtimeTenantId(opts?.tenantId);
  const cacheKey = `${tenantId === undefined ? 'ctxless' : tenantId ?? 'global'}|${key}|${opts?.version ?? 'latest'}`;
  const hit = runtimeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < RUNTIME_CACHE_TTL_MS) return hit.value;

  const resolve = async (): Promise<RuntimeSnapshot | null> => {
    const row = await resolveTableRowByKey(key, tenantId);
    if (!row || row.status === 'disabled') return null;
    const versionConds = [eq(ruleDecisionTableVersions.tableId, row.id)];
    if (opts?.version !== undefined) versionConds.push(eq(ruleDecisionTableVersions.version, opts.version));
    const [snapshot] = await db.select().from(ruleDecisionTableVersions)
      .where(and(...versionConds)).orderBy(desc(ruleDecisionTableVersions.version)).limit(1);
    if (snapshot) {
      return {
        tableId: row.id,
        tenantId: row.tenantId ?? null,
        hitPolicy: snapshot.hitPolicy,
        inputs: (snapshot.inputs ?? []) as RuleDecisionInput[],
        outputs: (snapshot.outputs ?? []) as RuleDecisionOutput[],
        rules: (snapshot.rules ?? []) as RuleDecisionRow[],
      };
    }
    if (opts?.version !== undefined) return null; // pin 的版本不存在
    if (row.status !== 'published') return null;  // 从未发布的草稿运行时不可用
    return {
      tableId: row.id,
      tenantId: row.tenantId ?? null,
      hitPolicy: row.hitPolicy,
      inputs: (row.inputs ?? []) as RuleDecisionInput[],
      outputs: (row.outputs ?? []) as RuleDecisionOutput[],
      rules: (row.rules ?? []) as RuleDecisionRow[],
    };
  };

  const value = await resolve();
  runtimeCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** 按 key 求值（对外通用）：已发布用最新发布快照；草稿直接跑编辑态（便于联调）；禁用报错 */
export async function evaluateDecisionTableByKey(key: string, input: Record<string, unknown>): Promise<RuleEvaluateResult> {
  const tc = tenantCondition(ruleDecisionTables, currentUser());
  const conds = [eq(ruleDecisionTables.key, key)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(ruleDecisionTables).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '决策表不存在' });
  if (row.status === 'disabled') throw new HTTPException(400, { message: '决策表已禁用' });
  if (row.status === 'published') {
    const [snapshot] = await db.select().from(ruleDecisionTableVersions)
      .where(eq(ruleDecisionTableVersions.tableId, row.id))
      .orderBy(desc(ruleDecisionTableVersions.version)).limit(1);
    if (snapshot) {
      return evaluateDecisionTable({
        hitPolicy: snapshot.hitPolicy,
        inputs: (snapshot.inputs ?? []) as RuleDecisionInput[],
        outputs: (snapshot.outputs ?? []) as RuleDecisionOutput[],
        rules: (snapshot.rules ?? []) as RuleDecisionRow[],
      }, input);
    }
  }
  return evaluateDecisionTable({
    hitPolicy: row.hitPolicy,
    inputs: (row.inputs ?? []) as RuleDecisionInput[],
    outputs: (row.outputs ?? []) as RuleDecisionOutput[],
    rules: (row.rules ?? []) as RuleDecisionRow[],
  }, input);
}

/** 测试求值：按 id 跑当前编辑态配置，无需发布 */
export async function testEvaluateDecisionTable(id: number, input: Record<string, unknown>): Promise<RuleEvaluateResult> {
  const row = await ensureDecisionTable(id);
  return evaluateDecisionTable({
    hitPolicy: row.hitPolicy,
    inputs: (row.inputs ?? []) as RuleDecisionInput[],
    outputs: (row.outputs ?? []) as RuleDecisionOutput[],
    rules: (row.rules ?? []) as RuleDecisionRow[],
  }, input);
}

/**
 * 运行时按 key 求值，返回输出键值；表不存在/禁用/未发布/异常一律返回空对象（不阻断流程）。
 * 始终基于**发布版本快照**求值（默认最新，meta.version 可 pin 指定版本），编辑态修改不影响线上。
 * collect 策略下各输出键聚合为数组；可选写执行记录供 trace/审计。
 */
export async function getDecisionOutputs(
  key: string,
  scope: Record<string, unknown>,
  meta?: { instanceId?: number | null; nodeKey?: string | null; source?: 'runtime' | 'manual' | 'test'; version?: number; tenantId?: number | null },
): Promise<Record<string, unknown>> {
  try {
    const snapshot = await loadRuntimeSnapshot(key, { tenantId: meta?.tenantId, version: meta?.version });
    if (!snapshot) return {};
    const res = evaluateDecisionTable(snapshot, scope);
    // collect：把每个输出键聚合为数组，供包容网关 contains/in 命中多分支
    const merged = res.hitPolicy === 'collect' && res.collected?.length
      ? Object.fromEntries(snapshot.outputs.map((o) => [o.key, res.collected!.map((c) => c[o.key])]))
      : res.outputs;
    await db.insert(ruleDecisionExecutions).values({
      ruleKey: key, tableId: snapshot.tableId, instanceId: meta?.instanceId ?? null, nodeKey: meta?.nodeKey ?? null,
      source: meta?.source ?? 'runtime', matched: res.matched, hitPolicy: res.hitPolicy,
      input: scope, outputs: merged, matchedRowIds: res.matchedRowIds, tenantId: snapshot.tenantId,
    }).catch(() => undefined);
    return res.matched ? merged : {};
  } catch { return {}; }
}

export async function listDecisionExecutions(q: { instanceId?: number; tableId?: number; limit?: number }) {
  const conds = [];
  if (q.instanceId) conds.push(eq(ruleDecisionExecutions.instanceId, q.instanceId));
  if (q.tableId) conds.push(eq(ruleDecisionExecutions.tableId, q.tableId));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(ruleDecisionExecutions).where(where).orderBy(desc(ruleDecisionExecutions.id)).limit(q.limit ?? 50);
  return rows.map((r) => ({ id: r.id, ruleKey: r.ruleKey, tableId: r.tableId, instanceId: r.instanceId, nodeKey: r.nodeKey, source: r.source as 'runtime' | 'manual' | 'test', matched: r.matched, hitPolicy: r.hitPolicy, input: (r.input ?? {}) as Record<string, unknown>, outputs: (r.outputs ?? {}) as Record<string, unknown>, matchedRowIds: (r.matchedRowIds ?? []) as string[], createdAt: formatDateTime(r.createdAt) }));
}

/** 测试用例 CRUD + 批跑 + 覆盖率 */
type CaseRow = typeof ruleTestCases.$inferSelect;
const mapCase = (r: CaseRow) => ({ id: r.id, tableId: r.tableId, name: r.name, input: (r.input ?? {}) as Record<string, unknown>, expected: (r.expected ?? {}) as Record<string, unknown>, createdAt: formatDateTime(r.createdAt), updatedAt: formatDateTime(r.updatedAt) });

export async function listTestCases(tableId: number) {
  await ensureDecisionTable(tableId);
  const rows = await db.select().from(ruleTestCases).where(eq(ruleTestCases.tableId, tableId)).orderBy(desc(ruleTestCases.id));
  return rows.map(mapCase);
}
export async function createTestCase(tableId: number, input: { name: string; input?: Record<string, unknown>; expected?: Record<string, unknown> }) {
  await ensureDecisionTable(tableId);
  try {
    const [row] = await db.insert(ruleTestCases).values({ tableId, name: input.name, input: input.input ?? {}, expected: input.expected ?? {}, tenantId: getCreateTenantId(currentUser()) }).returning();
    return mapCase(row);
  } catch (err) { rethrowPgUniqueViolation(err, '用例名称已存在'); }
}
export async function updateTestCase(tableId: number, caseId: number, input: { name?: string; input?: Record<string, unknown>; expected?: Record<string, unknown> }) {
  await ensureDecisionTable(tableId);
  const patch: Partial<typeof ruleTestCases.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.input !== undefined) patch.input = input.input;
  if (input.expected !== undefined) patch.expected = input.expected;
  try {
    const [row] = await db.update(ruleTestCases).set(patch).where(and(eq(ruleTestCases.id, caseId), eq(ruleTestCases.tableId, tableId))).returning();
    if (!row) throw new HTTPException(404, { message: '测试用例不存在' });
    return mapCase(row);
  } catch (err) { rethrowPgUniqueViolation(err, '用例名称已存在'); }
}
export async function deleteTestCase(tableId: number, caseId: number): Promise<void> {
  await db.delete(ruleTestCases).where(and(eq(ruleTestCases.id, caseId), eq(ruleTestCases.tableId, tableId)));
}

const deepEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 批跑用例：逐例求值对比 expected，并统计规则行覆盖率 */
export async function runTestCases(tableId: number): Promise<RuleTestRunResult> {
  const row = await ensureDecisionTable(tableId);
  const table = { hitPolicy: row.hitPolicy, inputs: (row.inputs ?? []) as RuleDecisionInput[], outputs: (row.outputs ?? []) as RuleDecisionOutput[], rules: (row.rules ?? []) as RuleDecisionRow[] };
  const cases = await db.select().from(ruleTestCases).where(eq(ruleTestCases.tableId, tableId));
  const covered = new Set<string>();
  const results: RuleCaseResult[] = cases.map((c) => {
    const res = evaluateDecisionTable(table, (c.input ?? {}) as Record<string, unknown>);
    res.matchedRowIds.forEach((id) => covered.add(id));
    return { id: c.id, name: c.name, pass: deepEqual(res.outputs, c.expected), expected: (c.expected ?? {}) as Record<string, unknown>, actual: res.outputs };
  });
  const total = results.length, passed = results.filter((r) => r.pass).length;
  const allRowIds = table.rules.map((r) => r.id);
  const uncoveredRowIds = allRowIds.filter((id) => !covered.has(id));
  const coverage = allRowIds.length ? Math.round((allRowIds.length - uncoveredRowIds.length) / allRowIds.length * 100) : 100;
  return { total, passed, failed: total - passed, coverage, uncoveredRowIds, cases: results };
}

const toSnapshot = (r: { name: string; hitPolicy: string; inputs: unknown; outputs: unknown; rules: unknown }) => ({
  name: r.name, hitPolicy: r.hitPolicy,
  inputs: (r.inputs ?? []) as RuleDecisionInput[], outputs: (r.outputs ?? []) as RuleDecisionOutput[], rules: (r.rules ?? []) as RuleDecisionRow[],
});

async function loadSnapshot(id: number, version: number, current: TableRow): Promise<{ name: string; hitPolicy: string; inputs: RuleDecisionInput[]; outputs: RuleDecisionOutput[]; rules: RuleDecisionRow[] }> {
  if (version === 0) return toSnapshot(current);
  const [v] = await db.select().from(ruleDecisionTableVersions).where(and(eq(ruleDecisionTableVersions.tableId, id), eq(ruleDecisionTableVersions.version, version))).limit(1);
  if (!v) throw new HTTPException(404, { message: `版本 v${version} 不存在` });
  return toSnapshot(v);
}

/** 对比两个版本（0 表示当前编辑态） */
export async function diffDecisionTableVersions(id: number, from: number, to: number) {
  const row = await ensureDecisionTable(id);
  const [a, b] = await Promise.all([loadSnapshot(id, from, row), loadSnapshot(id, to, row)]);
  return diffDecisionSnapshots(from, to, a, b);
}

/** 回滚：用历史版本快照覆盖当前编辑态，置为草稿（不丢历史版本） */
export async function rollbackDecisionTable(id: number, version: number) {
  await ensureDecisionTable(id);
  const [v] = await db.select().from(ruleDecisionTableVersions).where(and(eq(ruleDecisionTableVersions.tableId, id), eq(ruleDecisionTableVersions.version, version))).limit(1);
  if (!v) throw new HTTPException(404, { message: `版本 v${version} 不存在` });
  const [row] = await db.update(ruleDecisionTables)
    .set({ name: v.name, description: v.description, hitPolicy: v.hitPolicy, inputs: v.inputs, outputs: v.outputs, rules: v.rules, status: 'draft' })
    .where(eq(ruleDecisionTables.id, id)).returning();
  invalidateRuleRuntimeCache();
  return mapDecisionTable(row, await latestVersionOf(id));
}
