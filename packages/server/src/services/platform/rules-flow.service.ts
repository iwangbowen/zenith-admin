/**
 * 决策流服务（规则中心）：多决策表顺序编排的 CRUD / 发布 / 求值。
 *
 * 生命周期与决策表一致：draft → published →（disabled）；
 * 发布时把编辑态 steps 固化到 publishedSteps（单快照），运行时按 publishedSteps 执行，
 * 引用的决策表始终走其**发布版本快照**（rules.service.resolveRuntimeDecisionTable）。
 */
import { and, desc, eq, like, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { RuleFlowStep, RuleFlowEvaluateResult } from '@zenith/shared';
import { db } from '../../db';
import { ruleDecisionFlows, ruleDecisionTables } from '../../db/schema';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { escapeLike } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { validateExpression } from '../../lib/workflow-expression';
import { evaluateDecisionFlowSteps } from '../../lib/rules-flow';
import { resolveRuntimeDecisionTable, resolveDecisionTableForTest, recordRuleExecution } from './rules.service';

type FlowRow = typeof ruleDecisionFlows.$inferSelect;

const NS_PATTERN = /^[a-zA-Z_$][\w$]*$/;

const stepsComparable = (steps: unknown) => JSON.stringify(steps ?? []);

export function mapDecisionFlow(row: FlowRow) {
  const steps = (row.steps ?? []) as RuleFlowStep[];
  const publishedSteps = (row.publishedSteps ?? null) as RuleFlowStep[] | null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    steps,
    publishedSteps,
    version: row.version,
    publishedAt: formatNullableDateTime(row.publishedAt),
    dirty: publishedSteps ? stepsComparable(steps) !== stepsComparable(publishedSteps) : false,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureDecisionFlow(id: number): Promise<FlowRow> {
  const tc = tenantCondition(ruleDecisionFlows, currentUser());
  const conds = [eq(ruleDecisionFlows.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(ruleDecisionFlows).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '决策流不存在' });
  return row;
}

export interface ListDecisionFlowsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'draft' | 'published' | 'disabled';
}

export async function listDecisionFlows(q: ListDecisionFlowsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const tc = tenantCondition(ruleDecisionFlows, currentUser());
  const conds = [];
  if (tc) conds.push(tc);
  if (q.keyword) conds.push(like(ruleDecisionFlows.name, `%${escapeLike(q.keyword)}%`));
  if (q.status) conds.push(eq(ruleDecisionFlows.status, q.status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(ruleDecisionFlows, where),
    db.select().from(ruleDecisionFlows).where(where).orderBy(desc(ruleDecisionFlows.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapDecisionFlow), total, page, pageSize };
}

export async function getDecisionFlow(id: number) {
  return mapDecisionFlow(await ensureDecisionFlow(id));
}

export async function getDecisionFlowBeforeAudit(id: number) {
  return getDecisionFlow(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
}

export interface CreateDecisionFlowInput {
  key: string;
  name: string;
  description?: string | null;
  steps?: RuleFlowStep[];
}

export async function createDecisionFlow(input: CreateDecisionFlowInput) {
  try {
    const [row] = await db.insert(ruleDecisionFlows).values({
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      steps: input.steps ?? [],
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    return mapDecisionFlow(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '决策流 key 已存在');
  }
}

export type UpdateDecisionFlowInput = Partial<Omit<CreateDecisionFlowInput, 'key'>> & { expectedUpdatedAt?: string };

export async function updateDecisionFlow(id: number, input: UpdateDecisionFlowInput) {
  const current = await ensureDecisionFlow(id);
  if (input.expectedUpdatedAt && formatDateTime(current.updatedAt) !== input.expectedUpdatedAt) {
    throw new HTTPException(409, { message: '决策流已被他人修改，请刷新后重试' });
  }
  const patch: Partial<typeof ruleDecisionFlows.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.steps !== undefined) patch.steps = input.steps;
  const [row] = await db.update(ruleDecisionFlows).set(patch).where(eq(ruleDecisionFlows.id, id)).returning();
  return mapDecisionFlow(row);
}

export async function deleteDecisionFlow(id: number): Promise<void> {
  await ensureDecisionFlow(id);
  await db.delete(ruleDecisionFlows).where(eq(ruleDecisionFlows.id, id));
}

export async function deleteDecisionFlows(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const tc = tenantCondition(ruleDecisionFlows, currentUser());
  const conds = [inArray(ruleDecisionFlows.id, ids)];
  if (tc) conds.push(tc);
  await db.delete(ruleDecisionFlows).where(and(...conds));
}

export async function toggleDecisionFlow(id: number, enabled: boolean) {
  const row = await ensureDecisionFlow(id);
  const nextStatus = enabled ? (row.publishedAt ? 'published' as const : 'draft' as const) : 'disabled' as const;
  if (row.status === nextStatus) return mapDecisionFlow(row);
  const [updated] = await db.update(ruleDecisionFlows).set({ status: nextStatus }).where(eq(ruleDecisionFlows.id, id)).returning();
  return mapDecisionFlow(updated);
}

/** 发布前校验：步骤非空、行内标识/条件表达式合法、引用的决策表存在且已发布 */
async function ensureFlowPublishable(row: FlowRow): Promise<void> {
  const steps = (row.steps ?? []) as RuleFlowStep[];
  if (steps.length === 0) throw new HTTPException(400, { message: '决策流至少需要一个步骤' });
  const errors: string[] = [];
  const ids = new Set<string>();
  steps.forEach((s, i) => {
    const ref = `步骤 ${i + 1}`;
    if (!s.id?.trim()) errors.push(`${ref} 缺少 ID`);
    else if (ids.has(s.id)) errors.push(`${ref} ID 重复`);
    else ids.add(s.id);
    if (!s.tableKey?.trim()) errors.push(`${ref} 未选择决策表`);
    if (s.condition?.trim()) {
      const err = validateExpression(s.condition);
      if (err) errors.push(`${ref} 条件表达式无效：${err}`);
    }
    if (s.outputNamespace?.trim() && !NS_PATTERN.test(s.outputNamespace.trim())) {
      errors.push(`${ref} 输出命名空间不是合法标识符`);
    }
  });
  if (errors.length > 0) throw new HTTPException(400, { message: `发布受阻：${errors.slice(0, 5).join('；')}` });

  const keys = [...new Set(steps.map((s) => s.tableKey))];
  const tables = await db.select({ key: ruleDecisionTables.key, status: ruleDecisionTables.status })
    .from(ruleDecisionTables).where(inArray(ruleDecisionTables.key, keys));
  const statusByKey = new Map(tables.map((t) => [t.key, t.status]));
  const bad = keys.filter((k) => statusByKey.get(k) !== 'published');
  if (bad.length > 0) throw new HTTPException(400, { message: `发布受阻：引用的决策表未发布或不存在：${bad.join('、')}` });
}

/** 发布：编辑态 steps 固化为 publishedSteps，版本 +1 */
export async function publishDecisionFlow(id: number) {
  const row = await ensureDecisionFlow(id);
  await ensureFlowPublishable(row);
  const [updated] = await db.update(ruleDecisionFlows)
    .set({ status: 'published', publishedSteps: row.steps, publishedAt: new Date(), version: row.version + 1 })
    .where(eq(ruleDecisionFlows.id, id)).returning();
  return mapDecisionFlow(updated);
}

/** 测试求值：跑编辑态 steps；引用表优先发布快照，未发布草稿回退编辑态 */
export async function testEvaluateDecisionFlow(id: number, input: Record<string, unknown>): Promise<RuleFlowEvaluateResult> {
  const row = await ensureDecisionFlow(id);
  return evaluateDecisionFlowSteps((row.steps ?? []) as RuleFlowStep[], input, resolveDecisionTableForTest);
}

/** 按 key 求值（对外通用）：published 用 publishedSteps；draft 跑编辑态（联调）；禁用报错 */
export async function evaluateDecisionFlowByKey(key: string, input: Record<string, unknown>): Promise<RuleFlowEvaluateResult> {
  const tc = tenantCondition(ruleDecisionFlows, currentUser());
  const conds = [eq(ruleDecisionFlows.key, key)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(ruleDecisionFlows).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '决策流不存在' });
  if (row.status === 'disabled') throw new HTTPException(400, { message: '决策流已禁用' });
  if (row.status === 'published' && row.publishedSteps) {
    return evaluateDecisionFlowSteps((row.publishedSteps ?? []) as RuleFlowStep[], input, (k) => resolveRuntimeDecisionTable(k));
  }
  return evaluateDecisionFlowSteps((row.steps ?? []) as RuleFlowStep[], input, resolveDecisionTableForTest);
}

/**
 * 运行时按 key 求值（供业务侧调用）：只跑已发布快照；不可用返回空输出（不阻断流程）。
 * 各步骤写执行流水（nodeKey = flow:{flowKey}#{步骤序号}）供 trace/审计。
 */
export async function getDecisionFlowOutputs(key: string, scope: Record<string, unknown>, meta?: { tenantId?: number | null }): Promise<Record<string, unknown>> {
  try {
    const tenantId = meta?.tenantId !== undefined
      ? meta.tenantId
      : (() => { const u = currentUserOrNull(); return u ? (u.viewingTenantId ?? u.tenantId ?? null) : undefined; })();
    const candidates = await db.select().from(ruleDecisionFlows).where(eq(ruleDecisionFlows.key, key));
    const row = (tenantId != null ? candidates.find((r) => r.tenantId === tenantId) : undefined)
      ?? candidates.find((r) => r.tenantId == null)
      ?? (tenantId === undefined && candidates.length === 1 ? candidates[0] : undefined);
    if (!row || row.status !== 'published' || !row.publishedSteps) return {};
    const res = await evaluateDecisionFlowSteps(
      (row.publishedSteps ?? []) as RuleFlowStep[],
      scope,
      (k) => resolveRuntimeDecisionTable(k, { tenantId }),
      (trace, index) => {
        if (trace.skipped) return;
        recordRuleExecution({
          ruleKey: trace.tableKey, tableId: null, instanceId: null,
          nodeKey: `flow:${key}#${index + 1}`, source: 'runtime',
          matched: trace.matched, hitPolicy: 'first',
          input: scope, outputs: trace.outputs, matchedRowIds: trace.matchedRowIds, tenantId: row.tenantId ?? null,
        });
      },
    );
    return res.outputs;
  } catch { return {}; }
}
