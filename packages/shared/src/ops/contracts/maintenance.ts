import * as z from 'zod';
import { paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MAINTENANCE_LOG_STATUSES } from '../constants';
import { updateMaintenanceSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const maintenanceStatusSchema = z.object({
  enabled: z.boolean().meta({ example: false }),
  message: z.string().meta({ example: '系统维护中，请稍后重试' }),
  estimatedEndAt: z.string().nullable().meta({ example: '2026-06-07 18:00:00' }),
  startedAt: z.string().nullable().meta({ example: '2026-06-07 16:00:00' }),
  startedByName: z.string().nullable().meta({ example: 'admin' }),
  updatedAt: z.string().meta({ example: '2026-06-07 16:00:00' }),
}).meta({ id: 'MaintenanceStatus' });

export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>;

/** 维护时段记录：每次「开启 → 关闭」为一条 */
export const maintenanceLogSchema = z.object({
  id: z.int().meta({ example: 1 }),
  message: z.string().meta({ example: '系统维护中，请稍后重试' }),
  estimatedEndAt: z.string().nullable().meta({ example: '2026-06-07 18:00:00' }),
  startedAt: z.string().nullable().meta({ example: '2026-06-07 16:00:00' }),
  startedByName: z.string().nullable().meta({ example: 'admin' }),
  endedAt: z.string().nullable().meta({ example: '2026-06-07 17:30:00' }),
  endedByName: z.string().nullable().meta({ example: 'admin' }),
  durationSeconds: z.int().nullable().meta({ example: 5400 }),
  status: z.enum(MAINTENANCE_LOG_STATUSES).meta({ example: 'completed' }),
  createdAt: z.string().meta({ example: '2026-06-07 16:00:00' }),
}).meta({ id: 'MaintenanceLog' });

export type MaintenanceLog = z.infer<typeof maintenanceLogSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const maintenanceLogListQuery = paginationQuery.extend({
  status: z.enum(MAINTENANCE_LOG_STATUSES).optional(),
});

export const maintenanceContract = defineContract('/api/maintenance', {
  status: op.get('/status', { response: maintenanceStatusSchema, public: true, summary: '获取维护模式状态（公开）' }),
  detail: op.get('/', { response: maintenanceStatusSchema, summary: '获取维护模式详情' }),
  update: op.put('/', { body: updateMaintenanceSchema, response: maintenanceStatusSchema, summary: '开启 / 关闭维护模式' }),
  logs: op.get('/logs', { query: maintenanceLogListQuery, response: paginated(maintenanceLogSchema), summary: '维护记录分页查询' }),
}, { tags: ['维护模式'] });
