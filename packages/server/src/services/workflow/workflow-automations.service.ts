import { workflowAutomationContract, workflowAutomationSchema, workflowAutomationRunSchema, assertWorkflowAutomationTemplateSyntax, WorkflowAutomationTemplateError } from '@zenith/shared/workflow';
import { isPlainObject, type QueryOutputOf } from '@zenith/shared/core';
/**
 * 流程级自动化规则 service
 *
 * 当某个流程定义的实例进入终结状态（approved/rejected/withdrawn）时，
 * 触发其上配置的自动化动作（如发起新审批流程、发送站内消息）。
 */
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  workflowAutomations,
  workflowJobs,
  workflowJobExecutions,
  workflowDefinitions,
  type WorkflowAutomationRow,
  type WorkflowAutomationActionConfig,
  type WorkflowJobRow,
  type WorkflowJobExecutionRow,
} from '../../db/schema';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime } from '../../lib/datetime';
import { assertSafeWorkflowUrl } from '../../lib/workflow-outbound';
import type { CreateWorkflowAutomationInput, UpdateWorkflowAutomationInput } from '@zenith/shared/workflow';
import { buildWhere } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { pickEntity } from '../../lib/entity-map';
import { retryJob } from '../../lib/workflow-jobs/engine';
import { parseAutomationActionPayload } from './workflow-automation-runtime';

export function mapAutomation(row: WorkflowAutomationRow, definitionName?: string | null) {
  return pickEntity(workflowAutomationSchema, row, { definitionName: definitionName ?? null, actions: row.actions ?? [] });
}

async function ensureAutomationExists(id: number) {
  return requireFirstRow(
    db.select().from(workflowAutomations)
      .where(buildWhere(eq(workflowAutomations.id, id), tenantCondition(workflowAutomations, currentUser()))).limit(1),
    '自动化规则不存在',
  );
}

export async function getWorkflowAutomationBeforeAudit(id: number) {
  return getWorkflowAutomation(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
}

export async function getWorkflowAutomationsBeforeAudit(ids: number[]) {
  if (!ids.length) return [];
  const rows = await db.query.workflowAutomations.findMany({
    where: buildWhere(inArray(workflowAutomations.id, ids), tenantCondition(workflowAutomations, currentUser())),
    orderBy: [asc(workflowAutomations.sort), desc(workflowAutomations.id)],
    with: { definition: { columns: { name: true } } },
  });
  return rows.map((r) => mapAutomation(r, r.definition?.name ?? null));
}

async function ensureDefinitionExists(definitionId: number) {
  return requireFirstRow(
    db.select().from(workflowDefinitions)
      .where(buildWhere(eq(workflowDefinitions.id, definitionId), tenantCondition(workflowDefinitions, currentUser()))).limit(1),
    '流程定义不存在',
  );
}

async function ensureStartWorkflowActionTarget(definitionId: number) {
  const def = await ensureDefinitionExists(definitionId);
  if (def.formType === 'external') {
    throw new HTTPException(400, { message: '自动化「发起流程」动作不能选择业务系统主导流程，请由业务模块发起该类流程' });
  }
}

async function validateAutomationActions(actions: WorkflowAutomationActionConfig[]) {
  try { actions.forEach(assertWorkflowAutomationTemplateSyntax); }
  catch (error) {
    if (error instanceof WorkflowAutomationTemplateError) throw new HTTPException(400, { message: error.message });
    throw error;
  }
  for (const action of actions) {
    if (action.type === 'startWorkflow') {
      await ensureStartWorkflowActionTarget(action.definitionId);
    }
    // Webhook 目标地址保存时即做出站校验；含占位符的模板只能校验协议 / 静态主机部分，运行时还会再拦一次
    if (action.type === 'webhook' && action.url && !/\{\{/.test(action.url)) {
      await assertSafeWorkflowUrl(action.url);
    }
  }
}

export async function listWorkflowAutomations(q: QueryOutputOf<typeof workflowAutomationContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    tenantCondition(workflowAutomations, currentUser()),
    q.definitionId ? eq(workflowAutomations.definitionId, q.definitionId) : undefined,
    q.trigger ? eq(workflowAutomations.trigger, q.trigger) : undefined,
    q.status ? eq(workflowAutomations.status, q.status) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(workflowAutomations, where),
    rows: () => db.query.workflowAutomations.findMany({
      where,
      orderBy: [asc(workflowAutomations.sort), desc(workflowAutomations.id)],
      limit: pageSize,
      offset: pageOffset(page, pageSize),
      with: { definition: { columns: { name: true } } },
    }),
    map: (r) => mapAutomation(r, r.definition?.name ?? null),
  });
}

export async function listWorkflowAutomationRuns(q: QueryOutputOf<typeof workflowAutomationContract.runs>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    eq(workflowJobs.jobType, 'automation_action'),
    tenantCondition(workflowJobs, currentUser()),
    q.ruleId ? sql`${workflowJobs.payload}->>'ruleId' = ${String(q.ruleId)}` : undefined,
    q.instanceId ? eq(workflowJobs.instanceId, q.instanceId) : undefined,
    q.status ? eq(workflowJobs.status, q.status) : undefined,
  );
  return buildListResult({
    page, pageSize, count: () => db.$count(workflowJobs, where),
    rows: () => db.query.workflowJobs.findMany({ where, orderBy: [desc(workflowJobs.id)], limit: pageSize,
      offset: pageOffset(page, pageSize), with: { executions: { orderBy: [desc(workflowJobExecutions.id)], limit: 1 } } }),
    map: mapAutomationRun,
  });
}

export function mapAutomationRun(row: WorkflowJobRow & { executions?: WorkflowJobExecutionRow[] }) {
  const payload = parseAutomationActionPayload(row.payload as Record<string, unknown>);
  const externalOutcomeUncertain = row.lastError?.startsWith('外部操作结果待确认') ?? false;
  const result = isPlainObject(row.result) ? row.result : {};
  return pickEntity(workflowAutomationRunSchema, row, {
    ruleId: payload.ruleId, ruleName: payload.ruleName, instanceTitle: payload.context.instance.title,
    targetInstanceId: typeof result.targetInstanceId === 'number' ? result.targetInstanceId : null,
    targetTitle: typeof result.targetTitle === 'string' ? result.targetTitle : null,
    trigger: payload.trigger, actionIndex: payload.actionIndex, actionType: payload.action.type, eventId: payload.eventId,
    error: row.lastError, durationMs: row.executions?.[0]?.durationMs ?? null,
    nextRetryAt: row.status === 'pending' && row.attempts > 0 ? formatDateTime(row.runAt) : null,
    canRetry: ['failed', 'dead'].includes(row.status) && !externalOutcomeUncertain, externalOutcomeUncertain,
  });
}

export async function retryWorkflowAutomationRun(id: number) {
  const row = await db.query.workflowJobs.findFirst({ where: buildWhere(eq(workflowJobs.id, id),
    eq(workflowJobs.jobType, 'automation_action'), tenantCondition(workflowJobs, currentUser())),
  with: { executions: { orderBy: [desc(workflowJobExecutions.id)], limit: 1 } } });
  requireRow(row, '自动化动作不存在');
  const run = mapAutomationRun(row);
  if (!run.canRetry) throw new HTTPException(409, { message: run.externalOutcomeUncertain
    ? '外部操作结果待确认，请先核对下游执行结果，不能直接重发' : '仅失败或死信的自动化动作可以重试' });
  const retried = requireRow(await retryJob(id), '动作状态已变化，请刷新后重试', 409);
  return mapAutomationRun(retried);
}

export async function getWorkflowAutomation(id: number) {
  const row = await ensureAutomationExists(id);
  const [def] = await db.select({ name: workflowDefinitions.name }).from(workflowDefinitions).where(eq(workflowDefinitions.id, row.definitionId)).limit(1);
  return mapAutomation(row, def?.name ?? null);
}

export type { CreateWorkflowAutomationInput, UpdateWorkflowAutomationInput } from '@zenith/shared/workflow';

export async function createWorkflowAutomation(input: CreateWorkflowAutomationInput) {
  await ensureDefinitionExists(input.definitionId);
  await validateAutomationActions(input.actions);
  const [row] = await db.insert(workflowAutomations).values({
    definitionId: input.definitionId,
    name: input.name,
    trigger: input.trigger,
    actions: input.actions,
    status: input.status ?? 'enabled',
    sort: input.sort ?? 0,
    tenantId: getCreateTenantId(currentUser()),
  }).returning();
  return mapAutomation(row);
}

export async function updateWorkflowAutomation(id: number, input: UpdateWorkflowAutomationInput) {
  await ensureAutomationExists(id);
  const patch: Partial<typeof workflowAutomations.$inferInsert> = {};
  if (input.definitionId !== undefined) {
    await ensureDefinitionExists(input.definitionId);
    patch.definitionId = input.definitionId;
  }
  if (input.name !== undefined) patch.name = input.name;
  if (input.trigger !== undefined) patch.trigger = input.trigger;
  if (input.actions !== undefined) patch.actions = input.actions;
  if (input.actions !== undefined) await validateAutomationActions(input.actions);
  if (input.status !== undefined) patch.status = input.status;
  if (input.sort !== undefined) patch.sort = input.sort;
  const [row] = await db.update(workflowAutomations).set(patch).where(eq(workflowAutomations.id, id)).returning();
  return mapAutomation(requireRow(row, '自动化规则不存在'));
}

export async function deleteWorkflowAutomation(id: number) {
  await ensureAutomationExists(id);
  await db.delete(workflowAutomations).where(eq(workflowAutomations.id, id));
}

export async function batchDeleteWorkflowAutomations(ids: number[]) {
  if (!ids.length) return 0;
  const result = await db.delete(workflowAutomations)
    .where(buildWhere(inArray(workflowAutomations.id, ids), tenantCondition(workflowAutomations, currentUser())))
    .returning({ id: workflowAutomations.id });
  return result.length;
}
