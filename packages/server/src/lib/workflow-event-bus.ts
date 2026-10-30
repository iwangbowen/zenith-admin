/** Workflow event publisher. Business writes and consumer receipts share the caller's transaction. */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { WorkflowEvent } from '@zenith/shared/workflow';
import { getDomainEventDefinition, type DomainEventType } from '@zenith/shared/platform';
import type { SubjectRef } from '@zenith/shared/core';
import type { DbTransaction } from '../db/types';
import { workflowInstances } from '../db/schema';
import { currentTraceId } from './context';
import { encryptField } from './encryption';
import { formatDateTime, parseDateTimeInput } from './datetime';
import { publishEventInTx } from './domain-events';
import { recordDomainEvent } from '../services/platform/relations/events.service';
export type WorkflowEventInput = Omit<WorkflowEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string };

function build(event: WorkflowEventInput): WorkflowEvent {
  return { ...event, eventId: event.eventId ?? randomUUID(), occurredAt: event.occurredAt ?? formatDateTime(new Date()) } as WorkflowEvent;
}
async function emitInTx(event: WorkflowEventInput, tx: DbTransaction): Promise<WorkflowEvent> {
  if (event.tenantId === undefined) throw new Error('Workflow event requires its business tenant');
  const full = build(event);
  const { eventId, occurredAt, ...payload } = full;
  const source = { type: 'workflow.instance', key: String(full.instanceId) };
  const subjects: SubjectRef[] = [{ ...source, role: 'primary' }];
  if ('task' in full) subjects.push({ type: 'workflow.task', key: String(full.task.id), role: 'related' });
  const [instance] = await tx.select({ title: workflowInstances.title, serialNo: workflowInstances.serialNo, snapshot: workflowInstances.definitionSnapshot })
    .from(workflowInstances).where(eq(workflowInstances.id, full.instanceId)).limit(1);
  const nodeKey = 'task' in full ? full.task.nodeKey : 'nodeKey' in full ? full.nodeKey : null;
  const settings = instance?.snapshot?.flowData?.settings;
  const node = instance?.snapshot?.flowData?.nodes.find((entry) => entry.data.key === nodeKey)?.data;
  const stored = await publishEventInTx(tx, {
    domain: 'workflow', eventType: `workflow.${full.type}`, tenantId: full.tenantId ?? null,
    businessKey: eventId, orderingKey: `workflow:${full.instanceId}`, subjectRefs: subjects,
    eventId, occurredAt: parseDateTimeInput(occurredAt) ?? new Date(), payload,
    scope: { label: instance?.serialNo ? `${instance.title}（${instance.serialNo}）` : instance?.title ?? `#${full.instanceId}`,
      notifyChannels: settings?.notifyChannels ?? null, notifyInitiator: settings?.notifyInitiator !== false,
      nodeListeners: (node?.nodeListeners ?? []).map(({ headers, ...listener }) => ({ ...listener, headersEncrypted: headers ? encryptField(JSON.stringify(headers)) : null })) },
  });
  const factType = 'task' in full ? 'workflow.task.changed' : `workflow.${full.type}`;
  if (getDomainEventDefinition(factType)) await recordDomainEvent(tx, {
    eventType: factType as DomainEventType,
    payload: 'task' in full ? { action: full.type, status: full.task.status } : { instanceId: full.instanceId, status: 'instance' in full ? full.instance.status : '' },
    subjects, tenantId: full.tenantId ?? null, source,
    actor: full.actor ? { type: 'identity.user', key: String(full.actor.userId) } : undefined,
    traceId: currentTraceId() ?? stored.eventId, dedupeKey: `workflow:${stored.eventId}`,
  });
  return { ...full, eventId: stored.eventId, occurredAt: formatDateTime(stored.occurredAt) };
}
export const workflowEventBus = { build, emitInTx };
export { getWorkflowEventConsumerIntrospection as getWorkflowEventBusIntrospection } from './workflow-event-consumer';
