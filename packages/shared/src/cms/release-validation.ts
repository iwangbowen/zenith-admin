import * as z from 'zod';

export const CMS_RELEASE_STATUSES = ['draft', 'building', 'ready', 'scheduled', 'active', 'failed', 'cancelled', 'superseded'] as const;
export const CMS_DEPLOYMENT_STATUSES = ['building', 'ready', 'active', 'retired', 'failed'] as const;

export const createCmsReleaseSchema = z.object({
  siteId: z.int().positive(),
  name: z.string().trim().min(1).max(200),
  revisionIds: z.array(z.int().positive()).max(1000).default([]),
  withdrawContentIds: z.array(z.int().positive()).max(1000).default([]),
  activateAt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, '排期格式为 YYYY-MM-DD HH:mm:ss').nullable().optional(),
  timeZone: z.string().max(80).default('Asia/Shanghai').refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, '请选择有效的 IANA 时区'),
  autoActivate: z.boolean().default(false),
});
export const activateCmsReleaseSchema = z.object({ expectedGenerationId: z.int().positive().nullable() });
export const suppressCmsContentSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
export type CreateCmsReleaseInput = z.infer<typeof createCmsReleaseSchema>;
