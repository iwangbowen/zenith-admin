import { eq } from 'drizzle-orm';
import { isPlainObject } from '@zenith/shared/core';
import type { WorkflowTaskEventPayload } from '@zenith/shared/workflow';
import { db } from '../../../db';
import { workflowInstances, workflowTasks } from '../../../db/schema';
import { decryptField } from '../../encryption';
import { workflowHttpGet, workflowHttpPost } from '../../workflow-outbound';
import { throwIfWorkflowExternalEffectUncertain } from '../external-effects';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobError, WorkflowJobPermanentError } from '../errors';
import type { WorkflowJobContext, WorkflowJobResult } from '../types';

async function handle({ payload }: WorkflowJobContext): Promise<WorkflowJobResult> {
  const event = payload.event as WorkflowTaskEventPayload | undefined;
  const listener = payload.listener;
  if (!event?.task || !isPlainObject(listener) || typeof listener.url !== 'string' || !['GET', 'POST'].includes(String(listener.method))) {
    throw new WorkflowJobPermanentError('Node listener snapshot is invalid');
  }
  const [instance] = await db.select({ status: workflowInstances.status }).from(workflowInstances).where(eq(workflowInstances.id, event.instanceId)).limit(1);
  const [task] = await db.select({ activationId: workflowTasks.activationId }).from(workflowTasks).where(eq(workflowTasks.id, event.task.id)).limit(1);
  if (!instance || ['cancelled', 'withdrawn', 'returned'].includes(instance.status) || !task || task.activationId !== event.task.activationId) {
    throw new WorkflowJobSkip('Node listener source activation is no longer applicable');
  }
  const listenerUrl = String(listener.url);
  const body = { eventId: event.eventId, eventType: event.type, listenerEvent: payload.listenerEvent, occurredAt: event.occurredAt,
    instanceId: event.instanceId, definitionId: event.definitionId, nodeKey: event.task.nodeKey, task: event.task, actor: event.actor, comment: event.comment ?? null };
  const headers: Record<string, string> = { 'content-type': 'application/json', 'X-Zenith-Event-Id': event.eventId };
  const encryptedHeaders = listener.headersEncrypted;
  if (typeof encryptedHeaders === 'string') {
    const decrypted = decryptField(encryptedHeaders as string);
    if (!decrypted) throw new WorkflowJobPermanentError('Invalid encrypted node listener headers');
    const stored: unknown = JSON.parse(decrypted);
    if (!isPlainObject(stored) || Object.values(stored).some((value) => typeof value !== 'string')) throw new WorkflowJobPermanentError('Invalid encrypted node listener headers');
    Object.assign(headers, stored);
  }
  const detail: WorkflowJobResult = { requestUrl: listenerUrl, requestMethod: String(listener.method), requestBody: JSON.stringify(body) };
  try {
    const response = listener.method === 'GET' ? await workflowHttpGet(listenerUrl, { headers, timeout: 8000 })
      : await workflowHttpPost(listenerUrl, body, { headers, timeout: 8000 });
    detail.responseStatus = response.status;
    detail.responseBody = (await response.text()).slice(0, 4096);
    if (!response.ok) {
      await throwIfWorkflowExternalEffectUncertain(`HTTP ${response.status}`, detail);
      throw new WorkflowJobError(`HTTP ${response.status}`, { detail, permanent: response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429 });
    }
    return detail;
  } catch (error) {
    if (error instanceof WorkflowJobError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    await throwIfWorkflowExternalEffectUncertain(message, detail);
    throw new WorkflowJobError(message, { detail });
  }
}
registerJobHandler('node_listener_delivery', handle);
