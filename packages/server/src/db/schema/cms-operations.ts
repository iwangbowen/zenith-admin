import { pgTable, pgEnum, integer, varchar, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { CMS_EDITORIAL_TASK_SOURCES, CMS_EDITORIAL_TASK_STATUSES, CMS_FEEDBACK_STATUSES } from '@zenith/shared/cms';
import type { WorkflowInstanceStatus } from '@zenith/shared/workflow';
import { idColumn, timestampColumns } from './common';
import { auditColumns, users } from './core';
import { cmsContents, cmsForms, cmsFormSubmissions, cmsSites } from './cms';
import { workflowDefinitions, workflowInstances } from './workflow';

export const cmsFeedbackStatusEnum = pgEnum('cms_feedback_status', CMS_FEEDBACK_STATUSES);
export const cmsEditorialTaskStatusEnum = pgEnum('cms_editorial_task_status', CMS_EDITORIAL_TASK_STATUSES);
export const cmsEditorialTaskSourceEnum = pgEnum('cms_editorial_task_source', CMS_EDITORIAL_TASK_SOURCES);
export const cmsFormHandlingPolicies = pgTable('cms_form_handling_policies', {
  id: idColumn(), formId: integer().notNull().references(() => cmsForms.id, { onDelete: 'cascade' }),
  version: integer().notNull().default(1), workflowDefinitionId: integer().references(() => workflowDefinitions.id, { onDelete: 'restrict' }),
  defaultOwnerId: integer().references(() => users.id, { onDelete: 'set null' }), ...auditColumns(), ...timestampColumns(),
}, (t) => [uniqueIndex('cms_form_handling_policies_form_uq').on(t.formId)]);
export const cmsFeedbackCases = pgTable('cms_feedback_cases', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'restrict' }),
  formId: integer().notNull().references(() => cmsForms.id, { onDelete: 'restrict' }),
  submissionId: integer().notNull().references(() => cmsFormSubmissions.id, { onDelete: 'restrict' }),
  title: varchar({ length: 255 }).notNull(), formName: varchar({ length: 100 }).notNull(),
  fields: jsonb().$type<Array<{ name: string; label: string }>>().notNull(),
  status: cmsFeedbackStatusEnum().notNull().default('new'), version: integer().notNull().default(1),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }), dueAt: timestamp(), resolution: text(),
  workflowDefinitionId: integer().references(() => workflowDefinitions.id, { onDelete: 'restrict' }),
  workflowInstanceId: integer().references(() => workflowInstances.id, { onDelete: 'restrict' }),
  workflowSubjectVersion: integer(),
  workflowStatus: varchar({ length: 30 }).$type<WorkflowInstanceStatus>(), ...auditColumns(), ...timestampColumns(),
}, (t) => [uniqueIndex('cms_feedback_cases_submission_uq').on(t.submissionId), index('cms_feedback_cases_site_status_idx').on(t.siteId, t.status, t.id), index('cms_feedback_cases_owner_due_idx').on(t.ownerId, t.dueAt)]);
/** Append-only ledger; migration must reject UPDATE/DELETE at the database boundary. */
export const cmsFeedbackHistory = pgTable('cms_feedback_history', {
  id: idColumn(), feedbackId: integer().notNull().references(() => cmsFeedbackCases.id, { onDelete: 'restrict' }),
  version: integer().notNull(), action: varchar({ length: 40 }).notNull(), note: text(), actorId: integer(), actorName: varchar({ length: 100 }),
  snapshot: jsonb().$type<Record<string, unknown>>().notNull(), previousHash: varchar({ length: 64 }), hash: varchar({ length: 64 }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('cms_feedback_history_version_uq').on(t.feedbackId, t.version)]);
export const cmsEditorialTasks = pgTable('cms_editorial_tasks', {
  id: idColumn(), siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'restrict' }),
  title: varchar({ length: 255 }).notNull(), description: text().notNull().default(''),
  source: cmsEditorialTaskSourceEnum().notNull().default('manual'), sourceKey: varchar({ length: 100 }), sourceKeyword: varchar({ length: 64 }),
  feedbackId: integer().references(() => cmsFeedbackCases.id, { onDelete: 'restrict' }),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }), dueAt: timestamp(),
  contentId: integer().references(() => cmsContents.id, { onDelete: 'set null' }), status: cmsEditorialTaskStatusEnum().notNull().default('open'), version: integer().notNull().default(1),
  ...auditColumns(), ...timestampColumns(),
}, (t) => [uniqueIndex('cms_editorial_tasks_source_uq').on(t.siteId, t.source, t.sourceKey), index('cms_editorial_tasks_site_status_idx').on(t.siteId, t.status, t.id), index('cms_editorial_tasks_owner_due_idx').on(t.ownerId, t.dueAt)]);
export type CmsFeedbackCaseRow = typeof cmsFeedbackCases.$inferSelect;
export type CmsEditorialTaskRow = typeof cmsEditorialTasks.$inferSelect;
