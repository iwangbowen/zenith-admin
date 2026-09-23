import * as z from 'zod';

export const CMS_RELEASE_STATUSES = ['draft', 'building', 'ready', 'scheduled', 'active', 'failed', 'cancelled', 'superseded'] as const;
export const CMS_DEPLOYMENT_STATUSES = ['building', 'ready', 'active', 'retired', 'failed'] as const;

export const createCmsReleaseSchema = z.object({
  siteId: z.int().positive(),
  name: z.string().trim().min(1).max(200),
  revisionIds: z.array(z.int().positive()).max(1000).default([]),
  withdrawContentIds: z.array(z.int().positive()).max(1000).default([]),
  pageIds: z.array(z.int().positive()).max(500).default([]),
  widgetIds: z.array(z.int().positive()).max(500).default([]),
  includeSiteConfiguration: z.boolean().default(false),
  activateAt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, '排期格式为 YYYY-MM-DD HH:mm:ss').nullable().optional(),
  timeZone: z.string().max(80).default('Asia/Shanghai').refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, '请选择有效的 IANA 时区'),
  autoActivate: z.boolean().default(false),
});
export const activateCmsReleaseSchema = z.object({ expectedGenerationId: z.int().positive().nullable() });
export const suppressCmsContentSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
export type CreateCmsReleaseInput = z.infer<typeof createCmsReleaseSchema>;
export const cmsConfigurationSnapshotSchema = z.object({ tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))), replaceAll: z.array(z.string()), pageIds: z.array(z.int()).optional(), widgetIds: z.array(z.int()).optional(), deleteIds: z.record(z.string(), z.array(z.int())).optional(), assetVersions: z.record(z.string(), z.int()).optional(), publicContentGuards: z.array(z.object({ id: z.int(), version: z.int(), status: z.string() })).optional() });
export type CmsConfigurationSnapshot = z.infer<typeof cmsConfigurationSnapshotSchema>;
