/**
 * 决策流服务（规则中心）：多决策表顺序编排的 CRUD / 发布 / 求值。
 *
 * 生命周期与决策表一致：draft → published →（disabled）；
 * 发布时把编辑态 steps 固化到 publishedSteps（单快照），运行时按 publishedSteps 执行，
 * 引用的决策表始终走其**发布版本快照**（rules.service.resolveRuntimeDecisionTable）。
 */
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { RuleFlowStep, RuleFlowEvaluateResult } from '@zenith/shared/rules';
import { db } from '../../db';
import { ruleDecisionFlows, ruleDecisionTables, ruleAssetVersions } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { validateExpression } from '../../lib/workflow-expression';
import { evaluateDecisionFlowSteps } from '../../lib/rules-flow';
import { resolveRuntimeDecisionTable, resolveDecisionTableForTest, findWorkflowGatewayUsages } from './rules.service';
import { recordRuleExecution, snapshotRuleScope } from './rules-executions.service';
import { invalidateRuleRuntimeCache } from './rules-runtime-cache';

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
  const conds: (SQL | undefined)[] = [eq(ruleDecisionFlows.id, id), tc];
  return requireFirstRow(
    db.select().from(ruleDecisionFlows).where(buildWhere(...conds)).limit(1),
    '决策流不存在',
  );
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
  const conds: (SQL | undefined)[] = [tc];
  conds.push(keywordCondition(q.keyword, [ruleDecisionFlows.name]));
  if (q.status) conds.push(eq(ruleDecisionFlows.status, q.status));
  const where = buildWhere(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(ruleDecisionFlows, where),
    rows: () => db.select().from(ruleDecisionFlows).where(where).orderBy(desc(ruleDecisionFlows.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapDecisionFlow,
  });
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
  invalidateRuleRuntimeCache();
  return mapDecisionFlow(row);
}

/** 删除前校验：仍被工作流网关引用时拒绝删除 */
async function ensureFlowNotReferenced(row: FlowRow): Promise<void> {
  const usages = await findWorkflowGatewayUsages(row.key, 'flow', row.tenantId ?? null);
  if (usages.length === 0) return;
  const names = usages.slice(0, 3).map((u) => u.name).join('、');
  throw new HTTPException(400, { message: `决策流「${row.name}」被 ${usages.length} 处工作流引用（${names}${usages.length > 3 ? ' 等' : ''}），请先解除引用后再删除` });
}

export async function deleteDecisionFlow(id: number): Promise<void> {
  const row = await ensureDecisionFlow(id);
  await ensureFlowNotReferenced(row);
  await db.delete(ruleDecisionFlows).where(eq(ruleDecisionFlows.id, id));
  invalidateRuleRuntimeCache();
}

export async function deleteDecisionFlows(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const tc = tenantCondition(ruleDecisionFlows, currentUser());
  const conds: (SQL | undefined)[] = [inArray(ruleDecisionFlows.id, ids), tc];
  const rows = await db.select().from(ruleDecisionFlows).where(buildWhere(...conds));
  for (const row of rows) await ensureFlowNotReferenced(row);
  await db.delete(ruleDecisionFlows).where(buildWhere(...conds));
  invalidateRuleRuntimeCache();
}

export async function toggleDecisionFlow(id: number, enabled: boolean) {
  const row = await ensureDecisionFlow(id);
  const nextStatus = enabled ? (row.publishedAt ? 'published' as const : 'draft' as const) : 'disabled' as const;
  if (row.status === nextStatus) return mapDecisionFlow(row);
  const [updated] = await db.update(ruleDecisionFlows).set({ status: nextStatus }).where(eq(ruleDecisionFlows.id, id)).returning();
  invalidateRuleRuntimeCache();
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
      const check = validateExpression(s.condition);
      if (!check.valid) errors.push(`${ref} 条件表达式无效：${check.error ?? '语法错误'}`);
    }
    if (s.outputNamespace?.trim() && !NS_PATTERN.test(s.outputNamespace.trim())) {
      errors.push(`${ref} 输出命名空间不是合法标识符`);
    }
  });
  if (errors.length > 0) throw new HTTPException(400, { message: `发布受阻：${errors.slice(0, 5).join('；')}` });

  // 与运行时解析同语义：本租户表优先，回退平台级（null）表；避免误采他租户同 key 表的状态
  const keys = [...new Set(steps.map((s) => s.tableKey))];
  const candidates = await db.select({ key: ruleDecisionTables.key, status: ruleDecisionTables.status, tenantId: ruleDecisionTables.tenantId })
    .from(ruleDecisionTables).where(inArray(ruleDecisionTables.key, keys));
  const flowTenantId = row.tenantId ?? null;
  const resolveStatus = (key: string): string | undefined => {
    const rows = candidates.filter((c) => c.key === key);
    const exact = flowTenantId != null ? rows.find((c) => c.tenantId === flowTenantId) : undefined;
    return (exact ?? rows.find((c) => c.tenantId == null))?.status;
  };
  const bad = keys.filter((k) => resolveStatus(k) !== 'published');
  if (bad.length > 0) throw new HTTPException(400, { message: `发布受阻：引用的决策表未发布或不存在：${bad.join('、')}` });
}

/** 发布：编辑态 steps 固化为 publishedSteps 并写版本快照；首次发布保持版本 1，此后 +1 */
export async function publishDecisionFlow(id: number) {
  const row = await ensureDecisionFlow(id);
  await ensureFlowPublishable(row);
  const nextVersion = row.publishedAt == null ? row.version : row.version + 1;
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(ruleDecisionFlows)
      .set({ status: 'published', publishedSteps: row.steps, publishedAt: new Date(), version: nextVersion })
      .where(eq(ruleDecisionFlows.id, id)).returning();
    await tx.insert(ruleAssetVersions).values({
      refKind: 'flow', refId: id, version: nextVersion,
      snapshot: { name: row.name, description: row.description, steps: row.steps },
      publishedBy: currentUser()?.userId ?? null,
      tenantId: row.tenantId,
    }).onConflictDoNothing();
    return u;
  });
  invalidateRuleRuntimeCache();
  return mapDecisionFlow(updated);
}

/** 版本历史（元信息，不含快照体） */
export async function listDecisionFlowVersions(id: number) {
  await ensureDecisionFlow(id);
  const rows = await db.select({
    id: ruleAssetVersions.id, refKind: ruleAssetVersions.refKind, refId: ruleAssetVersions.refId,
    version: ruleAssetVersions.version, publishedBy: ruleAssetVersions.publishedBy, publishedAt: ruleAssetVersions.publishedAt,
  }).from(ruleAssetVersions)
    .where(and(eq(ruleAssetVersions.refKind, 'flow'), eq(ruleAssetVersions.refId, id)))
    .orderBy(desc(ruleAssetVersions.version));
  return rows.map((r) => ({ ...r, refKind: 'flow' as const, publishedAt: formatDateTime(r.publishedAt) }));
}

/** 回滚：用历史版本快照覆盖当前编辑态并置为草稿（不动 publishedSteps，线上继续跑既有发布） */
export async function rollbackDecisionFlow(id: number, version: number) {
  await ensureDecisionFlow(id);
  const v = await requireFirstRow(
    db.select().from(ruleAssetVersions)
      .where(and(eq(ruleAssetVersions.refKind, 'flow'), eq(ruleAssetVersions.refId, id), eq(ruleAssetVersions.version, version))).limit(1),
    `版本 v${version} 不存在`,
  );
  const snapshot = v.snapshot as { name: string; description: string | null; steps: RuleFlowStep[] };
  const [row] = await db.update(ruleDecisionFlows)
    .set({ name: snapshot.name, description: snapshot.description ?? null, steps: snapshot.steps ?? [], status: 'draft' })
    .where(eq(ruleDecisionFlows.id, id)).returning();
  invalidateRuleRuntimeCache();
  return mapDecisionFlow(row);
}

/** 测试求值：跑编辑态 steps；引用表优先发布快照，未发布草稿回退编辑态。留痕 source=test */
export async function testEvaluateDecisionFlow(id: number, input: Record<string, unknown>): Promise<RuleFlowEvaluateResult> {
  const row = await ensureDecisionFlow(id);
  const res = await evaluateDecisionFlowSteps((row.steps ?? []) as RuleFlowStep[], input, resolveDecisionTableForTest);
  recordRuleExecution({
    refKind: 'flow', refId: row.id, ruleKey: row.key, version: null, caller: 'admin.test',
    source: 'test', matched: res.steps.some((s) => !s.skipped && s.matched), hitPolicy: null,
    input: snapshotRuleScope(input), outputs: res.outputs, matchedRowIds: [], tenantId: row.tenantId ?? null,
  });
  return res;
}

/** 按 key 求值（对外通用）：published 用 publishedSteps；draft 跑编辑态（联调）；禁用报错。留痕 source=manual */
export async function evaluateDecisionFlowByKey(key: string, input: Record<string, unknown>): Promise<RuleFlowEvaluateResult> {
  const tc = tenantCondition(ruleDecisionFlows, currentUser());
  const conds: (SQL | undefined)[] = [eq(ruleDecisionFlows.key, key), tc];
  const row = await requireFirstRow(
    db.select().from(ruleDecisionFlows).where(buildWhere(...conds)).limit(1),
    '决策流不存在',
  );
  if (row.status === 'disabled') throw new HTTPException(400, { message: '决策流已禁用' });
  const usePublished = row.status === 'published' && row.publishedSteps;
  const res = usePublished
    ? await evaluateDecisionFlowSteps((row.publishedSteps ?? []) as RuleFlowStep[], input, (k) => resolveRuntimeDecisionTable(k))
    : await evaluateDecisionFlowSteps((row.steps ?? []) as RuleFlowStep[], input, resolveDecisionTableForTest);
  recordRuleExecution({
    refKind: 'flow', refId: row.id, ruleKey: key, version: usePublished ? row.version : null,
    caller: 'admin.evaluate', source: 'manual',
    matched: res.steps.some((s) => !s.skipped && s.matched), hitPolicy: null,
    input: snapshotRuleScope(input), outputs: res.outputs, matchedRowIds: [],
    tenantId: row.tenantId ?? null,
  });
  return res;
}
