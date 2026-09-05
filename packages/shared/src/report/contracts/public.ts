import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import {
  reportCanvasItemSchema,
  reportDashboardConfigSchema,
  reportDashboardDataBodySchema,
  reportFilterSchema,
  reportGridItemSchema,
  reportPublicAccessSchema,
} from '../validation';
import { reportDashboardDataSchema } from './_common';
import { reportDashboardWidgetSchema } from './dashboards';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 公开分享 / 匿名嵌入渲染用的精简仪表盘（无敏感字段） */
export const reportPublicDashboardSchema = z.object({
  name: z.string(),
  layout: z.array(reportGridItemSchema),
  canvasLayout: z.array(reportCanvasItemSchema),
  widgets: z.array(reportDashboardWidgetSchema),
  filters: z.array(reportFilterSchema),
  config: reportDashboardConfigSchema,
  filterOptions: z.record(z.string(), z.array(z.object({ value: z.string(), label: z.string() }))).optional()
    .meta({ description: '筛选器动态选项（按筛选器 id）' }),
}).meta({ id: 'ReportPublicDashboard' });

export type ReportPublicDashboard = z.infer<typeof reportPublicDashboardSchema>;

export const reportPublicAccessSessionSchema = z.object({
  accessSessionToken: z.string(),
  expiresAt: z.string(),
  dashboard: reportPublicDashboardSchema,
}).meta({ id: 'ReportPublicAccessSession' });

export type ReportPublicAccessSession = z.infer<typeof reportPublicAccessSessionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportPublicTokenParam = z.object({
  token: z.string().min(8).meta({ description: '分享 / 嵌入令牌', example: 'a1b2c3d4' }),
});

/**
 * 公开分享与匿名嵌入：无需登录令牌。分享类接口需先经 `access` 换取访问会话，
 * 随后以 `session` 请求头携带；嵌入类接口仅凭嵌入令牌。
 */
export const reportPublicContract = defineContract('/api/report/public', {
  access: op.post('/dashboards/{token}/access', {
    params: reportPublicTokenParam,
    body: reportPublicAccessSchema,
    response: reportPublicAccessSessionSchema,
    public: true,
    summary: '公开仪表盘密码验证并签发访问会话',
  }),
  dashboard: op.get('/dashboards/{token}', {
    params: reportPublicTokenParam,
    response: reportPublicDashboardSchema,
    public: true,
    summary: '公开仪表盘（需访问会话）',
    description: '须携带 `session` 请求头（由 access 接口签发）',
  }),
  dashboardData: op.post('/dashboards/{token}/data', {
    params: reportPublicTokenParam,
    body: reportDashboardDataBodySchema,
    response: reportDashboardDataSchema,
    public: true,
    summary: '公开仪表盘取数',
    description: '须携带 `session` 请求头（由 access 接口签发）',
  }),
  embed: op.get('/embed/{token}', {
    params: reportPublicTokenParam,
    response: reportPublicDashboardSchema,
    public: true,
    summary: '匿名嵌入读取仪表盘',
  }),
  embedData: op.post('/embed/{token}/data', {
    params: reportPublicTokenParam,
    body: reportDashboardDataBodySchema,
    response: reportDashboardDataSchema,
    public: true,
    summary: '匿名嵌入仪表盘取数',
  }),
}, { tags: ['报表公开'] });
