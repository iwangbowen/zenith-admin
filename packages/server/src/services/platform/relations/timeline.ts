import { and, desc, eq } from 'drizzle-orm';
import type { EntityTimelineResponse } from '@zenith/shared/platform';
import type { EntityRef } from '@zenith/shared/core';
import { hasPermission, currentUser } from '../../../lib/context';
import { db } from '../../../db';
import { operationLogSubjects, operationLogs } from '../../../db/schema';
import { tenantCondition } from '../../../lib/tenant';
import { decodeRelationCursor, encodeRelationCursor } from './cursor';
import { resolveVisibleEntityAnchor } from './registry';
import type { RelationAccessContext } from './types';
import type { CanonicalEntityType } from '@zenith/shared/platform';

/**
 * Initial timeline implementation backed by structured audit subjects.
 * Domain events are added by their owning services in the next integration
 * slices; audit records remain permission-gated and tenant-scoped here.
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
  const rows = await db.select({
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

  const unique = new Map<number, (typeof rows)[number]['log']>();
  for (const row of rows) unique.set(row.log.id, row.log);
  const all = [...unique.values()];
  const offset = decodeRelationCursor(input.cursor);
  const page = all.slice(offset, offset + input.limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < all.length;

  return {
    items: page.map((log) => ({
      id: `audit:${log.id}`,
      eventType: 'platform.audit.operation',
      occurredAt: log.createdAt.toISOString(),
      actorRef: log.userId == null ? null : { type: 'identity.user', key: String(log.userId) },
      sourceRef: { type: 'platform.operation-log', key: String(log.id) },
      subjectRefs: [{ type: target.type, key: target.key, role: 'primary' as const }],
      traceId: log.requestId,
      parentRef: null,
      visibility: 'restricted' as const,
      payload: {
        description: log.description,
        module: log.module,
        method: log.method,
        path: log.path,
        responseCode: log.responseCode,
      },
    })),
    nextCursor: hasMore ? encodeRelationCursor(nextOffset) : null,
    hasMore,
  };
}
