import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { CMS_COLLECT_ITEM_STATUSES } from '../constants';
import { createCmsCollectRuleSchema, updateCmsCollectRuleSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsCollectRuleSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  channelId: z.int(),
  channelName: z.string().nullable(),
  name: z.string(),
  listUrl: z.string(),
  pageStart: z.int(),
  pageEnd: z.int(),
  listSelector: z.string(),
  titleSelector: z.string(),
  bodySelector: z.string(),
  summarySelector: z.string().nullable(),
  coverSelector: z.string().nullable(),
  removeSelectors: z.array(z.string()),
  autoPublish: z.boolean(),
  localizeImages: z.boolean(),
  maxItems: z.int(),
  status: entityStatusSchema,
  lastRunAt: z.string().nullable(),
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsCollectRule' });

export type CmsCollectRule = z.infer<typeof cmsCollectRuleSchema>;

export const cmsCollectItemSchema = z.object({
  id: z.int(),
  ruleId: z.int(),
  url: z.string(),
  title: z.string().nullable(),
  status: z.enum(CMS_COLLECT_ITEM_STATUSES),
  contentId: z.int().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'CmsCollectItem' });

export type CmsCollectItem = z.infer<typeof cmsCollectItemSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsCollectRuleListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  keyword: z.string().optional(),
});

export const cmsCollectItemListQuery = paginationQuery.extend({
  status: z.enum(CMS_COLLECT_ITEM_STATUSES).optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsCollectContract = defineContract('/api/cms/collect', {
  list: op.get('/rules', { query: cmsCollectRuleListQuery, response: paginated(cmsCollectRuleSchema), summary: '采集规则分页列表' }),
  create: op.post('/rules', { body: createCmsCollectRuleSchema, response: cmsCollectRuleSchema, summary: '创建采集规则' }),
  update: op.put('/rules/{id}', { params: idParam, body: updateCmsCollectRuleSchema, response: cmsCollectRuleSchema, summary: '更新采集规则' }),
  remove: op.delete('/rules/{id}', { params: idParam, summary: '删除采集规则' }),
  run: op.post('/rules/{id}/run', { params: idParam, response: asyncTaskSchema, summary: '执行采集（任务中心异步）' }),
  items: op.get('/rules/{id}/items', { params: idParam, query: cmsCollectItemListQuery, response: paginated(cmsCollectItemSchema), summary: '采集明细分页列表' }),
}, { tags: ['CMS-采集中心'] });
