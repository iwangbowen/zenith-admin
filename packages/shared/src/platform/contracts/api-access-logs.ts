import * as z from 'zod';
import { dateRangeQuery, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { OPERATION_LOG_RESULTS } from '../constants';

export const apiAccessLogSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  userId: z.int().nullable(),
  username: z.string().nullable(),
  impersonatorId: z.int().nullable(),
  impersonatorName: z.string().nullable(),
  principalType: z.string(),
  authType: z.string(),
  method: z.string(),
  path: z.string(),
  routePath: z.string().nullable(),
  requestId: z.string().nullable(),
  queryParams: z.record(z.string(), z.string()).nullable(),
  requestBody: z.unknown().nullable(),
  module: z.string().nullable(),
  operationKey: z.string().nullable(),
  operationName: z.string().nullable(),
  operationType: z.string().nullable(),
  responseCode: z.int().nullable(),
  durationMs: z.int().nullable(),
  errorName: z.string().nullable(),
  errorMessage: z.string().nullable(),
  serviceName: z.string().nullable(),
  processRole: z.string().nullable(),
  hostname: z.string().nullable(),
  pid: z.int().nullable(),
  ip: z.string().nullable(),
  location: z.string().nullable(),
  userAgent: z.string().nullable(),
  os: z.string().nullable(),
  browser: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'ApiAccessLog' });

export type ApiAccessLog = z.infer<typeof apiAccessLogSchema>;

export const apiAccessLogListQuery = paginationQuery.extend({
  userId: idQuery(),
  username: keywordQuery('用户名 / 标识'),
  principalType: keywordQuery('主体类型'),
  authType: keywordQuery('认证方式'),
  module: keywordQuery('模块'),
  operationKey: keywordQuery('操作标识'),
  method: keywordQuery('请求方法'),
  path: keywordQuery('请求地址'),
  routePath: keywordQuery('路由模板'),
  requestId: keywordQuery('请求 ID'),
  status: queryEnum(OPERATION_LOG_RESULTS),
  content: keywordQuery('请求参数'),
  ...dateRangeQuery('请求时间'),
  minDurationMs: z.coerce.number().int().nonnegative().optional(),
  maxDurationMs: z.coerce.number().int().nonnegative().optional(),
});

export const apiAccessLogContract = defineContract('/api/api-access-logs', {
  list: op.get('/', { access: { permission: 'system:api-access-log:list', platformOnly: 'multi-tenant' }, query: apiAccessLogListQuery, response: paginated(apiAccessLogSchema), summary: 'API 访问日志分页列表' }),
  detail: op.get('/{id}', { access: { permission: 'system:api-access-log:list', platformOnly: 'multi-tenant' }, params: idParam, response: apiAccessLogSchema, summary: 'API 访问日志详情' }),
}, { auditModule: 'API 访问日志', tags: ['ApiAccessLogs'] });

