import type { DbExecutor } from '../../../db/types';
import { currentUserOrNull, currentUserId } from '../../../lib/context';
import { getEffectiveTenantId } from '../../../lib/tenant';
import { domainEventSubjects, domainEvents, entityRelationEdges } from '../../../db/schema';
import { normalizeAuditSubjects, type AuditSubjectRef } from '../../../lib/audit-subject';
import { isCanonicalEntityType } from '@zenith/shared/platform';
import type { EntityRef } from '@zenith/shared/core';

export interface RecordDomainEventInput {
  readonly eventType: string;
  readonly payload?: Record<string, unknown>;
  readonly subjects: readonly AuditSubjectRef[];
  readonly actor?: EntityRef;
  readonly source?: EntityRef;
  readonly traceId?: string | null;
  readonly parentRef?: string | null;
  readonly dedupeKey?: string | null;
  readonly tenantId?: number | null;
}

/** Writes a domain event and its subjects in the caller's transaction. */
export async function recordDomainEvent(executor: DbExecutor, input: RecordDomainEventInput): Promise<number> {
  if (!input.eventType.trim()) throw new Error('domain event type is required');
  const subjects = normalizeAuditSubjects(input.subjects);
  if (subjects.length === 0) throw new Error('domain event requires at least one subject');
  const principal = currentUserOrNull();
  const tenantId = input.tenantId ?? (principal ? getEffectiveTenantId(principal) : null);
  const [event] = await executor.insert(domainEvents).values({
    tenantId,
    eventType: input.eventType.trim().slice(0, 128),
    payload: input.payload ?? {},
    actorType: input.actor?.type ?? (principal ? 'identity.user' : null),
    actorKey: input.actor?.key ?? (principal ? String(currentUserId()) : null),
    sourceType: input.source?.type ?? null,
    sourceKey: input.source?.key ?? null,
    traceId: input.traceId ?? null,
    parentRef: input.parentRef ?? null,
    dedupeKey: input.dedupeKey ?? null,
  }).returning({ id: domainEvents.id });
  if (!event) throw new Error('domain event insert failed');
  await executor.insert(domainEventSubjects).values(subjects.map((subject) => ({
    eventId: event.id,
    tenantId,
    entityType: subject.type,
    entityKey: subject.key,
    role: subject.role,
  })));
  return event.id;
}

export interface AddEntityRelationEdgeInput {
  readonly source: EntityRef;
  readonly relationKey: string;
  readonly target: EntityRef;
  readonly metadata?: Record<string, unknown>;
  readonly tenantId?: number | null;
}

/** Writes a true N:M edge; FK and biz-key relations stay in their domain tables. */
export async function addEntityRelationEdge(executor: DbExecutor, input: AddEntityRelationEdgeInput): Promise<void> {
  if (!isCanonicalEntityType(input.source.type) || !isCanonicalEntityType(input.target.type)) {
    throw new Error('relation edge references an unregistered entity type');
  }
  const tenantId = input.tenantId ?? (() => {
    const user = currentUserOrNull();
    return user ? getEffectiveTenantId(user) : null;
  })();
  await executor.insert(entityRelationEdges).values({
    tenantId,
    sourceType: input.source.type,
    sourceKey: input.source.key,
    relationKey: input.relationKey,
    targetType: input.target.type,
    targetKey: input.target.key,
    metadata: input.metadata ?? {},
    createdBy: currentUserOrNull()?.userId ?? null,
  }).onConflictDoNothing();
}
