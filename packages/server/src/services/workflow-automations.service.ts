/**
 * 流程级自动化规则 service
 *
 * 当某个流程定义的实例进入终结状态（approved/rejected/withdrawn）时，
 * 触发其上配置的自动化动作（如发起新审批流程、发送站内消息）。
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import {
  workflowAutomations,
  workflowDefinitions,
  workflowInstances,
  workflowTasks,
  inAppMessages,
  users,
  type WorkflowAutomationRow,
  type WorkflowAutomationActionConfig,
} from '../db/schema';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { pageOffset } from '../lib/pagination';
import { formatDateTime } from '../lib/datetime';
import { workflowEventBus } from '../lib/workflow-event-bus';
import { createInstance } from './workflow-instances.service';
import { httpRequest } from '../lib/http-client';
import logger from '../lib/logger';
import type { WorkflowAutomationTrigger, WorkflowInstance } from '@zenith/shared';

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
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function ensureAutomationExists(id: number) {
  const tc = tenantCondition(workflowAutomations, currentUser());
  const conds = [eq(workflowAutomations.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowAutomations).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '自动化规则不存在' });
  return row;
}

async function ensureDefinitionExists(definitionId: number) {
  const tc = tenantCondition(workflowDefinitions, currentUser());
  const conds = [eq(workflowDefinitions.id, definitionId)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowDefinitions).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '流程定义不存在' });
  return row;
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
  }
}

export interface ListWorkflowAutomationsQuery {
  definitionId?: number;
  trigger?: WorkflowAutomationTrigger;
  status?: 'enabled' | 'disabled';
  page?: number;
  pageSize?: number;
}

export async function listWorkflowAutomations(q: ListWorkflowAutomationsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const tc = tenantCondition(workflowAutomations, currentUser());
  const conds = [];
  if (tc) conds.push(tc);
  if (q.definitionId) conds.push(eq(workflowAutomations.definitionId, q.definitionId));
  if (q.trigger) conds.push(eq(workflowAutomations.trigger, q.trigger));
  if (q.status) conds.push(eq(workflowAutomations.status, q.status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowAutomations, where),
    db.query.workflowAutomations.findMany({
      where,
      orderBy: [asc(workflowAutomations.sort), desc(workflowAutomations.id)],
      limit: pageSize,
      offset: pageOffset(page, pageSize),
      with: { definition: { columns: { name: true } } },
    }),
  ]);
  const list = rows.map((r) => mapAutomation(r, r.definition?.name ?? null));
  return { list, total, page, pageSize };
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
  if (!row) throw new HTTPException(404, { message: '自动化规则不存在' });
  return mapAutomation(row);
}

export async function deleteWorkflowAutomation(id: number) {
  await ensureAutomationExists(id);
  await db.delete(workflowAutomations).where(eq(workflowAutomations.id, id));
}

export async function batchDeleteWorkflowAutomations(ids: number[]) {
  if (!ids.length) return 0;
  const tc = tenantCondition(workflowAutomations, currentUser());
  const conds = [inArray(workflowAutomations.id, ids)];
  if (tc) conds.push(tc);
  const result = await db.delete(workflowAutomations).where(and(...conds)).returning({ id: workflowAutomations.id });
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
  recipientIds = Array.from(new Set(recipientIds.filter((v) => Number.isInteger(v) && v > 0)));
  if (!recipientIds.length) return;
  const vars = buildTemplateVars(ctx);
  const title = renderTemplate(action.title, vars);
  let content = renderTemplate(action.content, vars);
  if (action.buttons?.length) {
    const lines = action.buttons.slice(0, 3).map((b) => `[${b.text}](${b.url})`);
    content = `${content}\n\n${lines.join('  ')}`;
  }
  const rows = recipientIds.map((uid) => ({
    userId: uid,
    title,
    content,
    type: action.messageType ?? 'info',
    isRead: false,
    source: 'system' as const,
    tenantId: ctx.instance.tenantId,
  }));
  await db.insert(inAppMessages).values(rows);
}

async function runWebhookAction(
  action: Extract<WorkflowAutomationActionConfig, { type: 'webhook' }>,
  ctx: AutomationContext,
) {
  const vars = buildTemplateVars(ctx);
  const url = renderTemplate(action.url, vars);
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
  await httpRequest(url, {
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

export async function executeAutomationsForInstance(
  instance: WorkflowInstance,
  trigger: WorkflowAutomationTrigger,
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
    for (const action of actions) {
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
      } catch (err) {
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

/** 在应用启动时调用，订阅工作流终结事件 */
export function registerWorkflowAutomationSubscribers() {
  const handleTriggerEvent = (trigger: WorkflowAutomationTrigger) => async (e: { instance: WorkflowInstance }) => {
    try {
      await executeAutomationsForInstance(e.instance, trigger);
    } catch (err) {
      logger.error('[workflow-automation] subscriber error', { trigger, instanceId: e.instance?.id, err });
    }
  };
  workflowEventBus.on('instance.approved', handleTriggerEvent('approved'));
  workflowEventBus.on('instance.rejected', handleTriggerEvent('rejected'));
  workflowEventBus.on('instance.withdrawn', handleTriggerEvent('withdrawn'));
  workflowEventBus.on('instance.created', handleTriggerEvent('created'));
}
