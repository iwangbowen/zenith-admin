import * as z from 'zod';
import { dateRangeQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { IP_ACCESS_BLOCK_TYPES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const ipAccessLogSchema = z.object({
  id: z.int(),
  ip: z.string(),
  path: z.string(),
  method: z.string(),
  blockType: z.enum(IP_ACCESS_BLOCK_TYPES),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'IpAccessLog' });

export type IpAccessLog = z.infer<typeof ipAccessLogSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const ipAccessLogListQuery = paginationQuery.extend({
  ip: z.string().optional(),
  blockType: queryEnum(IP_ACCESS_BLOCK_TYPES),
  ...dateRangeQuery('拦截时间'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const ipAccessLogContract = defineContract('/api/ip-access-logs', {
  list: op.get('/', { query: ipAccessLogListQuery, response: paginated(ipAccessLogSchema), summary: 'IP 访问控制拦截日志分页查询' }),
}, { tags: ['IpAccessLogs'] });
