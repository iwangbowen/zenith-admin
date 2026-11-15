import * as z from 'zod';
import { dateRangeQuery, idParam, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MAINTENANCE_LOG_STATUSES, MAINTENANCE_LOG_STATUS_OPTIONS } from '../constants';
import { maintenanceActionSchema, maintenancePlanSchema, updateMaintenanceSchema } from '../maintenance-validation';

export const publicMaintenanceStatusSchema = z.object({
  enabled: z.boolean(), message: z.string(), estimatedEndAt: z.string().nullable(), startedAt: z.string().nullable(),
  scheduledStartAt: z.string().nullable(), autoEndAt: z.string().nullable(), version: z.int(),
}).meta({ id: 'PublicMaintenanceStatus' });
export const maintenanceChangeSchema = z.object({ action: z.string(), at: z.string(), actor: z.string(), reason: z.string(), message: z.string(), estimatedEndAt: z.string().nullable(), autoEndAt: z.string().nullable() });
export const maintenanceLogSchema = z.object({
  id: z.int(), message: z.string(), estimatedEndAt: z.string().nullable(), scheduledStartAt: z.string().nullable(),
  autoEndAt: z.string().nullable(), startedAt: z.string().nullable(), startedByName: z.string().nullable(),
  endedAt: z.string().nullable(), endedByName: z.string().nullable(), durationSeconds: z.int().nullable(),
  status: z.enum(MAINTENANCE_LOG_STATUSES), reason: z.string(), endReason: z.string().nullable(),
  notifyUserIds: z.array(z.int()), remindMinutes: z.int(), changes: z.array(maintenanceChangeSchema), createdAt: z.string(),
}).meta({ id: 'MaintenanceLog' });
export const maintenanceStatusSchema = publicMaintenanceStatusSchema.extend({
  startedByName: z.string().nullable(), updatedAt: z.string().nullable(), current: maintenanceLogSchema.nullable(),
}).meta({ id: 'MaintenanceStatus' });
export const maintenanceAccessSchema = z.object({ canView: z.boolean(), canManage: z.boolean(), canViewLogs: z.boolean(), canBypass: z.boolean() });
export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>;
export type MaintenanceLog = z.infer<typeof maintenanceLogSchema>;
export type PublicMaintenanceStatus = z.infer<typeof publicMaintenanceStatusSchema>;
export const maintenanceLogListQuery = paginationQuery.extend({
  status: queryEnum(MAINTENANCE_LOG_STATUSES, { description: '维护状态', options: MAINTENANCE_LOG_STATUS_OPTIONS }),
  keyword: keywordQuery('提示 / 原因 / 操作人'), ...dateRangeQuery('维护记录创建时间'),
});
const view = { permission: ['system:maintenance:view', 'system:maintenance:manage'] as const, platformOnly: 'multi-tenant' as const };
const manage = { permission: 'system:maintenance:manage' as const, platformOnly: 'multi-tenant' as const };
export const maintenanceContract = defineContract('/api/maintenance', {
  status: op.get('/status', { response: publicMaintenanceStatusSchema, public: true, summary: '公开维护摘要' }),
  access: op.get('/access', { access: 'authenticated', response: maintenanceAccessSchema, summary: '当前用户维护管理与通行能力' }),
  detail: op.get('/', { access: view, response: maintenanceStatusSchema, summary: '维护管理详情' }),
  recipients: op.get('/recipients', { access: manage, response: z.array(z.object({ id: z.int(), username: z.string(), nickname: z.string() })), summary: '可选的平台维护通知接收人' }),
  update: op.put('/', { access: manage, audit: '变更维护状态或说明', body: updateMaintenanceSchema, response: maintenanceStatusSchema, summary: '开启、更新、保存草稿或结束维护' }),
  plan: op.post('/plans', { access: manage, audit: '安排维护计划', body: maintenancePlanSchema, response: maintenanceStatusSchema, summary: '创建一次性维护计划' }),
  start: op.post('/start', { access: manage, audit: '提前开始维护', body: maintenanceActionSchema, response: maintenanceStatusSchema, summary: '提前开始当前维护计划' }),
  cancel: op.post('/cancel', { access: manage, audit: '取消维护计划', body: maintenanceActionSchema, response: maintenanceStatusSchema, summary: '取消待开始的维护计划' }),
  logs: op.get('/logs', { access: { permission: ['system:maintenance:log', 'system:maintenance:manage'], platformOnly: 'multi-tenant' }, query: maintenanceLogListQuery, response: paginated(maintenanceLogSchema), summary: '维护时段记录' }),
  log: op.get('/logs/{id}', { access: { permission: ['system:maintenance:log', 'system:maintenance:manage'], platformOnly: 'multi-tenant' }, params: idParam, response: maintenanceLogSchema, summary: '维护记录与变更过程' }),
  diagnose: op.post('/diagnose', { access: view, body: z.object({ method: z.string().regex(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/), path: z.string().min(1).max(512).startsWith('/api/'), version: z.int().min(0) }),
    response: z.object({ allowed: z.boolean(), reason: z.string(), version: z.int(), exceptions: z.array(z.object({ method: z.string(), path: z.string(), reason: z.string() })), boundaries: z.array(z.string()) }), summary: '诊断当前主体的维护访问判定' }),
}, { auditModule: '维护模式', tags: ['维护模式'] });
