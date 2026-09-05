import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { CMS_SUBSCRIPTION_SUBJECT_TYPES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsSubscriptionSubjectTypeSchema = z.enum(CMS_SUBSCRIPTION_SUBJECT_TYPES);

export const cmsMemberSubscriptionSchema = z.object({
  id: z.int(),
  memberId: z.int(),
  memberDisplay: z.string().nullable().optional(),
  siteId: z.int(),
  siteName: z.string().nullable().optional(),
  subjectType: cmsSubscriptionSubjectTypeSchema,
  subjectKey: z.string(),
  subjectId: z.int().nullable(),
  subjectLabel: z.string(),
  notificationEnabled: z.boolean(),
  active: z.boolean(),
  pointsAwardedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsMemberSubscription' });

export type CmsMemberSubscription = z.infer<typeof cmsMemberSubscriptionSchema>;

export const cmsSubscriptionAggregateSchema = z.object({
  siteId: z.int(),
  subjectType: cmsSubscriptionSubjectTypeSchema,
  subjectKey: z.string(),
  subjectId: z.int().nullable(),
  subjectLabel: z.string(),
  subscriberCount: z.int(),
  notificationEnabledCount: z.int(),
}).meta({ id: 'CmsSubscriptionAggregate' });

export type CmsSubscriptionAggregate = z.infer<typeof cmsSubscriptionAggregateSchema>;

/** CMS 站点图片上传结果（内容封面 / 图集 / 主题配置图） */
export const cmsImageUploadSchema = z.object({
  url: z.string().meta({ example: '/api/files/xxx/content' }),
  thumbUrl: z.string().nullable(),
  fileId: z.string(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  watermarked: z.boolean(),
}).meta({ id: 'CmsImageUpload' });

export type CmsImageUpload = z.infer<typeof cmsImageUploadSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

const cmsSubscriptionFilters = {
  siteId: z.coerce.number().int().positive(),
  subjectType: cmsSubscriptionSubjectTypeSchema.optional(),
  subjectKeyword: z.string().max(255).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
};

export const cmsSubscriptionListQuery = paginationQuery.extend(cmsSubscriptionFilters);

export const cmsSubscriptionAggregateQuery = z.object(cmsSubscriptionFilters);

export const cmsImageUploadQuery = z.object({
  siteId: z.coerce.number().int().positive(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsSubscriptionContract = defineContract('/api/cms/subscriptions', {
  list: op.get('/', { query: cmsSubscriptionListQuery, response: paginated(cmsMemberSubscriptionSchema), summary: '会员订阅明细（隐私脱敏）' }),
  aggregates: op.get('/aggregates', { query: cmsSubscriptionAggregateQuery, response: z.array(cmsSubscriptionAggregateSchema), summary: '会员订阅聚合' }),
}, { tags: ['CMS-会员订阅'] });

/** 站点级上传入口：按站点配置执行压缩 / 水印 / 缩略图 */
export const cmsUploadContract = defineContract('/api/cms', {
  uploadImage: op.post('/upload-image', {
    query: cmsImageUploadQuery,
    body: multipart(z.object({ file: fileField() })),
    response: cmsImageUploadSchema,
    summary: '上传图片（按站点配置执行压缩/水印/缩略图）',
  }),
}, { tags: ['CMS-内容管理'] });
