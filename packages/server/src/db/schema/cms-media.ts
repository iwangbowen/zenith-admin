import { index, integer, jsonb, pgEnum, pgTable, real, text, varchar } from 'drizzle-orm/pg-core';
import { CMS_MEDIA_PROCESSING_STATUSES, type CmsMediaResult } from '@zenith/shared/cms';
import { idColumn, timestampColumns } from './common';
import { auditColumns } from './core';
import { cmsAssetVersions } from './cms-design';
import { asyncTasks } from './tasks';

export const cmsMediaProcessingStatusEnum = pgEnum('cms_media_processing_status', CMS_MEDIA_PROCESSING_STATUSES);

/** Completed outputs stay immutable and retained for revision snapshots. */
export const cmsMediaProcessing = pgTable('cms_media_processing', {
  id: idColumn(),
  assetVersionId: integer().notNull().references(() => cmsAssetVersions.id, { onDelete: 'restrict' }),
  subtitleVersionId: integer().references(() => cmsAssetVersions.id, { onDelete: 'restrict' }),
  taskId: integer().references(() => asyncTasks.id, { onDelete: 'set null' }),
  status: cmsMediaProcessingStatusEnum().notNull().default('pending'),
  focalPoint: jsonb().$type<{ x: number; y: number }>().notNull(),
  posterTime: real().notNull().default(0),
  subtitleLanguage: varchar({ length: 64 }).notNull().default('zh'),
  subtitleLabel: varchar({ length: 80 }).notNull().default('中文字幕'),
  result: jsonb().$type<CmsMediaResult>(),
  errorMessage: text(),
  ...auditColumns(), ...timestampColumns(),
}, (t) => [index('cms_media_processing_version_idx').on(t.assetVersionId, t.id), index('cms_media_processing_task_idx').on(t.taskId), index('cms_media_processing_status_updated_idx').on(t.status, t.updatedAt)]);
