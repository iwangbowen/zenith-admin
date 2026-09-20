import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { idColumn } from './common';
import { tenantIdColumn, users } from './core';

/**
 * Roles shared by polymorphic relation and event subjects.
 *
 * The subject tables intentionally store an opaque type/key pair instead of
 * foreign keys: the target may belong to any domain schema, and a polymorphic
 * FK cannot express that relationship safely. Domain services validate the
 * pair and its tenant before writing it.
 */
export const entitySubjectRoleEnum = pgEnum('entity_subject_role', [
  'primary',
  'related',
  'source',
  'target',
]);

/**
 * Explicit many-to-many edges between domain entities.
 *
 * Existing first-class foreign keys and business keys remain owned by their
 * domain services. This table is reserved for relationships that cannot be
 * represented by either of those mechanisms.
 */
export const entityRelationEdges = pgTable('entity_relation_edges', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  sourceType: varchar({ length: 96 }).notNull(),
  sourceKey: varchar({ length: 512 }).notNull(),
  relationKey: varchar({ length: 128 }).notNull(),
  targetType: varchar({ length: 96 }).notNull(),
  targetKey: varchar({ length: 512 }).notNull(),
  metadata: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('entity_relation_edges_source_type_check', sql`length(${t.sourceType}) > 0`),
  check('entity_relation_edges_source_key_check', sql`length(${t.sourceKey}) > 0`),
  check('entity_relation_edges_relation_key_check', sql`length(${t.relationKey}) > 0`),
  check('entity_relation_edges_target_type_check', sql`length(${t.targetType}) > 0`),
  check('entity_relation_edges_target_key_check', sql`length(${t.targetKey}) > 0`),
  // Tenant-scoped edges must be unique in both directions. Separate partial
  // indexes preserve uniqueness for platform-level rows where tenant_id is
  // NULL (PostgreSQL treats NULL values as distinct in a normal unique index).
  uniqueIndex('entity_relation_edges_tenant_uq')
    .on(t.tenantId, t.sourceType, t.sourceKey, t.relationKey, t.targetType, t.targetKey)
    .where(sql`${t.tenantId} is not null`),
  uniqueIndex('entity_relation_edges_platform_uq')
    .on(t.sourceType, t.sourceKey, t.relationKey, t.targetType, t.targetKey)
    .where(sql`${t.tenantId} is null`),
  index('entity_relation_edges_source_idx').on(t.tenantId, t.sourceType, t.sourceKey, t.relationKey),
  index('entity_relation_edges_target_idx').on(t.tenantId, t.targetType, t.targetKey, t.relationKey),
]);

export type EntityRelationEdgeRow = typeof entityRelationEdges.$inferSelect;
export type NewEntityRelationEdge = typeof entityRelationEdges.$inferInsert;

/**
 * Append-only domain event envelope. Subject rows below provide the typed
 * entity references used for object timelines; traceId / parentRef describe
 * causality and must not be used as a business relationship by themselves.
 */
export const domainEvents = pgTable('domain_events', {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  eventType: varchar({ length: 128 }).notNull(),
  schemaVersion: integer().notNull().default(1),
  payload: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /** Generic actor identity; e.g. identity.user / system.worker. */
  actorType: varchar({ length: 96 }),
  actorKey: varchar({ length: 512 }),
  /** Optional causal source object that emitted the event. */
  sourceType: varchar({ length: 96 }),
  sourceKey: varchar({ length: 512 }),
  traceId: varchar({ length: 64 }),
  parentRef: varchar({ length: 128 }),
  dedupeKey: varchar({ length: 192 }),
  occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('domain_events_event_type_check', sql`length(${t.eventType}) > 0`),
  check('domain_events_schema_version_check', sql`${t.schemaVersion} > 0`),
  check('domain_events_actor_ref_pair_check', sql`(${t.actorType} is null) = (${t.actorKey} is null)`),
  check('domain_events_source_ref_pair_check', sql`(${t.sourceType} is null) = (${t.sourceKey} is null)`),
  uniqueIndex('domain_events_tenant_dedupe_uq')
    .on(t.tenantId, t.dedupeKey)
    .where(sql`${t.tenantId} is not null and ${t.dedupeKey} is not null`),
  uniqueIndex('domain_events_platform_dedupe_uq')
    .on(t.dedupeKey)
    .where(sql`${t.tenantId} is null and ${t.dedupeKey} is not null`),
  index('domain_events_tenant_occurred_idx').on(t.tenantId, t.occurredAt),
  index('domain_events_type_occurred_idx').on(t.eventType, t.occurredAt),
  index('domain_events_trace_idx').on(t.traceId),
]);

export type DomainEventRow = typeof domainEvents.$inferSelect;
export type NewDomainEvent = typeof domainEvents.$inferInsert;

/** Entity references attached to a domain event for relation views/timelines. */
export const domainEventSubjects = pgTable('domain_event_subjects', {
  eventId: integer().notNull().references(() => domainEvents.id, { onDelete: 'cascade' }),
  tenantId: tenantIdColumn(),
  entityType: varchar({ length: 96 }).notNull(),
  entityKey: varchar({ length: 512 }).notNull(),
  role: entitySubjectRoleEnum().notNull().default('related'),
}, (t) => [
  check('domain_event_subjects_entity_type_check', sql`length(${t.entityType}) > 0`),
  check('domain_event_subjects_entity_key_check', sql`length(${t.entityKey}) > 0`),
  primaryKey({ columns: [t.eventId, t.entityType, t.entityKey, t.role] }),
  index('domain_event_subjects_entity_idx').on(t.tenantId, t.entityType, t.entityKey, t.eventId),
  index('domain_event_subjects_event_idx').on(t.eventId),
]);

export type DomainEventSubjectRow = typeof domainEventSubjects.$inferSelect;
export type NewDomainEventSubject = typeof domainEventSubjects.$inferInsert;
