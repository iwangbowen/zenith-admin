import { runWorkflowJobStep } from '../steps';
import { markWorkflowExternalEffect, throwIfWorkflowExternalEffectUncertain } from '../external-effects';
import { currentWorkflowJobContext } from '../execution-context';
import { eq } from 'drizzle-orm';
import type { WorkflowCompensationAction } from '@zenith/shared/workflow';
import { db } from '../../../db';
import { workflowInstances, smsConfigs, smsTemplates } from '../../../db/schema';
import { invokeConnector, getConnectorRowById } from '../../../services/workflow/workflow-connectors.service';
import { markCompensationActionResult } from '../../../services/workflow/workflow-compensations.service';
import { renderUrlTemplate, workflowHttp } from '../../workflow-outbound';
import { sendMail } from '../../email';
import { sendSmsByProvider } from '../../sms-sender';
import { registerJobHandler } from '../registry';
import { WorkflowJobError } from '../errors';
import type { WorkflowJobContext, WorkflowJobResult } from '../types';
import { renderWorkflowTemplate as renderTemplate } from './shared';

const TIMEOUT_MS_DEFAULT = 10_000;

/** URL 专用渲染：占位值百分号编码，表单值不能改写路径 / 参数 / 主机（见 workflow-outbound.renderUrlTemplate） */
function renderUrl(template: string, formData: Record<string, unknown>, extras: Record<string, string>): string {
  return renderUrlTemplate(template, (key) => {
    if (key.startsWith('form.')) {
      const v = formData[key.slice(5).trim()];
      return v === undefined || v === null || typeof v === 'object' ? '' : v;
    }
    return extras[key] ?? '';
  });
}

function resolveRecipients(recipients: string[] | undefined, formData: Record<string, unknown>, extras: Record<string, string>): string[] {
  if (!recipients?.length) return [];
  return recipients.map((r) => renderTemplate(r, formData, extras).trim()).filter(Boolean);
}

interface ActionCtx { instanceId: number; nodeKey: string; formData: Record<string, unknown>; error: string }

/** 执行一个反向 / 兜底动作，返回执行结果与明细。 */
export async function executeCompensationAction(action: WorkflowCompensationAction, ctx: ActionCtx): Promise<{ ok: boolean; error?: string; detail: WorkflowJobResult }> {
  const extras: Record<string, string> = { instanceId: String(ctx.instanceId), nodeKey: ctx.nodeKey, error: ctx.error };
  switch (action.type) {
    case 'none':
      return { ok: true, detail: { result: { type: 'none' } } };

    case 'http': {
      const url = action.url ? renderUrl(action.url, ctx.formData, extras) : '';
      if (!url) return { ok: false, error: 'http 反向动作缺少 url', detail: {} };
      const method = (action.httpMethod ?? 'POST').toUpperCase();
      const body = method === 'GET' || !action.bodyTemplate ? undefined : renderTemplate(action.bodyTemplate, ctx.formData, extras);
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...action.headers };
      try {
        const resp = await workflowHttp(url, { method, headers, body, timeout: action.timeoutMs ?? TIMEOUT_MS_DEFAULT });
        const text = await resp.text().catch(() => '');
        return { ok: resp.ok, error: resp.ok ? undefined : `HTTP ${resp.status}`, detail: { requestUrl: url, requestMethod: method, requestBody: body ?? null, responseStatus: resp.status, responseBody: text.slice(0, 4096) } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), detail: { requestUrl: url, requestMethod: method, requestBody: body ?? null } };
      }
    }

    case 'connector': {
      if (!action.connectorId) return { ok: false, error: 'connector 反向动作缺少 connectorId', detail: {} };
      const connector = await getConnectorRowById(action.connectorId);
      if (!connector) return { ok: false, error: `连接器 #${action.connectorId} 不存在`, detail: {} };
      const path = action.url ? renderUrl(action.url, ctx.formData, extras) : undefined;
      const body = action.bodyTemplate ? renderTemplate(action.bodyTemplate, ctx.formData, extras) : undefined;
      const r = await invokeConnector(connector, { path, method: action.httpMethod ?? 'POST', headers: action.headers, body, source: 'external' });
      return { ok: r.ok, error: r.error ?? undefined, detail: { requestUrl: `[connector:${connector.code}] ${path ?? ''}`.trim(), requestMethod: action.httpMethod ?? 'POST', requestBody: body ?? null, responseStatus: r.status, responseBody: r.responseSnippet } };
    }

    case 'updateData': {
      const fieldKeys = action.fieldKeys ?? [];
      try {
        await runWorkflowJobStep('compensation-data', async (tx) => {
          const [locked] = await tx.select({ formData: workflowInstances.formData }).from(workflowInstances)
            .where(eq(workflowInstances.id, ctx.instanceId)).for('update').limit(1);
          const base = (locked?.formData ?? {}) as Record<string, unknown>;
          const merged: Record<string, unknown> = { ...base };
          const values = action.fieldValues ?? {};
          for (const key of fieldKeys) {
            const tpl = values[key];
            merged[key] = tpl === undefined ? null : renderTemplate(tpl, base, extras);
          }
          await tx.update(workflowInstances).set({ formData: merged }).where(eq(workflowInstances.id, ctx.instanceId));
          return merged;
        });
        return { ok: true, detail: { requestMethod: 'updateData', requestBody: JSON.stringify({ fieldKeys }) } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), detail: {} };
      }
    }

    case 'email': {
      const to = resolveRecipients(action.recipients, ctx.formData, extras);
      if (!to.length) return { ok: false, error: 'email 反向动作缺少收件人', detail: {} };
      const subject = '[流程补偿] 节点执行失败通知';
      const bodyHtml = action.bodyTemplate ? renderTemplate(action.bodyTemplate, ctx.formData, extras) : '流程节点执行失败，已触发补偿通知。';
      try {
        for (const addr of to) {
          currentWorkflowJobContext()?.signal.throwIfAborted();
          await markWorkflowExternalEffect('EMAIL', 'email');
          await sendMail(addr, subject, bodyHtml);
        }
        return { ok: true, detail: { requestMethod: 'email', requestBody: to.join(',') } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), detail: { requestMethod: 'email', requestBody: to.join(',') } };
      }
    }

    case 'sms': {
      const phones = resolveRecipients(action.recipients, ctx.formData, extras);
      if (!phones.length) return { ok: false, error: 'sms 反向动作缺少手机号', detail: {} };
      if (!action.templateId) return { ok: false, error: 'sms 反向动作缺少 templateId', detail: {} };
      const [smsCfg] = await db.select().from(smsConfigs).where(eq(smsConfigs.status, 'enabled')).limit(1);
      if (!smsCfg) return { ok: false, error: '无启用的短信配置', detail: {} };
      const [tpl] = await db.select().from(smsTemplates).where(eq(smsTemplates.id, action.templateId)).limit(1);
      if (!tpl) return { ok: false, error: `短信模板 #${action.templateId} 不存在`, detail: {} };
      const vars: Record<string, string> = {};
      for (const [k, t] of Object.entries(action.fieldValues ?? {})) vars[k] = renderTemplate(t, ctx.formData, extras);
      try {
        await markWorkflowExternalEffect('SMS', 'sms');
        currentWorkflowJobContext()?.signal.throwIfAborted();
        const results = await Promise.all(phones.map((phone) => sendSmsByProvider({ config: smsCfg, template: tpl, phone, variables: vars, renderedContent: renderTemplate(tpl.content, vars) })));
        const failed = results.find((r) => !r.success);
        return { ok: !failed, error: failed?.errorMsg ?? undefined, detail: { requestMethod: 'sms', requestBody: phones.join(',') } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), detail: { requestMethod: 'sms', requestBody: phones.join(',') } };
      }
    }

    default:
      return { ok: false, error: `未知反向动作类型 ${(action as { type?: string }).type ?? ''}`, detail: {} };
  }
}

/**
 * compensation_action：执行节点失败策略配置的反向 / 兜底动作（撤单、解锁库存、改发短信等）。
 * 复用连接器熔断/限流 + 作业引擎重试退避 + 死信；结果回写补偿工单 compensationActionStatus。
 * payload: { compensationId, instanceId, nodeKey, error?, action }
 */
async function handle({ payload, attempt, job }: WorkflowJobContext): Promise<WorkflowJobResult | void> {
  const compensationId = Number(payload.compensationId);
  const instanceId = Number(payload.instanceId);
  const action = payload.action as WorkflowCompensationAction | undefined;
  if (!Number.isFinite(compensationId) || !Number.isFinite(instanceId) || !action?.type) {
    throw new WorkflowJobError('compensation_action: payload 非法', { permanent: true });
  }

  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId)).limit(1);
  const formData = (inst?.formData ?? {}) as Record<string, unknown>;

  await markCompensationActionResult(compensationId, 'running');
  const res = await executeCompensationAction(action, { instanceId, nodeKey: String(payload.nodeKey ?? ''), formData, error: String(payload.error ?? '') });

  if (res.ok) {
    await markCompensationActionResult(compensationId, 'succeeded', res.detail.responseBody ?? undefined);
    return res.detail;
  }

  const errorMessage = res.error ?? '反向动作执行失败';
  await throwIfWorkflowExternalEffectUncertain(errorMessage, res.detail);
  if (attempt < job.maxAttempts) {
    throw new WorkflowJobError(errorMessage, { detail: res.detail });
  }
  await markCompensationActionResult(compensationId, 'failed', errorMessage);
  throw new WorkflowJobError(errorMessage, { detail: res.detail, permanent: true });
}

registerJobHandler('compensation_action', handle);
