import { boolean, index, integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import type { CmsContentReviewIssue } from '@zenith/shared/cms';
import { idColumn, timestampColumns, timestamptz } from './common';
import { auditColumns, users } from './core';
import { cmsContents, cmsSites } from './cms';
import { cmsContentRevisions } from './cms-revisions';
import { asyncTasks } from './tasks';

/** Operational policy is intentionally outside the published content snapshot. */
export const cmsContentReviewPolicies = pgTable('cms_content_review_policies', {
  contentId: integer().primaryKey().references(() => cmsContents.id, { onDelete: 'cascade' }),
  siteId: integer().notNull().references(() => cmsSites.id, { onDelete: 'cascade' }),
  version: integer().notNull().default(1), enabled: boolean().notNull().default(true),
  ownerId: integer().references(() => users.id, { onDelete: 'set null' }), intervalDays: integer().notNull().default(90),
  nextReviewAt: timestamptz(), validUntil: timestamptz(), noticeDays: integer().notNull().default(30),
  checkLinks: boolean().notNull().default(true), checkAssetRights: boolean().notNull().default(true),
  lastReviewedAt: timestamptz(), lastReviewedRevisionId: integer().references(() => cmsContentRevisions.id, { onDelete: 'set null' }),
  lastCheckedAt: timestamptz(), nextCheckAt: timestamptz().notNull().defaultNow(),
  lastCheckTaskId: integer().references(() => asyncTasks.id, { onDelete: 'set null' }),
  issues: jsonb().$type<CmsContentReviewIssue[]>().notNull().default([]), ...auditColumns(), ...timestampColumns(),
  issueCycles: jsonb().$type<Record<string, number>>().notNull().default({}),
}, (t) => [index('cms_content_review_policies_due_idx').on(t.enabled, t.nextCheckAt), index('cms_content_review_policies_owner_idx').on(t.siteId, t.ownerId, t.nextReviewAt)]);

/** Append-only review records name the exact public revision the reviewer inspected. */
export const cmsContentReviewRecords = pgTable('cms_content_review_records', {
  id: idColumn(), contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  revisionId: integer().notNull().references(() => cmsContentRevisions.id, { onDelete: 'restrict' }),
  generationId: integer().notNull(), note: text().notNull(), actorId: integer(), actorName: varchar({ length: 100 }).notNull(),
  nextReviewAt: timestamptz().notNull(), createdAt: timestamptz().notNull().defaultNow(),
}, (t) => [index('cms_content_review_records_content_idx').on(t.contentId, t.id)]);
