import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { ANALYTICS_EVENT_OVERRIDE_STATUSES } from '../constants';
import { createAnalyticsSiteSchema, updateAnalyticsSiteSchema } from '../validation';


// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 站点（匿名 site key 归属） */
export const analyticsSiteSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  tenantName: z.string().nullable(),
  siteKey: z.string().meta({ description: 'SDK 上报时携带的站点 Key', example: 'zk_admin_default_0000000000000000' }),
  name: z.string(),
  appId: z.string(),
  allowedOrigins: z.array(z.string()).nullable().meta({ description: '允许的来源 origin 白名单；null = 不限制' }),
  dailyEventQuota: z.int().nullable().meta({ description: '每日事件配额；null = 不限制' }),
  todayUsage: z.int().nullable().meta({ description: '今日已用配额（列表返回；写操作响应为 null）' }),
  status: z.enum(ANALYTICS_EVENT_OVERRIDE_STATUSES),
  remark: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AnalyticsSite' });

export type AnalyticsSite = z.infer<typeof analyticsSiteSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const analyticsSiteListQuery = paginationQuery.extend({
  name: z.string().optional(),
  appId: z.string().optional(),
  status: queryEnum(ANALYTICS_EVENT_OVERRIDE_STATUSES),
});

export const analyticsSiteContract = defineContract('/api/analytics', {
  sites: op.get('/sites', { query: analyticsSiteListQuery, response: paginated(analyticsSiteSchema), summary: '站点列表' }),
  createSite: op.post('/sites', { body: createAnalyticsSiteSchema, response: analyticsSiteSchema, summary: '创建站点' }),
  updateSite: op.put('/sites/{id}', { params: idParam, body: updateAnalyticsSiteSchema, response: analyticsSiteSchema, summary: '更新站点' }),
  removeSite: op.delete('/sites/{id}', { params: idParam, summary: '删除站点' }),
  regenerateSiteKey: op.post('/sites/{id}/regenerate-key', { params: idParam, response: analyticsSiteSchema, summary: '重新生成站点 Key' }),
}, { tags: ['Analytics'] });
