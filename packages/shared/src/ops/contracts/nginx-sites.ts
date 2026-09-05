import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { NGINX_RUNNING_STATUSES } from '../constants';
import { createNginxSiteSchema, updateNginxSiteContentSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const nginxInfoSchema = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
  configPath: z.string().nullable(),
  sitesAvailable: z.string().nullable(),
  sitesEnabled: z.string().nullable(),
  runningStatus: z.enum(NGINX_RUNNING_STATUSES),
}).meta({ id: 'NginxInfo' });

export type NginxInfo = z.infer<typeof nginxInfoSchema>;

export const nginxSiteSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  configPath: z.string(),
  serverName: z.string().nullable(),
  listenPort: z.number().nullable(),
  root: z.string().nullable(),
  sslEnabled: z.boolean(),
  accessLog: z.string().nullable().meta({ description: '配置中显式声明的访问日志路径（未声明为 null），供日志查看器深链' }),
  errorLog: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).meta({ id: 'NginxSite' });

export type NginxSite = z.infer<typeof nginxSiteSchema>;

export const nginxSiteDetailSchema = nginxSiteSchema.extend({
  content: z.string(),
}).meta({ id: 'NginxSiteDetail' });

export type NginxSiteDetail = z.infer<typeof nginxSiteDetailSchema>;

export const nginxTestResultSchema = z.object({
  success: z.boolean(),
  output: z.string(),
}).meta({ id: 'NginxTestResult' });

export type NginxTestResult = z.infer<typeof nginxTestResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const nginxSiteNameParam = z.object({
  name: z.string().min(1).max(100).meta({ description: '站点名', example: 'example.com' }),
});

export const nginxSiteContract = defineContract('/api/nginx-sites', {
  info: op.get('/info', { response: nginxInfoSchema, summary: '获取 Nginx 信息' }),
  list: op.get('/', { response: z.array(nginxSiteSchema), summary: '获取 Nginx 站点列表' }),
  test: op.post('/test', { response: nginxTestResultSchema, summary: '测试 Nginx 配置' }),
  reload: op.post('/reload', { summary: '重载 Nginx' }),
  detail: op.get('/{name}', { params: nginxSiteNameParam, response: nginxSiteDetailSchema, summary: '获取 Nginx 站点详情' }),
  create: op.post('/', { body: createNginxSiteSchema, summary: '创建 Nginx 站点' }),
  update: op.put('/{name}', { params: nginxSiteNameParam, body: updateNginxSiteContentSchema, summary: '更新 Nginx 站点配置内容' }),
  remove: op.delete('/{name}', { params: nginxSiteNameParam, summary: '删除 Nginx 站点' }),
  enable: op.post('/{name}/enable', { params: nginxSiteNameParam, summary: '启用 Nginx 站点' }),
  disable: op.post('/{name}/disable', { params: nginxSiteNameParam, summary: '禁用 Nginx 站点' }),
}, { tags: ['Nginx站点'] });
