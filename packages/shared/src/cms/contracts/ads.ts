import * as z from 'zod';
import { dateRangeBound, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { CMS_AD_EVENT_TYPES, CMS_DEVICE_TYPES } from '../constants';
import {
  cleanupCmsAdEventsSchema,
  createCmsAdSchema,
  createCmsAdSlotSchema,
  updateCmsAdSchema,
  updateCmsAdSlotSchema,
} from '../validation';
import { cmsSiteScopeQuery } from './tags';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsAdSlotSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  code: z.string().meta({ example: 'home-ad' }),
  name: z.string(),
  remark: z.string().nullable(),
  adCount: z.int().optional().meta({ description: '投放中的广告数（列表返回）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsAdSlot' });

export type CmsAdSlot = z.infer<typeof cmsAdSlotSchema>;

export const cmsAdSchema = z.object({
  id: z.int(),
  slotId: z.int(),
  slotName: z.string().nullable().optional(),
  name: z.string(),
  image: z.string().nullable(),
  linkUrl: z.string().nullable(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  clickCount: z.int().meta({ description: '点击计数（前台点击中转累加）' }),
  viewCount: z.int().meta({ description: '曝光计数（前台页面 beacon 上报累加）' }),
  sort: z.int(),
  status: entityStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsAd' });

export type CmsAd = z.infer<typeof cmsAdSchema>;

export const cmsAdEventTypeSchema = z.enum(CMS_AD_EVENT_TYPES);

export const cmsDeviceTypeSchema = z.enum(CMS_DEVICE_TYPES);

export const cmsAdEventSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  siteName: z.string().nullable().optional(),
  adId: z.int(),
  adName: z.string().nullable().optional(),
  slotId: z.int(),
  slotName: z.string().nullable().optional(),
  eventType: cmsAdEventTypeSchema,
  occurredAt: z.string(),
  visitorHash: z.string(),
  ipHash: z.string(),
  userAgent: z.string().nullable(),
  device: cmsDeviceTypeSchema,
  referrer: z.string().nullable(),
  path: z.string().nullable(),
  memberId: z.int().nullable(),
}).meta({ id: 'CmsAdEvent' });

export type CmsAdEvent = z.infer<typeof cmsAdEventSchema>;

export const cmsAdEventStatsSchema = z.object({
  summary: z.object({
    impressions: z.int(),
    clicks: z.int(),
    ctr: z.number(),
  }),
  trend: z.array(z.object({
    date: z.string(),
    impressions: z.int(),
    clicks: z.int(),
    ctr: z.number(),
  })),
}).meta({ id: 'CmsAdEventStats' });

export type CmsAdEventStats = z.infer<typeof cmsAdEventStatsSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsAdListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  slotId: z.coerce.number().int().positive().optional(),
});

const cmsAdEventFilters = {
  siteId: z.coerce.number().int().positive(),
  adId: z.coerce.number().int().positive().optional(),
  slotId: z.coerce.number().int().positive().optional(),
  eventType: cmsAdEventTypeSchema.optional(),
  device: cmsDeviceTypeSchema.optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
};

export const cmsAdEventListQuery = paginationQuery.extend(cmsAdEventFilters);

export const cmsAdEventStatsQuery = z.object(cmsAdEventFilters);

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsAdContract = defineContract('/api/cms/ads', {
  slots: op.get('/slots', { query: cmsSiteScopeQuery, response: z.array(cmsAdSlotSchema), summary: '广告位列表' }),
  slotCreate: op.post('/slots', { body: createCmsAdSlotSchema, response: cmsAdSlotSchema, summary: '创建广告位' }),
  slotUpdate: op.put('/slots/{id}', { params: idParam, body: updateCmsAdSlotSchema, response: cmsAdSlotSchema, summary: '更新广告位' }),
  slotRemove: op.delete('/slots/{id}', { params: idParam, summary: '删除广告位' }),
  list: op.get('/', { query: cmsAdListQuery, response: paginated(cmsAdSchema), summary: '广告分页列表' }),
  events: op.get('/events', { query: cmsAdEventListQuery, response: paginated(cmsAdEventSchema), summary: '广告事件明细' }),
  eventStats: op.get('/events/stats', { query: cmsAdEventStatsQuery, response: cmsAdEventStatsSchema, summary: '广告事件统计' }),
  cleanupEvents: op.post('/events/cleanup', { body: cleanupCmsAdEventsSchema, response: asyncTaskSchema, summary: '按保留策略清理广告事件（任务中心）' }),
  create: op.post('/', { body: createCmsAdSchema, response: cmsAdSchema, summary: '创建广告' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsAdSchema, response: cmsAdSchema, summary: '更新广告' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除广告' }),
}, { tags: ['CMS-广告管理'] });
