import { and, desc, eq, like, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type {
  RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleHitPolicy, RuleEvaluateResult,
} from '@zenith/shared';
import { db } from '../db';
import { ruleDecisionTables, ruleDecisionTableVersions } from '../db/schema';
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
