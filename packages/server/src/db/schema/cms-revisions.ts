import { pgTable, pgEnum, integer, jsonb, varchar, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { CMS_EDITORIAL_STATUSES, CMS_REVISION_KINDS, type CmsContentRevisionSnapshot } from '@zenith/shared/cms';
import { cmsContents } from './cms';
import { auditColumns, users } from './core';
import { idColumn, timestampColumns } from './common';
import { sql } from 'drizzle-orm';

export const cmsEditorialStatusEnum = pgEnum('cms_editorial_status', CMS_EDITORIAL_STATUSES);
export const cmsRevisionKindEnum = pgEnum('cms_revision_kind', CMS_REVISION_KINDS);

/** Append-only complete content snapshots. Database immutability is also enforced by migration. */
export const cmsContentRevisions = pgTable('cms_content_revisions', {
  id: idColumn(),
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  sourceVersion: integer().notNull(),
  schemaVersion: integer().notNull().default(1),
  kind: cmsRevisionKindEnum().notNull(),
  hash: varchar({ length: 64 }).notNull(),
  title: varchar({ length: 255 }).notNull(),
  snapshot: jsonb().$type<CmsContentRevisionSnapshot>().notNull(),
  remark: varchar({ length: 200 }),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cms_content_revisions_content_version_uq').on(t.contentId, t.version),
  index('cms_content_revisions_content_hash_idx').on(t.contentId, t.hash),
]);

/** Mutable editorial state. A published pointer here is only a trace of the active generation projection. */
export const cmsContentWorkingCopies = pgTable('cms_content_working_copies', {
  contentId: integer().primaryKey().references(() => cmsContents.id, { onDelete: 'cascade' }),
  version: integer().notNull().default(1),
  editorialStatus: cmsEditorialStatusEnum().notNull().default('draft'),
  snapshot: jsonb().$type<CmsContentRevisionSnapshot>().notNull(),
  submittedRevisionId: integer().references(() => cmsContentRevisions.id, { onDelete: 'restrict' }),
  approvedRevisionId: integer().references(() => cmsContentRevisions.id, { onDelete: 'restrict' }),
  publishedRevisionId: integer().references(() => cmsContentRevisions.id, { onDelete: 'restrict' }),
  rejectReason: varchar({ length: 500 }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
}, (t) => [uniqueIndex('cms_working_translation_locale_uq').on(sql`(${t.snapshot}->>'translationOfId')`, sql`(${t.snapshot}->>'locale')`).where(sql`${t.snapshot}->>'translationOfId' is not null`)]);

/** Every approval round has one immutable subject, including historical rounds. */
export const cmsContentReviewRevisions = pgTable('cms_content_review_revisions', {
  id: idColumn(),
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  workflowInstanceId: integer().notNull(),
  revisionId: integer().notNull().references(() => cmsContentRevisions.id, { onDelete: 'restrict' }),
  hash: varchar({ length: 64 }).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('cms_content_review_revisions_instance_uq').on(t.workflowInstanceId)]);

export type CmsContentRevisionRow = typeof cmsContentRevisions.$inferSelect;
export type CmsContentWorkingCopyRow = typeof cmsContentWorkingCopies.$inferSelect;

/** Approval is a durable fact about one revision, independent of later drafts and rounds. */
export const cmsContentRevisionApprovals = pgTable('cms_content_revision_approvals', {
  id: idColumn(),
  revisionId: integer().notNull().references(() => cmsContentRevisions.id, { onDelete: 'restrict' }),
  hash: varchar({ length: 64 }).notNull(),
  workflowInstanceId: integer(),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('cms_content_revision_approvals_revision_uq').on(t.revisionId)]);

/** Revocable grants name one frozen revision and never follow subsequent saves. */
export const cmsContentPreviewGrants = pgTable('cms_content_preview_grants', {
  id: idColumn(),
  token: varchar({ length: 36 }).notNull().unique(),
  contentId: integer().notNull().references(() => cmsContents.id, { onDelete: 'cascade' }),
  revisionId: integer().notNull().references(() => cmsContentRevisions.id, { onDelete: 'cascade' }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  revokedAt: timestamp({ withTimezone: true }),
  ...auditColumns(),
  ...timestampColumns({ withTimezone: true }),
});
