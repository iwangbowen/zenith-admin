import { index, integer, jsonb, pgTable, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { workflowJobs } from './workflow';

/** Internal form changes and their receipts commit together under the job lease. */
export const workflowJobEffects = pgTable('workflow_job_effects', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  jobId: integer().notNull().references(() => workflowJobs.id, { onDelete: 'cascade' }),
  operationKey: varchar({ length: 64 }).notNull(),
  effectKey: varchar({ length: 128 }).notNull(),
  result: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('workflow_job_effects_operation_effect_unique').on(t.operationKey, t.effectKey),
  index('workflow_job_effects_job_idx').on(t.jobId),
]);
