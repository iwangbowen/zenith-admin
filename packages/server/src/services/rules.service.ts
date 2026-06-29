import { and, desc, eq, like, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type {
  RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleHitPolicy, RuleEvaluateResult, RuleTestRunResult, RuleCaseResult,
} from '@zenith/shared';
import { db } from '../db';
import { ruleDecisionTables, ruleDecisionTableVersions, ruleTestCases, ruleDecisionExecutions } from '../db/schema';
import { currentUser } from '../lib/context';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { escapeLike } from '../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { pageOffset } from '../lib/pagination';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import { evaluateDecisionTable } from '../lib/rules-engine';
import { diffDecisionSnapshots } from '../lib/rules-version-diff';

type TableRow = typeof ruleDecisionTables.$inferSelect;
type VersionRow = typeof ruleDecisionTableVersions.$inferSelect;

export function mapDecisionTable(row: TableRow) {
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
  return { list: rows.map(mapDecisionTable), total, page, pageSize };
}

export async function getDecisionTable(id: number) {
  return mapDecisionTable(await ensureDecisionTable(id));
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
    return mapDecisionTable(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '决策表 key 已存在');
  }
}

export type UpdateDecisionTableInput = Partial<Omit<CreateDecisionTableInput, 'key'>>;

export async function updateDecisionTable(id: number, input: UpdateDecisionTableInput) {
  await ensureDecisionTable(id);
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
  return mapDecisionTable(row);
}

export async function deleteDecisionTable(id: number): Promise<void> {
  await ensureDecisionTable(id);
  const tc = tenantCondition(ruleDecisionTables, currentUser());
  const conds = [eq(ruleDecisionTables.id, id)];
  if (tc) conds.push(tc);
  await db.delete(ruleDecisionTables).where(and(...conds));
}

export async function deleteDecisionTables(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const tc = tenantCondition(ruleDecisionTables, currentUser());
  const conds = [inArray(ruleDecisionTables.id, ids)];
  if (tc) conds.push(tc);
  await db.delete(ruleDecisionTables).where(and(...conds));
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
  return db.transaction(async (tx) => {
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
    return mapDecisionTable(updated);
  });
}

export async function listDecisionTableVersions(id: number) {
  await ensureDecisionTable(id);
  const rows = await db.select().from(ruleDecisionTableVersions)
    .where(eq(ruleDecisionTableVersions.tableId, id)).orderBy(desc(ruleDecisionTableVersions.version));
  return rows.map(mapDecisionTableVersion);
}

/** 求值：草稿用当前配置直跑（便于测试），已发布优先用最新版本快照 */
export async function evaluateDecisionTableByKey(key: string, input: Record<string, unknown>): Promise<RuleEvaluateResult> {
  const tc = tenantCondition(ruleDecisionTables, currentUser());
  const conds = [eq(ruleDecisionTables.key, key)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(ruleDecisionTables).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '决策表不存在' });
  if (row.status === 'disabled') throw new HTTPException(400, { message: '决策表已禁用' });
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

/** 运行时按 key 求值，返回输出键值；表不存在/禁用/异常一律返回空对象（不阻断流程）。collect 策略下各输出键聚合为数组；可选写执行记录供 trace/审计。 */
export async function getDecisionOutputs(key: string, scope: Record<string, unknown>, meta?: { instanceId?: number | null; nodeKey?: string | null; source?: 'runtime' | 'manual' | 'test' }): Promise<Record<string, unknown>> {
  try {
    const [row] = await db.select().from(ruleDecisionTables).where(eq(ruleDecisionTables.key, key)).limit(1);
    if (!row || row.status === 'disabled') return {};
    const outputs = (row.outputs ?? []) as RuleDecisionOutput[];
    const res = evaluateDecisionTable({
      hitPolicy: row.hitPolicy,
      inputs: (row.inputs ?? []) as RuleDecisionInput[],
      outputs,
      rules: (row.rules ?? []) as RuleDecisionRow[],
    }, scope);
    // collect：把每个输出键聚合为数组，供包容网关 contains/in 命中多分支
    const merged = res.hitPolicy === 'collect' && res.collected?.length
      ? Object.fromEntries(outputs.map((o) => [o.key, res.collected!.map((c) => c[o.key])]))
      : res.outputs;
    await db.insert(ruleDecisionExecutions).values({
      ruleKey: key, tableId: row.id, instanceId: meta?.instanceId ?? null, nodeKey: meta?.nodeKey ?? null,
      source: meta?.source ?? 'runtime', matched: res.matched, hitPolicy: res.hitPolicy,
      input: scope, outputs: merged, matchedRowIds: res.matchedRowIds, tenantId: row.tenantId,
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
  return mapDecisionTable(row);
}
