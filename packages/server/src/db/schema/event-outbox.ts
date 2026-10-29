import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { SubjectRef } from '@zenith/shared/core';
import { idColumn, timestamptz } from './common';
import { tenantIdColumn } from './core';

/** Immutable integration facts. Safe object timeline summaries have their own schema. */
export const eventOutbox = pgTable('event_outbox', {
  id: idColumn(),
  eventId: uuid().notNull().unique('event_outbox_event_id_unique'),
  domain: varchar({ length: 64 }).notNull(),
  eventType: varchar({ length: 128 }).notNull(),
  schemaVersion: integer().notNull().default(1),
  tenantId: tenantIdColumn(),
  businessKey: varchar({ length: 256 }).notNull(),
  orderingKey: varchar({ length: 256 }).notNull(),
  subjectRefs: jsonb().$type<readonly SubjectRef[]>().notNull(),
  scope: jsonb().$type<Record<string, unknown>>().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  payloadHash: varchar({ length: 64 }).notNull(),
  occurredAt: timestamptz().notNull().defaultNow(),
  traceId: varchar({ length: 128 }),
  parentRef: varchar({ length: 256 }),
}, (t) => [
  uniqueIndex('event_outbox_tenant_business_unique').on(t.tenantId, t.eventType, t.businessKey).where(sql`${t.tenantId} is not null`),
  uniqueIndex('event_outbox_platform_business_unique').on(t.eventType, t.businessKey).where(sql`${t.tenantId} is null`),
  index('event_outbox_ordering_idx').on(t.orderingKey, t.id),
  index('event_outbox_tenant_occurred_idx').on(t.tenantId, t.occurredAt),
  index('event_outbox_trace_idx').on(t.traceId),
  check('event_outbox_version_check', sql`${t.schemaVersion} = 1`),
]);

export const eventConsumerDeliveries = pgTable('event_consumer_deliveries', {
  id: idColumn(),
  eventId: integer().notNull().references(() => eventOutbox.id, { onDelete: 'cascade' }),
  consumerKey: varchar({ length: 128 }).notNull(),
  orderingKey: varchar({ length: 256 }).notNull(),
  after: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  lane: varchar({ length: 32 }).notNull().default('business'),
  status: varchar({ length: 16 }).notNull().default('pending'),
  attempts: integer().notNull().default(0),
  maxAttempts: integer().notNull().default(5),
  generation: integer().notNull().default(0),
  leaseToken: uuid(),
  leaseUntil: timestamptz(),
  runAt: timestamptz().notNull().defaultNow(),
  checkpoint: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  result: jsonb().$type<Record<string, unknown>>(),
  lastError: text(),
  finishedAt: timestamptz(),
}, (t) => [
  uniqueIndex('event_consumer_deliveries_event_consumer_unique').on(t.eventId, t.consumerKey),
  index('event_consumer_deliveries_claim_idx').on(t.lane, t.runAt, t.id).where(sql`${t.status} in ('pending', 'retrying', 'running')`),
  index('event_consumer_deliveries_order_idx').on(t.consumerKey, t.orderingKey, t.eventId),
  check('event_consumer_deliveries_status_check', sql`${t.status} in ('pending','running','retrying','succeeded','skipped','dead')`),
]);

export const eventConsumerAttempts = pgTable('event_consumer_attempts', {
  id: idColumn(),
  deliveryId: integer().notNull().references(() => eventConsumerDeliveries.id, { onDelete: 'cascade' }),
  generation: integer().notNull(),
  attempt: integer().notNull(),
  leaseToken: uuid().notNull(),
  status: varchar({ length: 16 }).notNull().default('running'),
  startedAt: timestamptz().notNull().defaultNow(),
  finishedAt: timestamptz(),
  error: text(),
}, (t) => [uniqueIndex('event_consumer_attempts_delivery_generation_unique').on(t.deliveryId, t.generation), index('event_consumer_attempts_delivery_idx').on(t.deliveryId)]);

export type OutboxEventRow = typeof eventOutbox.$inferSelect;
export type ConsumerDeliveryRow = typeof eventConsumerDeliveries.$inferSelect;
