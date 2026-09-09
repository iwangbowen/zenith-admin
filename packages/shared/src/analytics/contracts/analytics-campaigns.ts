import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { ANALYTICS_CAMPAIGN_CHANNELS, ANALYTICS_CAMPAIGN_STATUSES } from '../constants';
import { createAnalyticsCampaignSchema, updateAnalyticsCampaignSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 分群触达活动 */
export const analyticsSegmentCampaignSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  segmentId: z.int(),
  segmentName: z.string().nullable(),
  name: z.string(),
  channel: z.enum(ANALYTICS_CAMPAIGN_CHANNELS),
  templateId: z.int().nullable(),
  webhookUrl: z.string().nullable(),
  landingUrl: z.string().nullable().meta({ description: '落地页地址：执行时自动生成短链并注入模板变量 {{shortUrl}}' }),
  shortUrl: z.string().nullable().meta({ description: '落地页短链（已执行过且配置了落地页时回显）' }),
  clickCount: z.int().nullable().meta({ description: '落地页短链累计点击' }),
  status: z.enum(ANALYTICS_CAMPAIGN_STATUSES),
  totalCount: z.int(),
  sentCount: z.int(),
  failedCount: z.int(),
  lastRunAt: z.string().nullable(),
  lastError: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AnalyticsSegmentCampaign' });

export type AnalyticsSegmentCampaign = z.infer<typeof analyticsSegmentCampaignSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const analyticsCampaignListQuery = paginationQuery.extend({
  segmentId: z.coerce.number().int().positive().optional(),
  status: z.enum(ANALYTICS_CAMPAIGN_STATUSES).optional(),
});

/** 列表查询参数（契约解析后的形态，服务层入参类型） */
export type AnalyticsCampaignListQueryInput = z.infer<typeof analyticsCampaignListQuery>;

export const analyticsCampaignContract = defineContract('/api/analytics', {
  campaigns: op.get('/campaigns', { query: analyticsCampaignListQuery, response: paginated(analyticsSegmentCampaignSchema), summary: '分群触达活动列表' }),
  createCampaign: op.post('/campaigns', { body: createAnalyticsCampaignSchema, response: analyticsSegmentCampaignSchema, summary: '创建分群触达活动' }),
  updateCampaign: op.put('/campaigns/{id}', { params: idParam, body: updateAnalyticsCampaignSchema, response: analyticsSegmentCampaignSchema, summary: '更新分群触达活动' }),
  removeCampaign: op.delete('/campaigns/{id}', { params: idParam, summary: '删除分群触达活动' }),
  executeCampaign: op.post('/campaigns/{id}/execute', { params: idParam, response: asyncTaskSchema, summary: '执行分群触达活动（异步任务）' }),
}, { tags: ['Analytics'] });
