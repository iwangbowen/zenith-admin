import { and, asc, eq } from 'drizzle-orm';
import { isPlainObject, uniquePositiveInts } from '@zenith/shared/core';
import { workflowAutomationActionSchema, assertWorkflowAutomationTemplateSyntax, renderWorkflowAutomationBody, renderWorkflowAutomationFields, renderWorkflowAutomationText,
  resolveWorkflowAutomationVariable, WorkflowAutomationTemplateError, type WorkflowAutomationTemplateContext,
  type WorkflowAutomationAction, type WorkflowAutomationTrigger, type WorkflowEvent, type WorkflowInstance } from '@zenith/shared/workflow';
import { users, workflowAutomations, workflowInstances, workflowJobEffects, workflowJobExecutions, type WorkflowJobRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { exactTenantCondition } from '../../lib/tenant';
import { enqueueJob } from '../../lib/workflow-jobs/engine';
import { WorkflowJobError, WorkflowJobPermanentError } from '../../lib/workflow-jobs/errors';
import { readWorkflowJobStepResult, runWorkflowJobStep } from '../../lib/workflow-jobs/steps';
import type { WorkflowJobContext, WorkflowJobResult } from '../../lib/workflow-jobs/types';
import { renderUrlTemplate, workflowHttp } from '../../lib/workflow-outbound';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { bindWorkflowFormAttachments } from './workflow-attachments.service';
import { createInstance } from './workflow-instances.service';
import { requireRow } from '../../lib/db-assert';

const MAX_ATTEMPTS = 5;
const CONTINUATION_STEP = 'automation-continuation';
const FIELD_STEP = 'automation-update-fields';
const WEBHOOK_STEP = 'automation-webhook';

interface AutomationContext {
  instance: WorkflowInstance;
  initiatorId: number;
  initiatorName: string;
  formData: Record<string, unknown>;
}
interface FrozenAutomationAction {
  ruleId: number;
  ruleName: string;
  trigger: WorkflowAutomationTrigger;
  actionIndex: number;
  action: WorkflowAutomationAction;
}
export interface AutomationActionPayload extends Record<string, unknown>, FrozenAutomationAction {
  eventId: string;
  position: number;
  context: AutomationContext;
  remainingActions: FrozenAutomationAction[];
}

export function parseAutomationActionPayload(raw: Record<string, unknown>): AutomationActionPayload {
  if (typeof raw.eventId !== 'string' || !Number.isInteger(raw.position) || !Number.isInteger(raw.ruleId)
    || typeof raw.ruleName !== 'string' || !Number.isInteger(raw.actionIndex) || !isPlainObject(raw.context)
    || !isPlainObject(raw.context.instance) || !isPlainObject(raw.context.formData) || !Array.isArray(raw.remainingActions)) {
    throw new WorkflowJobPermanentError('automation_action: 冻结动作或输入缺失');
  }
  if (!workflowAutomationActionSchema.safeParse(raw.action).success) {
    throw new WorkflowJobPermanentError('automation_action: 冻结动作配置无效');
  }
  return raw as AutomationActionPayload;
}

function templateContext(ctx: AutomationContext): WorkflowAutomationTemplateContext {
  return { system: { instanceId: ctx.instance.id, title: ctx.instance.title, status: ctx.instance.status,
    initiator: ctx.initiatorName, initiatorId: ctx.initiatorId }, formData: ctx.formData };
}

function enqueueAction(tx: DbTransaction, eventId: string, position: number, action: FrozenAutomationAction,
  context: AutomationContext, remainingActions: FrozenAutomationAction[]) {
  return enqueueJob({
    jobType: 'automation_action', instanceId: context.instance.id, tenantId: context.instance.tenantId,
    payload: { ...action, eventId, position, context, remainingActions }, maxAttempts: MAX_ATTEMPTS,
    idempotencyKey: `automation:${eventId}:${position}`, traceId: eventId,
  }, tx);
}

/** Persist a frozen chain once per event. Enqueue failures propagate to event_dispatch. */
export async function enqueueWorkflowAutomationsForEvent(event: WorkflowEvent): Promise<void> {
  const triggerByType = { 'instance.created': 'created', 'instance.approved': 'approved',
    'instance.rejected': 'rejected', 'instance.withdrawn': 'withdrawn' } as const;
  if (!(event.type in triggerByType) || !('instance' in event)) return;
  const trigger = triggerByType[event.type as keyof typeof triggerByType];
  await runWorkflowJobStep('automation-fanout', async (tx) => {
    const rules = await tx.select().from(workflowAutomations).where(and(
      eq(workflowAutomations.definitionId, event.instance.definitionId), eq(workflowAutomations.trigger, trigger),
      eq(workflowAutomations.status, 'enabled'), exactTenantCondition(workflowAutomations.tenantId, event.tenantId ?? null),
    )).orderBy(asc(workflowAutomations.sort), asc(workflowAutomations.id));
    const actions: FrozenAutomationAction[] = rules.flatMap((rule) => rule.actions.map((action, actionIndex) => ({
      ruleId: rule.id, ruleName: rule.name, trigger, actionIndex, action,
    })));
    if (!actions.length) return { jobId: null };
    const [initiator] = await tx.select({ username: users.username, nickname: users.nickname }).from(users)
      .where(eq(users.id, event.instance.initiatorId)).limit(1);
    const context: AutomationContext = {
      instance: event.instance, initiatorId: event.instance.initiatorId,
      initiatorName: initiator?.nickname ?? initiator?.username ?? `user#${event.instance.initiatorId}`,
      formData: event.instance.formData ?? {},
    };
    const first = await enqueueAction(tx, event.eventId, 0, actions[0], context, actions.slice(1));
    return { jobId: first?.id ?? null };
  });
}

async function enqueueContinuation(tx: DbTransaction, payload: AutomationActionPayload, formData: Record<string, unknown>) {
  const [next, ...remaining] = payload.remainingActions;
  const job = next ? await enqueueAction(tx, payload.eventId, payload.position + 1, next,
    { ...payload.context, formData }, remaining) : null;
  return { nextJobId: job?.id ?? null };
}

/** Called in the ledger settlement transaction to cover crashes before the handler's finally. */
export async function settleWorkflowAutomationAction(tx: DbTransaction, job: WorkflowJobRow): Promise<void> {
  if (job.status === 'canceled') return;
  let payload: AutomationActionPayload;
  try { payload = parseAutomationActionPayload(job.payload as Record<string, unknown>); }
  catch (error) { if (error instanceof WorkflowJobPermanentError) return; throw error; }
  const receipts = await tx.select({ effectKey: workflowJobEffects.effectKey, result: workflowJobEffects.result })
    .from(workflowJobEffects).where(eq(workflowJobEffects.operationKey, job.operationKey));
  if (receipts.some((receipt) => receipt.effectKey === CONTINUATION_STEP)) return;
  const fieldResult = receipts.find((receipt) => receipt.effectKey === FIELD_STEP)?.result;
  const formData = isPlainObject(fieldResult) && isPlainObject(fieldResult.formData)
    ? fieldResult.formData : payload.context.formData;
  const result = await enqueueContinuation(tx, payload, formData);
  await tx.insert(workflowJobEffects).values({ jobId: job.id, operationKey: job.operationKey, effectKey: CONTINUATION_STEP, result });
}

async function startWorkflow(action: Extract<WorkflowAutomationAction, { type: 'startWorkflow' }>, ctx: AutomationContext) {
  const vars = templateContext(ctx);
  const formData = renderWorkflowAutomationFields(action.formMapping ?? {}, vars);
  const instance = await createInstance({ definitionId: action.definitionId,
    title: action.titleTemplate ? renderWorkflowAutomationText(action.titleTemplate, vars) : `由「${ctx.instance.title}」触发`, formData },
  { userId: ctx.initiatorId, username: ctx.initiatorName, tenantId: ctx.instance.tenantId, roles: [] }, [], 'automation-start-workflow');
  return { targetInstanceId: instance.id, targetTitle: instance.title };
}
async function sendMessage(action: Extract<WorkflowAutomationAction, { type: 'sendMessage' }>, ctx: AutomationContext, operationKey: string) {
  const recipientIds = uniquePositiveInts(typeof action.recipients === 'object' ? action.recipients.userIds : [ctx.initiatorId]);
  const vars = templateContext(ctx);
  const title = renderWorkflowAutomationText(action.title, vars);
  let content = renderWorkflowAutomationText(action.content, vars);
  if (action.buttons?.length) content += `\n\n${action.buttons.slice(0, 3).map((b) =>
    `[${renderWorkflowAutomationText(b.text, vars)}](${renderUrlTemplate(b.url, (key) => resolveWorkflowAutomationVariable(key, vars))})`).join('  ')}`;
  return runWorkflowJobStep('automation-send-message', async (tx) => ({ notificationId: await notifyWithin(tx, 'workflow.automation.message', {
    recipients: recipientIds.map((id) => ({ type: 'user' as const, id })), vars: { instanceId: ctx.instance.id, title, content },
    tenantId: ctx.instance.tenantId, dedupeKey: `automation:${operationKey}`, channelOptions: { inapp: { type: action.messageType ?? 'info' } },
  }) }));
}
async function updateField(action: Extract<WorkflowAutomationAction, { type: 'updateField' }>, ctx: AutomationContext) {
  const patch = renderWorkflowAutomationFields(action.fields, templateContext(ctx));
  const result = await runWorkflowJobStep(FIELD_STEP, async (tx) => {
    const scope = and(eq(workflowInstances.id, ctx.instance.id), exactTenantCondition(workflowInstances.tenantId, ctx.instance.tenantId));
    const [instance] = await tx.select().from(workflowInstances).where(scope).for('update').limit(1);
    requireRow(instance, '流程实例不存在');
    const formData = await bindWorkflowFormAttachments(tx, instance, instance.formSnapshot,
      { ...(instance.formData as Record<string, unknown>), ...patch }, 0);
    await tx.update(workflowInstances).set({ formData }).where(scope);
    return { formData };
  });
  ctx.formData = result.formData;
  return {};
}
async function webhook(action: Extract<WorkflowAutomationAction, { type: 'webhook' }>, ctx: AutomationContext, jobContext: WorkflowJobContext): Promise<WorkflowJobResult> {
  const committed = await readWorkflowJobStepResult<WorkflowJobResult & Record<string, unknown>>(WEBHOOK_STEP);
  if (committed) return committed;
  const vars = templateContext(ctx);
  const url = renderUrlTemplate(action.url, (key) => resolveWorkflowAutomationVariable(key, vars));
  const method = action.method ?? 'POST';
  const headers = new Headers(Object.fromEntries(Object.entries(action.headers ?? {}).map(([key, value]) =>
    [key, renderWorkflowAutomationText(value, vars)])));
  let body: string | undefined;
  if (method !== 'GET') {
    const rendered = action.bodyTemplate ? renderWorkflowAutomationBody(action.bodyTemplate, vars) : {
      kind: 'json' as const, value: { instanceId: ctx.instance.id, title: ctx.instance.title, status: ctx.instance.status,
        initiatorId: ctx.initiatorId, initiator: ctx.initiatorName, formData: ctx.formData },
    };
    body = rendered.kind === 'json' ? JSON.stringify(rendered.value) : rendered.value;
    if (rendered.kind === 'json' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  const detail: WorkflowJobResult = { requestUrl: url, requestMethod: method, requestBody: body ?? null };
  try {
    const response = await workflowHttp(url, { method, headers, body, timeout: 10000 });
    detail.responseStatus = response.status;
    detail.responseBody = (await response.text().catch(() => '')).slice(0, 4096);
    if (!response.ok) throw new WorkflowJobError(`HTTP ${response.status}`, { detail });
  } catch (error) {
    if (error instanceof WorkflowJobError) throw error;
    throw new WorkflowJobError(error instanceof Error ? error.message : String(error), { detail });
  }
  // The positive response receipt prevents another send when ledger completion is retried.
  return runWorkflowJobStep(WEBHOOK_STEP, async (tx) => {
    await tx.update(workflowJobExecutions).set({ responseStatus: detail.responseStatus, responseBody: detail.responseBody })
      .where(and(eq(workflowJobExecutions.id, jobContext.executionId), eq(workflowJobExecutions.jobId, jobContext.job.id),
        eq(workflowJobExecutions.generation, jobContext.generation), eq(workflowJobExecutions.status, 'running')));
    return { ...detail };
  });
}

export async function executeWorkflowAutomationAction(jobContext: WorkflowJobContext): Promise<WorkflowJobResult> {
  const payload = parseAutomationActionPayload(jobContext.payload);
  const ctx = structuredClone(payload.context);
  let detail: WorkflowJobResult = {};
  let result: Record<string, unknown> = {};
  try {
    assertWorkflowAutomationTemplateSyntax(payload.action);
    switch (payload.action.type) {
      case 'startWorkflow': result = await startWorkflow(payload.action, ctx); break;
      case 'sendMessage': result = await sendMessage(payload.action, ctx, jobContext.operationKey); break;
      case 'updateField': result = await updateField(payload.action, ctx); break;
      case 'webhook': detail = await webhook(payload.action, ctx, jobContext); break;
    }
    return { ...detail, result };
  } catch (error) {
    if (error instanceof WorkflowAutomationTemplateError) throw new WorkflowJobPermanentError(error.message);
    throw error;
  } finally {
    await runWorkflowJobStep(CONTINUATION_STEP, (tx) => enqueueContinuation(tx, payload, ctx.formData));
  }
}
