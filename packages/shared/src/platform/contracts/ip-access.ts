import * as z from 'zod';
import { dateRangeQuery, paginated, paginationQuery, queryEnum, keywordQuery } from '../../core/api-schemas';
import { IP_ACCESS_BLOCK_TYPE_OPTIONS, IP_ACCESS_BLOCK_TYPES } from '../constants';
import { defineContract, op } from '../../core/contract';
import { ipAccessSettingsSchema } from '../../settings/modules/ip-access';
import { isIpOrCidr } from '../../settings/ip-access-policy';

const decisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  matchedEntry: z.string().nullable(),
});

export const ipAccessContract = defineContract('/api/ip-access', {
  context: op.get('/context', {
    access: { permission: 'system:ip-access:view', platformOnly: 'multi-tenant' },
    response: z.object({ clientIp: z.string(), version: z.int(), baseToken: z.string(), decision: decisionSchema }),
    summary: '获取当前来源 IP 与已生效策略判定',
  }),
  logHealth: op.get('/log-health', {
    access: { permission: 'system:ip-access:log', platformOnly: 'multi-tenant' },
    response: z.object({ accepted: z.int(), stored: z.int(), dropped: z.int(), flushFailures: z.int(), pending: z.int(), flushing: z.boolean() }),
    summary: '查询当前 API 实例的拦截日志缓冲状态',
  }),
  diagnose: op.post('/diagnose', {
    access: { permission: 'system:ip-access:view', platformOnly: 'multi-tenant' },
    body: z.object({
      policy: ipAccessSettingsSchema,
      baseToken: z.string().min(1).max(512),
      ip: z.string().trim().max(64).refine((value) => !value.includes('/') && isIpOrCidr(value), '请输入合法的单个 IP 地址').optional(),
    }),
    response: z.object({ clientIp: z.string(), testedIp: z.string(), version: z.int(), baseToken: z.string(), currentDecision: decisionSchema, decision: decisionSchema }),
    summary: '诊断 IP 访问策略草稿（不保存、不记录拦截）',
  }),
});

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const ipAccessLogSchema = z.object({
  id: z.int(),
  ip: z.string(),
  path: z.string(),
  method: z.string(),
  blockType: z.enum(IP_ACCESS_BLOCK_TYPES),
  userAgent: z.string().nullable(),
  matchedEntry: z.string().nullable(),
  policyVersion: z.int().nullable(),
  correlationId: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'IpAccessLog' });

export type IpAccessLog = z.infer<typeof ipAccessLogSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const ipAccessLogListQuery = paginationQuery.extend({
  ip: keywordQuery('IP'),
  blockType: queryEnum(IP_ACCESS_BLOCK_TYPES, { description: '拦截类型', options: IP_ACCESS_BLOCK_TYPE_OPTIONS }),
  ...dateRangeQuery('拦截时间'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const ipAccessLogContract = defineContract('/api/ip-access-logs', {
  list: op.get('/', { access: { permission: 'system:ip-access:log', platformOnly: 'multi-tenant' }, query: ipAccessLogListQuery, response: paginated(ipAccessLogSchema), summary: 'IP 访问控制拦截日志分页查询' }),
}, { tags: ['IpAccessLogs'] });
