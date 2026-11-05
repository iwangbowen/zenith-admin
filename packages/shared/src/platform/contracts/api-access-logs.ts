import * as z from 'zod';
import { dateRangeQuery, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { API_ACCESS_ACCESSOR_TYPES, API_ACCESS_CREDENTIAL_TYPES, OPERATION_LOG_RESULTS } from '../constants';

export const apiAccessLogSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  accessorId: z.string().nullable(),
  userId: z.int().nullable(),
  deviceId: z.int().nullable(),
  memberId: z.int().nullable(),
  clientId: z.string().nullable(),
  accessorName: z.string().nullable(),
  impersonatorId: z.int().nullable(),
  impersonatorName: z.string().nullable(),
  accessorType: z.enum(API_ACCESS_ACCESSOR_TYPES),
  credentialType: z.enum(API_ACCESS_CREDENTIAL_TYPES),
  method: z.string(),
  path: z.string(),
  routePath: z.string().nullable(),
  correlationId: z.string().nullable(),
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

/** 列表摘要不携带请求快照、UA 和错误正文；详情接口才返回这些较大字段。 */
export const apiAccessLogListItemSchema = apiAccessLogSchema.omit({ queryParams: true, requestBody: true, userAgent: true, errorMessage: true }).meta({ id: 'ApiAccessLogListItem' });
export type ApiAccessLogListItem = z.infer<typeof apiAccessLogListItemSchema>;

export const apiAccessLogListQuery = paginationQuery.extend({
  userId: idQuery(),
  deviceId: idQuery(),
  accessorId: keywordQuery('访问人 / 调用方 ID'),
  memberId: idQuery(),
  clientId: keywordQuery('应用 ID'),
  accessorName: keywordQuery('访问人 / 调用方'),
  accessorType: queryEnum(API_ACCESS_ACCESSOR_TYPES),
  credentialType: queryEnum(API_ACCESS_CREDENTIAL_TYPES),
  module: keywordQuery('模块'),
  operationKey: keywordQuery('操作标识'),
  method: keywordQuery('请求方法'),
  path: keywordQuery('请求地址'),
  routePath: keywordQuery('路由模板'),
  correlationId: keywordQuery('关联 ID'),
  serviceName: keywordQuery('服务名'),
  ip: keywordQuery('IP 地址'),
  responseCode: z.coerce.number().int().min(100).max(599).optional(),
  status: queryEnum(OPERATION_LOG_RESULTS),
  content: keywordQuery('请求参数'),
  ...dateRangeQuery('请求时间'),
  minDurationMs: z.coerce.number().int().nonnegative().optional(),
  maxDurationMs: z.coerce.number().int().nonnegative().optional(),
});

export const apiAccessLogContract = defineContract('/api/api-access-logs', {
  list: op.get('/', { access: { permission: 'system:api-access-log:list', platformOnly: 'multi-tenant' }, query: apiAccessLogListQuery, response: paginated(apiAccessLogListItemSchema), summary: 'API 访问日志分页列表' }),
  detail: op.get('/{id}', { access: { permission: 'system:api-access-log:list', platformOnly: 'multi-tenant' }, params: idParam, response: apiAccessLogSchema, summary: 'API 访问日志详情' }),
}, { auditModule: 'API 访问日志', tags: ['ApiAccessLogs'] });

