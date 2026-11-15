import * as z from 'zod';
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
