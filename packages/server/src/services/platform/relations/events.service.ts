import type { DbTransaction } from '../../../db/types';
import { currentUserOrNull } from '../../../lib/context';
import { domainEventSubjects, domainEvents } from '../../../db/schema';
import { normalizeAuditSubjects, type AuditSubjectRef } from '../../../lib/audit-subject';
import { isCanonicalEntityType, parseDomainEventSummary, type DomainEventPayload, type DomainEventType } from '@zenith/shared/platform';
import { entityRefSchema, type EntityRef } from '@zenith/shared/core';
import { and, eq } from 'drizzle-orm';
import { exactTenantCondition } from '../../../lib/tenant';

export interface RecordDomainEventInput<K extends DomainEventType = DomainEventType> {
  readonly eventType: K;
  readonly payload: DomainEventPayload<K>;
  readonly subjects: readonly AuditSubjectRef[];
  readonly actor?: EntityRef;
  readonly source: EntityRef;
  readonly traceId?: string | null;
  readonly parentRef?: string | null;
  readonly dedupeKey?: string | null;
  /** Exact business ownership, including explicit null for a platform object. */
  readonly tenantId: number | null;
}

/** Domain event and subjects must commit with the caller's business write. */
export async function recordDomainEvent<K extends DomainEventType>(tx: DbTransaction, input: RecordDomainEventInput<K>): Promise<number> {
  const subjects = normalizeAuditSubjects(input.subjects);
  if (subjects.length === 0) throw new Error('Domain event requires at least one subject');
  if (subjects.some((subject) => !isCanonicalEntityType(subject.type))) throw new Error('Domain event has an unregistered subject type');
  if (input.tenantId === undefined) throw new Error('Domain event requires an explicit business tenant');
  const payload = parseDomainEventSummary(input.eventType, input.payload);
  const principal = currentUserOrNull();
  const actor = input.actor ? entityRefSchema.parse(input.actor) : principal ? { type: 'identity.user', key: String(principal.userId) } : null;
  const source = entityRefSchema.parse(input.source);
  if (!isCanonicalEntityType(source.type)) throw new Error('Domain event has an unregistered source type');
  const [event] = await tx.insert(domainEvents).values({
    tenantId: input.tenantId,
    eventType: input.eventType,
    payload,
    actorType: actor?.type ?? null,
    actorKey: actor?.key ?? null,
    sourceType: source.type,
    sourceKey: source.key,
    traceId: input.traceId ?? null,
    parentRef: input.parentRef ?? null,
    dedupeKey: input.dedupeKey ?? null,
  }).onConflictDoNothing().returning({ id: domainEvents.id });
  if (!event) {
    if (!input.dedupeKey) throw new Error('Domain event insert failed');
    const [existing] = await tx.select().from(domainEvents).where(and(
      exactTenantCondition(domainEvents.tenantId, input.tenantId),
      eq(domainEvents.dedupeKey, input.dedupeKey),
    )).limit(1);
    if (!existing || existing.eventType !== input.eventType || existing.sourceType !== source.type
      || existing.sourceKey !== source.key || JSON.stringify(parseDomainEventSummary(input.eventType, existing.payload)) !== JSON.stringify(payload)) {
      throw new Error('Domain event dedupe key conflicts with a different business fact');
    }
    const attached = await tx.select({ type: domainEventSubjects.entityType, key: domainEventSubjects.entityKey, role: domainEventSubjects.role })
      .from(domainEventSubjects).where(and(eq(domainEventSubjects.eventId, existing.id), exactTenantCondition(domainEventSubjects.tenantId, input.tenantId)));
    const signature = (refs: readonly AuditSubjectRef[]) => normalizeAuditSubjects(refs).map((ref) => JSON.stringify(ref)).sort().join('\n');
    if (signature(attached) !== signature(subjects)) throw new Error('Domain event dedupe key conflicts with different subjects');
    return existing.id;
  }
  await tx.insert(domainEventSubjects).values(subjects.map((subject) => ({
    eventId: event.id,
    tenantId: input.tenantId,
    entityType: subject.type,
    entityKey: subject.key,
    role: subject.role,
  })));
  return event.id;
}
