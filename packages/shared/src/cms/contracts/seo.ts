import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { CMS_PUSH_ENGINES } from '../constants';
import {
  cmsSiteIdBodySchema,
  createCmsLinkWordSchema,
  createCmsRedirectSchema,
  pushCmsUrlsSchema,
  updateCmsLinkWordSchema,
  updateCmsRedirectSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsRedirectSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  fromPath: z.string().meta({ example: '/old-page.html' }),
  toUrl: z.string().meta({ example: '/news/' }),
  redirectType: z.int().meta({ example: 301 }),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsRedirect' });

export type CmsRedirect = z.infer<typeof cmsRedirectSchema>;

export const cmsLinkWordSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  keyword: z.string().meta({ example: '全文检索' }),
  url: z.string(),
  maxReplaces: z.int(),
  status: entityStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsLinkWord' });

export type CmsLinkWord = z.infer<typeof cmsLinkWordSchema>;

export const cmsPushLogSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  engine: z.string().meta({ example: 'baidu' }),
  urls: z.array(z.string()),
  success: z.boolean(),
  statusCode: z.int().nullable(),
  response: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'CmsPushLog' });

export type CmsPushLog = z.infer<typeof cmsPushLogSchema>;

export const cmsPushResultSchema = z.object({
  engine: z.string(),
  submitted: z.boolean(),
  reason: z.string().optional(),
}).meta({ id: 'CmsPushResult' });

export type CmsPushResult = z.infer<typeof cmsPushResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsSeoListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  keyword: z.string().optional(),
});

export const cmsPushLogListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  engine: z.enum(CMS_PUSH_ENGINES).optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsSeoContract = defineContract('/api/cms/seo', {
  redirectList: op.get('/redirects', { query: cmsSeoListQuery, response: paginated(cmsRedirectSchema), summary: '重定向规则列表' }),
  redirectCreate: op.post('/redirects', { body: createCmsRedirectSchema, response: cmsRedirectSchema, summary: '创建重定向规则' }),
  redirectUpdate: op.put('/redirects/{id}', { params: idParam, body: updateCmsRedirectSchema, response: cmsRedirectSchema, summary: '更新重定向规则' }),
  redirectRemove: op.delete('/redirects/{id}', { params: idParam, summary: '删除重定向规则' }),
  linkWordList: op.get('/link-words', { query: cmsSeoListQuery, response: paginated(cmsLinkWordSchema), summary: '内链词列表' }),
  linkWordCreate: op.post('/link-words', { body: createCmsLinkWordSchema, response: cmsLinkWordSchema, summary: '创建内链词' }),
  linkWordUpdate: op.put('/link-words/{id}', { params: idParam, body: updateCmsLinkWordSchema, response: cmsLinkWordSchema, summary: '更新内链词' }),
  linkWordRemove: op.delete('/link-words/{id}', { params: idParam, summary: '删除内链词' }),
  push: op.post('/push', { body: pushCmsUrlsSchema, response: z.array(cmsPushResultSchema), summary: '手动推送 URL 到搜索引擎（百度/IndexNow）' }),
  pushLogs: op.get('/push-logs', { query: cmsPushLogListQuery, response: paginated(cmsPushLogSchema), summary: '推送日志' }),
  deadlinkCheck: op.post('/deadlink-check', { body: cmsSiteIdBodySchema, response: asyncTaskSchema, summary: '提交死链检测任务（站内链接查库 + 外链探测）' }),
}, { tags: ['CMS-SEO'] });
