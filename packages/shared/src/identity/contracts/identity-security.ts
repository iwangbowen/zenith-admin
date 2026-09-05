import * as z from 'zod';
import { paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { LOGIN_RISK_ACTIONS, LOGIN_RISK_LEVELS } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const loginRiskEventSchema = z.object({
  id: z.int(),
  userId: z.int().nullable(),
  username: z.string(),
  tenantId: z.int().nullable(),
  riskLevel: z.enum(LOGIN_RISK_LEVELS),
  reason: z.string(),
  action: z.enum(LOGIN_RISK_ACTIONS),
  ip: z.string().nullable(),
  location: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'LoginRiskEvent' });

export type LoginRiskEvent = z.infer<typeof loginRiskEventSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const loginRiskEventListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按用户名 / 原因 / IP 模糊匹配' }),
});

export const identitySecurityContract = defineContract('/api/identity-security', {
  riskEvents: op.get('/risk-events', { query: loginRiskEventListQuery, response: paginated(loginRiskEventSchema), summary: '登录风险事件' }),
}, { tags: ['IdentitySecurity'] });
