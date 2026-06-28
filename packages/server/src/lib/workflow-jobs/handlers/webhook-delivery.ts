import { eq } from 'drizzle-orm';
import type { WorkflowEvent } from '@zenith/shared';
import { db } from '../../../db';
import { workflowEventSubscriptions } from '../../../db/schema';
import { invokeConnector, getConnectorRowById } from '../../../services/workflow-connectors.service';
import { httpPost } from '../../http-client';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobError, WorkflowJobPermanentError } from '../errors';
import type { WorkflowJobContext, WorkflowJobResult } from '../types';
import { signHmac } from './shared';

const TIMEOUT_MS = 10_000;

function parseHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, vv] of Object.entries(v)) if (typeof vv === 'string') out[k] = vv;
    return out;
  } catch {
    return {};
  }
}

/**
 * webhook_delivery：向一个订阅投递一个事件（HMAC 签名 + 重试由引擎接管）。
 * 取代 webhook.ts:dispatchDelivery + workflow_event_deliveries 表；执行明细入 job_executions。
 * payload: { subscriptionId, event }
 */
async function handle({ payload, attempt, job }: WorkflowJobContext): Promise<WorkflowJobResult | void> {
  const subscriptionId = Number(payload.subscriptionId);
  const event = payload.event as WorkflowEvent | undefined;
  if (!Number.isFinite(subscriptionId) || !event) {
    throw new WorkflowJobPermanentError('webhook_delivery: payload.subscriptionId / event 缺失');
  }

  const [sub] = await db.select().from(workflowEventSubscriptions).where(eq(workflowEventSubscriptions.id, subscriptionId)).limit(1);
  if (!sub || !sub.enabled) throw new WorkflowJobSkip('订阅已被删除或禁用');

  const bodyStr = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Zenith-Event': event.type,
    'X-Zenith-Event-Id': event.eventId,
    'X-Zenith-Delivery-Job': String(job.id),
    'X-Zenith-Attempt': String(attempt),
    ...parseHeaders(sub.headers),
  };
  if (sub.signMode === 'hmacSha256' && sub.secret) {
    headers['X-Zenith-Signature'] = `t=${timestamp},v1=${signHmac(sub.secret, timestamp, bodyStr)}`;
  }

  const detail: WorkflowJobResult = { requestUrl: sub.url, requestMethod: 'POST', requestBody: bodyStr };
  if (sub.connectorId) {
    // 经连接器投递：统一鉴权/超时/重试/熔断（HMAC 签名仍由本节点附加在请求头，body 透传保证签名一致）
    const connector = await getConnectorRowById(sub.connectorId);
    if (!connector) throw new WorkflowJobError(`投递连接器 #${sub.connectorId} 不存在`, { detail, permanent: true });
    detail.requestUrl = `[connector:${connector.code}] ${sub.url ?? ''}`.trim();
    const r = await invokeConnector(connector, { path: sub.url || undefined, method: 'POST', headers, body: bodyStr, source: 'webhook' });
    if (r.ok) return { ...detail, responseStatus: r.status, responseBody: r.responseSnippet };
    throw new WorkflowJobError(r.error ?? '连接器调用失败', { detail: { ...detail, responseStatus: r.status, responseBody: r.responseSnippet } });
  }
  try {
    const resp = await httpPost(sub.url, bodyStr, { headers, timeout: TIMEOUT_MS });
    const respText = await resp.text().catch(() => '');
    if (resp.ok) {
      return { ...detail, responseStatus: resp.status, responseBody: respText.slice(0, 4096) };
    }
    throw new WorkflowJobError(`HTTP ${resp.status}`, { detail: { ...detail, responseStatus: resp.status, responseBody: respText.slice(0, 4096) } });
  } catch (err) {
    if (err instanceof WorkflowJobError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new WorkflowJobError(msg.slice(0, 1024), { detail });
  }
}

registerJobHandler('webhook_delivery', handle);
