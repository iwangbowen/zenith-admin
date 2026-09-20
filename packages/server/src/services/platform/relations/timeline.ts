import { and, desc, eq } from 'drizzle-orm';
import type { EntityTimelineResponse } from '@zenith/shared/platform';
import type { EntityRef } from '@zenith/shared/core';
import { hasPermission, currentUser } from '../../../lib/context';
import { db } from '../../../db';
import { domainEventSubjects, domainEvents, operationLogSubjects, operationLogs } from '../../../db/schema';
import { tenantCondition } from '../../../lib/tenant';
import { decodeRelationCursor, encodeRelationCursor } from './cursor';
import { resolveVisibleEntityAnchor } from './registry';
import type { RelationAccessContext } from './types';
import type { CanonicalEntityType } from '@zenith/shared/platform';

/**
 * Timeline implementation backed by structured audit subjects and domain events.
 * Payloads are reduced to safe summaries before they cross the API boundary.
 */
export async function listEntityTimeline(
  input: { readonly type: CanonicalEntityType; readonly key: string; readonly cursor?: string; readonly limit: number },
  access: RelationAccessContext,
): Promise<EntityTimelineResponse> {
  await resolveVisibleEntityAnchor(input.type, input.key, access);
  if (!(await hasPermission('system:log:operation'))) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const target = { type: input.type, key: input.key } satisfies EntityRef;
  const auditRows = await db.select({
    log: operationLogs,
  })
    .from(operationLogSubjects)
    .innerJoin(operationLogs, eq(operationLogSubjects.operationLogId, operationLogs.id))
    .where(and(
      eq(operationLogSubjects.entityType, target.type),
      eq(operationLogSubjects.entityKey, target.key),
      tenantCondition(operationLogs, currentUser()),
    ))
    .orderBy(desc(operationLogs.createdAt), desc(operationLogs.id));

  const eventRows = await db.select({ event: domainEvents })
    .from(domainEventSubjects)
    .innerJoin(domainEvents, eq(domainEventSubjects.eventId, domainEvents.id))
    .where(and(
      eq(domainEventSubjects.entityType, target.type),
      eq(domainEventSubjects.entityKey, target.key),
      tenantCondition(domainEvents, currentUser()),
    ))
    .orderBy(desc(domainEvents.occurredAt), desc(domainEvents.id));

  const auditEvents = new Map<number, (typeof auditRows)[number]['log']>();
  for (const row of auditRows) auditEvents.set(row.log.id, row.log);
  const timelineItems = [
    ...[...auditEvents.values()].map((log) => ({
      id: `audit:${log.id}`,
      eventType: 'platform.audit.operation',
      occurredAt: log.createdAt,
      actorRef: log.userId == null ? null : { type: 'identity.user', key: String(log.userId) },
      sourceRef: { type: 'platform.operation-log', key: String(log.id) },
      traceId: log.requestId,
      payload: {
        description: log.description,
        module: log.module,
        method: log.method,
        path: log.path,
        responseCode: log.responseCode,
      },
    })),
    ...eventRows.map(({ event }) => ({
      id: `event:${event.id}`,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      actorRef: event.actorType && event.actorKey ? { type: event.actorType, key: event.actorKey } : null,
      sourceRef: event.sourceType && event.sourceKey ? { type: event.sourceType, key: event.sourceKey } : null,
      traceId: event.traceId,
      payload: { eventType: event.eventType },
    })),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const offset = decodeRelationCursor(input.cursor);
  const page = timelineItems.slice(offset, offset + input.limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < timelineItems.length;

  return {
    items: page.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      actorRef: event.actorRef,
      sourceRef: event.sourceRef,
      subjectRefs: [{ type: target.type, key: target.key, role: 'primary' as const }],
      traceId: event.traceId,
      parentRef: null,
      visibility: 'restricted' as const,
      payload: event.payload,
    })),
    nextCursor: hasMore ? encodeRelationCursor(nextOffset) : null,
    hasMore,
  };
}
