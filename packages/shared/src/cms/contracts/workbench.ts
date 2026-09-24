import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { requiredIdQuery } from '../../core/api-schemas';
import { ASYNC_TASK_STATUSES } from '../../tasks/constants';
import { CMS_PREVIEW_MODES, CMS_RELEASE_CHANGE_KINDS } from '../constants';
import { renderCmsWorkbenchPreviewSchema } from '../workbench-validation';

export const cmsWorkbenchPreviewSchema = z.object({
  html: z.string(), status: z.int(), path: z.string(), mode: z.enum(CMS_PREVIEW_MODES),
  sourceLabel: z.string(), fingerprint: z.string(), generationId: z.int().nullable(),
  contentVersions: z.array(z.object({ id: z.int(), version: z.int() })),
}).meta({ id: 'CmsWorkbenchPreview' });
export type CmsWorkbenchPreview = z.infer<typeof cmsWorkbenchPreviewSchema>;
export const cmsReleaseFieldDiffSchema = z.object({ path: z.string(), before: z.unknown(), after: z.unknown() });
export const cmsReleaseChangeSchema = z.object({
  kind: z.enum(CMS_RELEASE_CHANGE_KINDS), id: z.int(), title: z.string(), operation: z.enum(['create', 'update', 'remove']),
  fields: z.array(cmsReleaseFieldDiffSchema), editPath: z.string(), paths: z.array(z.string()),
});
export type CmsReleaseChange = z.infer<typeof cmsReleaseChangeSchema>;
export const cmsReleaseCheckSchema = z.object({
  severity: z.enum(['error', 'warning']), code: z.string(), message: z.string(), objectTitle: z.string().nullable(), editPath: z.string().nullable(),
});
export const cmsReleaseTaskSummarySchema = z.object({
  id: z.int(), taskType: z.string(), title: z.string(), status: z.enum(ASYNC_TASK_STATUSES),
  totalCount: z.int().nullable(), processedCount: z.int(), progressNote: z.string().nullable(), errorMessage: z.string().nullable(),
});
export const cmsReleaseReviewSchema = z.object({
  releaseId: z.int(), fingerprint: z.string(), baseGenerationId: z.int().nullable(), currentGenerationId: z.int().nullable(),
  comparisonGenerationId: z.int().nullable(), stale: z.boolean(),
  changes: z.array(cmsReleaseChangeSchema), checks: z.array(cmsReleaseCheckSchema),
  affectedPaths: z.array(z.string()), wholeSiteAffected: z.boolean(), tasks: z.array(cmsReleaseTaskSummarySchema),
}).meta({ id: 'CmsReleaseReview' });
export type CmsReleaseReview = z.infer<typeof cmsReleaseReviewSchema>;

export const cmsWorkbenchContract = defineContract('/api/cms/workbench', {
  preview: op.post('/preview', { access: { permission: ['cms:content:list', 'cms:page:list', 'cms:widget:list', 'cms:site:list', 'cms:publish:view'] },
    audit: { description: '预览 CMS 工作区', recordResponseBody: false }, body: renderCmsWorkbenchPreviewSchema, response: cmsWorkbenchPreviewSchema, summary: '受权预览工作稿、候选或线上版本，不产生公开副作用' }),
  configurationDraft: op.get('/configuration-draft', { access: { permission: ['cms:content:list', 'cms:page:list', 'cms:widget:list', 'cms:site:list', 'cms:publish:view'] },
    query: z.object({ siteId: requiredIdQuery() }), response: z.object({ id: z.int(), name: z.string(), href: z.string() }).nullable(), summary: '当前操作者待发布配置草稿入口' }),
}, { tags: ['CMS-工作区'], auditModule: 'CMS内容管理' });
