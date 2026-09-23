import * as z from 'zod';
import { createCmsContentSchema } from './validation';
import { cmsBodyDocumentSchema } from './document';

export const CMS_EDITORIAL_STATUSES = ['draft', 'pending', 'rejected', 'approved', 'clean'] as const;
export const CMS_REVISION_KINDS = ['checkpoint', 'submission', 'publication', 'restore', 'preview'] as const;

/** A revision includes relationships as well as fields; delivery never reads a later working copy. */
export const cmsContentRevisionSnapshotSchema = createCmsContentSchema.omit({ siteId: true }).extend({
  modelId: z.int().positive().nullable().default(null),
  modelVersionId: z.int().positive().nullable().default(null),
  bodyDocument: cmsBodyDocumentSchema.nullable().default(null),
  assetVersions: z.record(z.string(), z.int().positive()).default({}),
});

export type CmsContentRevisionSnapshot = z.output<typeof cmsContentRevisionSnapshotSchema>;
export type CmsEditorialStatus = (typeof CMS_EDITORIAL_STATUSES)[number];
export type CmsRevisionKind = (typeof CMS_REVISION_KINDS)[number];

export const cmsContentCasSchema = z.object({ expectedVersion: z.int().positive() });
export const cmsContentBatchCasSchema = z.object({
  ids: z.array(z.int().positive()).min(1).max(1000),
  expectedVersions: z.record(z.string(), z.int().positive()),
}).superRefine((value, ctx) => {
  for (const id of value.ids) {
    if (value.expectedVersions[String(id)] === undefined) {
      ctx.addIssue({ code: 'custom', path: ['expectedVersions', String(id)], message: '缺少所选内容的版本号，请刷新后重试' });
    }
  }
});
