import { workflowAutomationContract } from '@zenith/shared/workflow';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 流程级自动化规则 service
 *
 * 当某个流程定义的实例进入终结状态（approved/rejected/withdrawn）时，
 * 触发其上配置的自动化动作（如发起新审批流程、发送站内消息）。
 */
import { uniquePositiveInts } from '@zenith/shared/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  workflowAutomations,
  workflowAutomationRuns,
  workflowDefinitions,
  workflowInstances,
  workflowTasks,
  users,
  type WorkflowAutomationRow,
  type WorkflowAutomationActionConfig,
} from '../../db/schema';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatTimestamps } from '../../lib/datetime';
import { workflowEventBus } from '../../lib/workflow-event-bus';
import { createInstance } from './workflow-instances.service';
import { assertSafeWorkflowUrl, renderUrlTemplate, workflowHttp } from '../../lib/workflow-outbound';
import redis from '../../lib/redis';
import { config } from '../../config';
import logger from '../../lib/logger';
import { notify } from '../messaging/notification-outbox.service';
import type { WorkflowAutomationTrigger, WorkflowInstance } from '@zenith/shared/workflow';
import { buildWhere } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';

export function mapAutomation(row: WorkflowAutomationRow, definitionName?: string | null) {
  return {
    id: row.id,
    definitionId: row.definitionId,
    definitionName: definitionName ?? null,
    name: row.name,
    trigger: row.trigger,
    actions: row.actions ?? [],
    status: row.status,
    sort: row.sort,
    tenantId: row.tenantId,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

async function ensureAutomationExists(id: number) {
  const [row] = await db.select().from(workflowAutomations)
    .where(buildWhere(eq(workflowAutomations.id, id), tenantCondition(workflowAutomations, currentUser()))).limit(1);
  return requireRow(row, '自动化规则不存在');
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
  const [row] = await db.select().from(workflowDefinitions)
    .where(buildWhere(eq(workflowDefinitions.id, definitionId), tenantCondition(workflowDefinitions, currentUser()))).limit(1);
  return requireRow(row, '流程定义不存在');
}

async function ensureStartWorkflowActionTarget(definitionId: number) {
  const def = await ensureDefinitionExists(definitionId);
  if (def.formType === 'external') {
    throw new HTTPException(400, { message: '自动化「发起流程」动作不能选择业务系统主导流程，请由业务模块发起该类流程' });
  }
}

async function validateAutomationActions(actions: WorkflowAutomationActionConfig[]) {
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
    tenantCondition(workflowAutomationRuns, currentUser()),
    q.ruleId ? eq(workflowAutomationRuns.ruleId, q.ruleId) : undefined,
    q.instanceId ? eq(workflowAutomationRuns.instanceId, q.instanceId) : undefined,
    q.status ? eq(workflowAutomationRuns.status, q.status) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(workflowAutomationRuns, where),
    rows: () => db.select().from(workflowAutomationRuns).where(where)
      .orderBy(desc(workflowAutomationRuns.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    map: (r) => ({
      id: r.id,
      ruleId: r.ruleId,
      ruleName: r.ruleName,
      instanceId: r.instanceId,
      instanceTitle: r.instanceTitle,
      trigger: r.trigger,
      actionIndex: r.actionIndex,
      actionType: r.actionType,
      status: r.status as 'success' | 'failed' | 'skipped',
      error: r.error,
      durationMs: r.durationMs,
      tenantId: r.tenantId,
      createdAt: formatDateTime(r.createdAt),
    }),
  });
}

export async function getWorkflowAutomation(id: number) {
  const row = await ensureAutomationExists(id);
  const [def] = await db.select({ name: workflowDefinitions.name }).from(workflowDefinitions).where(eq(workflowDefinitions.id, row.definitionId)).limit(1);
  return mapAutomation(row, def?.name ?? null);
}

export interface CreateWorkflowAutomationInput {
  definitionId: number;
  name: string;
  trigger: WorkflowAutomationTrigger;
  actions: WorkflowAutomationActionConfig[];
  status?: 'enabled' | 'disabled';
  sort?: number;
}

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

export type UpdateWorkflowAutomationInput = Partial<CreateWorkflowAutomationInput>;

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

// ─── 执行器 ─────────────────────────────────────────────────────────────────

interface AutomationContext {
  instance: WorkflowInstance;
  initiatorId: number;
  initiatorName: string;
  formData: Record<string, unknown>;
  currentApproverIds: number[];
}

function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return '';
  });
}

function buildTemplateVars(ctx: AutomationContext): Record<string, unknown> {
  return {
    instanceId: ctx.instance.id,
    title: ctx.instance.title,
    status: ctx.instance.status,
    initiator: ctx.initiatorName,
    initiatorId: ctx.initiatorId,
    ...ctx.formData,
  };
}

async function runStartWorkflowAction(
  action: Extract<WorkflowAutomationActionConfig, { type: 'startWorkflow' }>,
  ctx: AutomationContext,
) {
  const vars = buildTemplateVars(ctx);
  const title = action.titleTemplate ? renderTemplate(action.titleTemplate, vars) : `由「${ctx.instance.title}」触发`;
  const formData: Record<string, unknown> = {};
  if (action.formMapping) {
    for (const [targetField, sourceExpr] of Object.entries(action.formMapping)) {
      formData[targetField] = renderTemplate(sourceExpr, vars);
    }
  }
  const tenantId = ctx.instance.tenantId;
  await createInstance(
    { definitionId: action.definitionId, title, formData },
    { userId: ctx.initiatorId, username: ctx.initiatorName, tenantId, roles: [] },
  );
}

async function runSendMessageAction(
  action: Extract<WorkflowAutomationActionConfig, { type: 'sendMessage' }>,
  ctx: AutomationContext,
) {
  let recipientIds: number[] = [];
  if (!action.recipients || action.recipients === 'initiator') {
    recipientIds = [ctx.initiatorId];
  } else if (typeof action.recipients === 'object' && Array.isArray(action.recipients.userIds)) {
    recipientIds = action.recipients.userIds;
  }
  recipientIds = uniquePositiveInts(recipientIds);
  if (!recipientIds.length) return;
  const vars = buildTemplateVars(ctx);
  const title = renderTemplate(action.title, vars);
  let content = renderTemplate(action.content, vars);
  if (action.buttons?.length) {
    const lines = action.buttons.slice(0, 3).map((b) => `[${b.text}](${b.url})`);
    content = `${content}\n\n${lines.join('  ')}`;
  }
  // 统一走通知中心：标题正文由规则配置决定，事件模板原样透传；
  // 消息视觉类型通过渠道参数指定，投递留痕与 WS 推送由派发层负责
  await notify('workflow.automation.message', {
    recipients: recipientIds.map((id) => ({ type: 'user' as const, id })),
    vars: { instanceId: ctx.instance.id, title, content },
    tenantId: ctx.instance.tenantId,
    channelOptions: { inapp: { type: action.messageType ?? 'info' } },
  });
}

async function runWebhookAction(
  action: Extract<WorkflowAutomationActionConfig, { type: 'webhook' }>,
  ctx: AutomationContext,
) {
  const vars = buildTemplateVars(ctx);
  // URL 里的占位值（含发起人填写的表单字段）百分号编码，只能落成一个值而不能改写路径 / 主机
  const url = renderUrlTemplate(action.url, (key) => vars[key]);
  if (!url) return;
  const method = action.method ?? 'POST';
  let body: Record<string, unknown> | string | undefined;
  if (method !== 'GET') {
    if (action.bodyTemplate) {
      const rendered = renderTemplate(action.bodyTemplate, vars);
      try {
        body = JSON.parse(rendered) as Record<string, unknown>;
      } catch {
        body = rendered;
      }
    } else {
      body = {
        instanceId: ctx.instance.id,
        title: ctx.instance.title,
        status: ctx.instance.status,
        initiatorId: ctx.initiatorId,
        initiator: ctx.initiatorName,
        formData: ctx.formData,
      };
    }
  }
  await workflowHttp(url, {
    method,
    headers: action.headers,
    body,
    timeout: 10000,
    retries: 1,
  });
}

async function runUpdateFieldAction(
  action: Extract<WorkflowAutomationActionConfig, { type: 'updateField' }>,
  ctx: AutomationContext,
) {
  const entries = Object.entries(action.fields ?? {});
  if (!entries.length) return;
  const vars = buildTemplateVars(ctx);
  const patch: Record<string, unknown> = {};
  for (const [key, expr] of entries) {
    patch[key] = renderTemplate(expr, vars);
  }
  const nextFormData = { ...ctx.formData, ...patch };
  ctx.formData = nextFormData;
  await db.update(workflowInstances)
    .set({ formData: nextFormData })
    .where(eq(workflowInstances.id, ctx.instance.id));
}

async function loadAutomationContext(instance: WorkflowInstance): Promise<AutomationContext> {
  const [initiator] = await db
    .select({ id: users.id, username: users.username, nickname: users.nickname })
    .from(users)
    .where(eq(users.id, instance.initiatorId))
    .limit(1);
  const initiatorName = initiator?.nickname ?? initiator?.username ?? `user#${instance.initiatorId}`;
  const taskRows = await db
    .select({ assigneeId: workflowTasks.assigneeId })
    .from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, instance.id), eq(workflowTasks.status, 'pending')));
  const currentApproverIds = Array.from(
    new Set(taskRows.map((r) => r.assigneeId).filter((v): v is number => v != null)),
  );
  return {
    instance,
    initiatorId: instance.initiatorId,
    initiatorName,
    formData: (instance.formData as Record<string, unknown>) ?? {},
    currentApproverIds,
  };
}

/** 动作执行留痕：写入失败仅告警，不影响动作本身的执行结果 */
async function recordAutomationRun(entry: {
  rule: WorkflowAutomationRow;
  instance: WorkflowInstance;
  trigger: WorkflowAutomationTrigger;
  actionIndex: number;
  actionType: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string | null;
  durationMs?: number | null;
}) {
  try {
    await db.insert(workflowAutomationRuns).values({
      ruleId: entry.rule.id,
      ruleName: entry.rule.name,
      instanceId: entry.instance.id,
      instanceTitle: entry.instance.title?.slice(0, 256) ?? null,
      trigger: entry.trigger,
      actionIndex: entry.actionIndex,
      actionType: entry.actionType,
      status: entry.status,
      error: entry.error ? String(entry.error).slice(0, 512) : null,
      durationMs: entry.durationMs ?? null,
      tenantId: entry.rule.tenantId,
    });
  } catch (err) {
    logger.warn('[workflow-automation] record run failed', { ruleId: entry.rule.id, err });
  }
}

export async function executeAutomationsForInstance(
  instance: WorkflowInstance,
  trigger: WorkflowAutomationTrigger,
  /** 触发事件 ID；提供时按 (事件, 规则, 动作) 幂等去重，防止事件重试/重放导致动作重复执行 */
  eventId?: string,
) {
  const rules = await db
    .select()
    .from(workflowAutomations)
    .where(
      and(
        eq(workflowAutomations.definitionId, instance.definitionId),
        eq(workflowAutomations.trigger, trigger),
        eq(workflowAutomations.status, 'enabled'),
      ),
    )
    .orderBy(asc(workflowAutomations.sort), asc(workflowAutomations.id));
  if (!rules.length) return;
  const ctx = await loadAutomationContext(instance);
  for (const rule of rules) {
    const actions = rule.actions ?? [];
    for (const [actionIndex, action] of actions.entries()) {
      const dedupKey = eventId ? buildAutomationDedupKey(eventId, rule.id, actionIndex) : null;
      if (dedupKey && !(await acquireAutomationDedup(dedupKey))) {
        logger.info('[workflow-automation] action skipped (already executed)', {
          ruleId: rule.id, instanceId: instance.id, actionType: action.type, eventId,
        });
        await recordAutomationRun({ rule, instance, trigger, actionIndex, actionType: action.type, status: 'skipped' });
        continue;
      }
      const startedAt = Date.now();
      try {
        if (action.type === 'startWorkflow') {
          await runStartWorkflowAction(action, ctx);
        } else if (action.type === 'sendMessage') {
          await runSendMessageAction(action, ctx);
        } else if (action.type === 'webhook') {
          await runWebhookAction(action, ctx);
        } else if (action.type === 'updateField') {
          await runUpdateFieldAction(action, ctx);
        }
        await recordAutomationRun({
          rule, instance, trigger, actionIndex, actionType: action.type,
          status: 'success', durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        // 执行失败释放幂等占位，允许事件作业层重试时再次执行该动作
        if (dedupKey) await releaseAutomationDedup(dedupKey);
        await recordAutomationRun({
          rule, instance, trigger, actionIndex, actionType: action.type,
          status: 'failed', durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
        logger.error('[workflow-automation] action failed', {
          ruleId: rule.id,
          instanceId: instance.id,
          actionType: action.type,
          err,
        });
      }
    }
  }
}

const AUTOMATION_DEDUP_PREFIX = `${config.redis.keyPrefix}wf:automation:`;
/** 幂等键 TTL：覆盖 event_dispatch 作业重试窗口与人工重放（replay-outbox）的常见时间范围 */
const AUTOMATION_DEDUP_TTL_SECONDS = 3 * 24 * 60 * 60;

function buildAutomationDedupKey(eventId: string, ruleId: number, actionIndex: number): string {
  return `${AUTOMATION_DEDUP_PREFIX}${eventId}:${ruleId}:${actionIndex}`;
}

/** SET NX 抢占动作执行权；Redis 异常时放行（fail-open）并记警告，避免自动化被基础设施故障阻断 */
async function acquireAutomationDedup(key: string): Promise<boolean> {
  try {
    const result = await redis.set(key, '1', 'EX', AUTOMATION_DEDUP_TTL_SECONDS, 'NX');
    return result === 'OK';
  } catch (err) {
    logger.warn('[workflow-automation] dedup acquire failed, executing anyway', { key, err });
    return true;
  }
}

async function releaseAutomationDedup(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (err) {
    logger.warn('[workflow-automation] dedup release failed', { key, err });
  }
}

/** 在应用启动时调用，订阅工作流终结事件 */
export function registerWorkflowAutomationSubscribers() {
  const handleTriggerEvent = (trigger: WorkflowAutomationTrigger) => async (e: { eventId: string; instance: WorkflowInstance }) => {
    try {
      await executeAutomationsForInstance(e.instance, trigger, e.eventId);
    } catch (err) {
      logger.error('[workflow-automation] subscriber error', { trigger, instanceId: e.instance?.id, err });
    }
  };
  workflowEventBus.on('instance.approved', handleTriggerEvent('approved'));
  workflowEventBus.on('instance.rejected', handleTriggerEvent('rejected'));
  workflowEventBus.on('instance.withdrawn', handleTriggerEvent('withdrawn'));
  workflowEventBus.on('instance.created', handleTriggerEvent('created'));
}
