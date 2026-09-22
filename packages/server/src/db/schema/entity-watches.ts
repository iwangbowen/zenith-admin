import { sql } from 'drizzle-orm';
import { index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn } from './common';
import { tenantIdColumn, users } from './core';
import { domainEvents } from './entity-relations';

/** Personal subscription edges. Deleting the edge also cancels delayed deliveries. */
export const entityWatches = pgTable('entity_watches', {
  id: idColumn(),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: tenantIdColumn(),
  entityType: varchar({ length: 96 }).notNull(),
  entityKey: varchar({ length: 128 }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('entity_watches_user_tenant_object_uq').on(t.userId, t.tenantId, t.entityType, t.entityKey).where(sql`${t.tenantId} is not null`),
  uniqueIndex('entity_watches_user_platform_object_uq').on(t.userId, t.entityType, t.entityKey).where(sql`${t.tenantId} is null`),
  index('entity_watches_object_idx').on(t.tenantId, t.entityType, t.entityKey, t.id),
]);

/** Per-event outbox; concurrent commits never depend on a global event-id high-water mark. */
export const entityWatchEvents = pgTable('entity_watch_events', {
  eventId: integer().primaryKey().references(() => domainEvents.id, { onDelete: 'cascade' }),
  watcherCursor: integer().notNull().default(0),
  leaseToken: uuid(),
  claimedAt: timestamp({ withTimezone: true }),
  nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  attempts: integer().notNull().default(0),
  lastError: varchar({ length: 500 }),
}, (t) => [index('entity_watch_events_due_idx').on(t.nextAttemptAt, t.claimedAt)]);

export type EntityWatchRow = typeof entityWatches.$inferSelect;
