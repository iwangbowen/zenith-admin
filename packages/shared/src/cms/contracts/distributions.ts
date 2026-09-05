import * as z from 'zod';
import { auditFieldsSchema, dateRangeBound, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskItemSchema, asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import {
  CMS_CONTENT_TYPES,
  CMS_DISTRIBUTION_CONFLICT_STRATEGIES,
  CMS_DISTRIBUTION_MODES,
  CMS_DISTRIBUTION_RUN_TRIGGERS,
  CMS_DISTRIBUTION_TASK_STATUSES,
} from '../constants';
import { createCmsDistributionRuleSchema, updateCmsDistributionRuleSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsDistributionFiltersViewSchema = z.object({
  statuses: z.array(z.literal('published')).meta({ description: '仅允许 published；数组形状供后续扩展' }),
  contentTypes: z.array(z.enum(CMS_CONTENT_TYPES)),
  keyword: z.string().nullable(),
  publishedFrom: z.string().nullable(),
  publishedTo: z.string().nullable(),
}).meta({ id: 'CmsDistributionFilters' });

export type CmsDistributionFilters = z.infer<typeof cmsDistributionFiltersViewSchema>;

export const cmsDistributionRuleSchema = z.object({
  id: z.int(),
  name: z.string(),
  sourceSiteId: z.int(),
  sourceSiteName: z.string(),
  sourceChannelId: z.int().nullable(),
  sourceChannelName: z.string().nullable(),
  targetSiteId: z.int(),
  targetSiteName: z.string(),
  targetChannelId: z.int(),
  targetChannelName: z.string(),
  mode: z.enum(CMS_DISTRIBUTION_MODES),
  conflictStrategy: z.enum(CMS_DISTRIBUTION_CONFLICT_STRATEGIES),
  filters: cmsDistributionFiltersViewSchema,
  scheduleCron: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  status: entityStatusSchema,
  revision: z.int(),
  remark: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsDistributionRule' });

export type CmsDistributionRule = z.infer<typeof cmsDistributionRuleSchema>;

export const cmsDistributionRunSchema = asyncTaskSchema.extend({
  ruleId: z.int(),
  ruleName: z.string().nullable(),
  sourceSiteId: z.int(),
  sourceSiteName: z.string().nullable(),
  targetSiteId: z.int(),
  targetSiteName: z.string().nullable(),
  trigger: z.enum(CMS_DISTRIBUTION_RUN_TRIGGERS),
  succeeded: z.int(),
  skipped: z.int(),
  conflicts: z.int(),
}).meta({ id: 'CmsDistributionRun' });

export type CmsDistributionRun = z.infer<typeof cmsDistributionRunSchema>;

export const cmsDistributionRunDetailSchema = z.object({
  run: cmsDistributionRunSchema,
  items: z.array(asyncTaskItemSchema),
}).meta({ id: 'CmsDistributionRunDetail' });

export type CmsDistributionRunDetail = z.infer<typeof cmsDistributionRunDetailSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsDistributionRuleListQuery = paginationQuery.extend({
  keyword: z.string().max(100).optional(),
  sourceSiteId: z.coerce.number().int().positive().optional(),
  targetSiteId: z.coerce.number().int().positive().optional(),
  mode: z.enum(CMS_DISTRIBUTION_MODES).optional(),
  status: entityStatusSchema.optional(),
});

export const cmsDistributionRunListQuery = paginationQuery.extend({
  ruleId: z.coerce.number().int().positive().optional(),
  siteId: z.coerce.number().int().positive().optional(),
  status: z.enum(CMS_DISTRIBUTION_TASK_STATUSES).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsDistributionContract = defineContract('/api/cms/distributions', {
  list: op.get('/', { query: cmsDistributionRuleListQuery, response: paginated(cmsDistributionRuleSchema), summary: '受权分发规则分页列表' }),
  runs: op.get('/runs', { query: cmsDistributionRunListQuery, response: paginated(cmsDistributionRunSchema), summary: '分发同步结果与日志' }),
  runDetail: op.get('/runs/{id}', { params: idParam, response: cmsDistributionRunDetailSchema, summary: '分发同步行级结果' }),
  create: op.post('/', { body: createCmsDistributionRuleSchema, response: cmsDistributionRuleSchema, summary: '创建受治理分发规则' }),
  run: op.post('/{id}/run', { params: idParam, response: asyncTaskSchema, summary: '提交分发同步任务' }),
  detail: op.get('/{id}', { params: idParam, response: cmsDistributionRuleSchema, summary: '分发规则详情' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsDistributionRuleSchema, response: cmsDistributionRuleSchema, summary: '编辑或启停分发规则' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除分发规则（保留已物化内容）' }),
}, { tags: ['CMS-内容分发'] });
