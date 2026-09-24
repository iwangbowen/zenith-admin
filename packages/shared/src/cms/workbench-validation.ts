import * as z from 'zod';
import { CMS_PREVIEW_MODES } from './constants';
import { parseCmsLink } from './link';

export const cmsPreviewPathSchema = z.string().trim().max(1000).default('/').refine((value) => {
  const link = parseCmsLink(value);
  return link?.kind === 'internal' && value.startsWith('/') && !value.startsWith('/__cms/');
}, '请填写本站相对路径，例如 /news/');
export const renderCmsWorkbenchPreviewSchema = z.object({
  siteId: z.int().positive(), mode: z.enum(CMS_PREVIEW_MODES), path: cmsPreviewPathSchema,
  releaseId: z.int().positive().optional(),
  contentIds: z.array(z.int().positive()).max(100).default([]),
  pageIds: z.array(z.int().positive()).max(100).default([]),
  widgetIds: z.array(z.int().positive()).max(100).default([]),
  includeSiteConfiguration: z.boolean().default(false),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).superRefine((value, ctx) => {
  if (value.mode === 'candidate' && !value.releaseId) ctx.addIssue({ code: 'custom', path: ['releaseId'], message: '请选择发布单' });
  if (value.mode === 'working' && !value.includeSiteConfiguration && !value.contentIds.length && !value.pageIds.length && !value.widgetIds.length) ctx.addIssue({ code: 'custom', path: ['contentIds'], message: '请选择需要预览的工作稿或配置' });
});
export const recreateCmsReleaseSchema = z.object({ expectedGenerationId: z.int().positive().nullable(), expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
