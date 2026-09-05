import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { ASYNC_TASK_STATUSES } from '../../tasks/constants';
import { asyncTaskItemSchema, asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { CMS_PUBLISH_ACTIONS, CMS_PUBLISH_ARTIFACT_STATUSES, CMS_PUBLISH_TARGET_TYPES } from '../constants';
import {
  batchCmsPublishActionSchema,
  cmsSiteIdBodySchema,
  submitCmsPublishSchema,
  submitCmsSiteGroupPublishSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsPublishTargetTypeSchema = z.enum(CMS_PUBLISH_TARGET_TYPES);

export const cmsPublishArtifactSchema = z.object({
  id: z.int(),
  taskId: z.int(),
  siteId: z.int(),
  targetType: cmsPublishTargetTypeSchema,
  contentId: z.int().nullable(),
  channelId: z.int().nullable(),
  pageId: z.int().nullable(),
  themeCode: z.string().nullable(),
  path: z.string(),
  url: z.string().nullable(),
  checksum: z.string().nullable(),
  size: z.int().nullable(),
  status: z.enum(CMS_PUBLISH_ARTIFACT_STATUSES),
  error: z.string().nullable(),
  generatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsPublishArtifact' });

export type CmsPublishArtifact = z.infer<typeof cmsPublishArtifactSchema>;

/** 发布中心受权投影：统一异步任务 + 站点范围与产物计数 */
export const cmsPublishingTaskSchema = asyncTaskSchema.extend({
  siteId: z.int().nullable(),
  siteName: z.string().nullable(),
  siteIds: z.array(z.int()),
  siteNames: z.array(z.string()),
  targetType: cmsPublishTargetTypeSchema,
  artifactCount: z.int(),
  failedArtifactCount: z.int(),
}).meta({ id: 'CmsPublishingTask' });

export type CmsPublishingTask = z.infer<typeof cmsPublishingTaskSchema>;

export const cmsPublishingDetailSchema = z.object({
  task: cmsPublishingTaskSchema,
  items: z.array(asyncTaskItemSchema),
  artifacts: z.array(cmsPublishArtifactSchema),
}).meta({ id: 'CmsPublishingDetail' });

export type CmsPublishingDetail = z.infer<typeof cmsPublishingDetailSchema>;

export const cmsSiteGroupPublishResultSchema = z.object({
  rootSiteId: z.int(),
  targetSiteIds: z.array(z.int()),
  tasks: z.array(asyncTaskSchema),
}).meta({ id: 'CmsSiteGroupPublishResult' });

export type CmsSiteGroupPublishResult = z.infer<typeof cmsSiteGroupPublishResultSchema>;

export const cmsPublishBatchActionResultSchema = z.object({
  affected: z.int(),
  errors: z.array(z.object({ id: z.int(), message: z.string() })),
}).meta({ id: 'CmsPublishBatchActionResult' });

export type CmsPublishBatchActionResult = z.infer<typeof cmsPublishBatchActionResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsPublishingListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive().optional(),
  targetType: cmsPublishTargetTypeSchema.optional(),
  status: z.union([z.enum(ASYNC_TASK_STATUSES), z.literal('active'), z.literal('terminal')]).optional(),
  taskType: z.string().max(64).optional(),
  createdBy: z.string().max(100).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
  keyword: z.string().max(100).optional(),
});

export const cmsPublishArtifactListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive().optional(),
  taskId: z.coerce.number().int().positive().optional(),
  targetType: cmsPublishTargetTypeSchema.optional(),
  status: z.enum(CMS_PUBLISH_ARTIFACT_STATUSES).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
  keyword: z.string().max(100).optional(),
});

export const cmsPublishActionParam = idParam.extend({
  action: z.enum(CMS_PUBLISH_ACTIONS).meta({ description: '任务操作', example: 'restart' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsPublishingContract = defineContract('/api/cms/publishing', {
  list: op.get('/', { query: cmsPublishingListQuery, response: paginated(cmsPublishingTaskSchema), summary: 'CMS 发布任务受权投影' }),
  artifacts: op.get('/artifacts', { query: cmsPublishArtifactListQuery, response: paginated(cmsPublishArtifactSchema), summary: '发布产物分页列表' }),
  submit: op.post('/submit', { body: submitCmsPublishSchema, response: asyncTaskSchema, summary: '统一提交内容/栏目/整站/影响重建任务' }),
  batchAction: op.post('/batch-action', { body: batchCmsPublishActionSchema, response: cmsPublishBatchActionResultSchema, summary: '批量取消/恢复/重试/重建发布任务' }),
  detail: op.get('/{id}', { params: idParam, response: cmsPublishingDetailSchema, summary: '发布任务、明细与产物详情' }),
  action: op.post('/{id}/{action}', { params: cmsPublishActionParam, response: asyncTaskSchema, summary: '取消/恢复/重试/重建发布任务' }),
  groupSubmit: op.post('/group-submit', { body: submitCmsSiteGroupPublishSchema, response: cmsSiteGroupPublishResultSchema, summary: '站点父子树整组重建' }),
}, { tags: ['CMS-发布中心'] });

export const cmsStaticContract = defineContract('/api/cms/static', {
  build: op.post('/build', { body: cmsSiteIdBodySchema, response: asyncTaskSchema, summary: '提交全站静态化任务（任务中心执行）' }),
}, { tags: ['CMS-静态化'] });
