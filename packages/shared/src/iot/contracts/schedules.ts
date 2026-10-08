import * as z from 'zod';
import { auditFieldsSchema, entityStatusQuery, entityStatusSchema, idParam, idQuery, keywordQuery, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { IOT_SCHEDULE_ACTIONS, IOT_SCHEDULE_TYPES } from '../constants';
import { createIotScheduleSchema, updateIotScheduleSchema } from '../validation';
import { iotMetricsSchema } from './devices';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const iotScheduleSchema = z.object({
  id: z.int(),
  name: z.string(),
  scheduleType: z.enum(IOT_SCHEDULE_TYPES),
  cronExpression: z.string().nullable().meta({ description: 'cron 型：五段 cron 表达式（分 时 日 月 周）' }),
  runAt: z.string().nullable().meta({ description: 'once 型：执行时刻' }),
  productId: z.int(),
  productName: z.string().nullable(),
  groupId: z.int().nullable(),
  groupName: z.string().nullable(),
  deviceId: z.int().nullable(),
  deviceName: z.string().nullable(),
  actionType: z.enum(IOT_SCHEDULE_ACTIONS),
  service: z.string().nullable(),
  params: z.record(z.string(), z.unknown()).nullable(),
  desired: iotMetricsSchema.nullable(),
  status: entityStatusSchema,
  nextRunAt: z.string().nullable().meta({ description: '下次应执行时刻；once 执行后置空并停用' }),
  lastRunAt: z.string().nullable(),
  recentRunCount: z.int().meta({ description: '近 24h 执行次数' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotSchedule' });

export type IotSchedule = z.infer<typeof iotScheduleSchema>;

export const iotScheduleRunSchema = z.object({
  id: z.int(),
  scheduleId: z.int(),
  scheduleName: z.string(),
  deviceCount: z.int(),
  successCount: z.int(),
  failedCount: z.int(),
  errors: z.array(z.object({
    deviceId: z.int(),
    sn: z.string(),
    error: z.string(),
  })).meta({ description: '失败明细（截断保留前 20 条）' }),
  createdAt: z.string(),
}).meta({ id: 'IotScheduleRun' });

export type IotScheduleRun = z.infer<typeof iotScheduleRunSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const iotScheduleListQuery = paginationQuery.extend({
  keyword: keywordQuery(),
  productId: idQuery(),
  status: entityStatusQuery,
});

export const iotScheduleRunListQuery = paginationQuery.extend({
  scheduleId: idQuery(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const iotScheduleContract = defineContract('/api/iot/schedules', {
  list: op.get('/', { access: { permission: 'iot:schedule:list' }, query: iotScheduleListQuery, response: paginated(iotScheduleSchema), summary: '计划任务列表（含下次执行时刻与近 24h 执行数）' }),
  runs: op.get('/runs', { access: { permission: 'iot:schedule:list' }, query: iotScheduleRunListQuery, response: paginated(iotScheduleRunSchema), summary: '计划执行记录（按时间倒序）' }),
  create: op.post('/', { access: { permission: 'iot:schedule:create' }, audit: '创建 IoT 计划任务', body: createIotScheduleSchema, response: iotScheduleSchema, summary: '创建计划任务（cron 周期 / 定时一次）' }),
  update: op.put('/{id}', { access: { permission: 'iot:schedule:update' }, audit: '更新 IoT 计划任务', params: idParam, body: updateIotScheduleSchema, response: iotScheduleSchema, summary: '更新计划任务（类型/产品/动作不可变更）' }),
  remove: op.delete('/{id}', { access: { permission: 'iot:schedule:delete' }, audit: '删除 IoT 计划任务', params: idParam, summary: '删除计划任务（执行记录级联删除）' }),
}, { auditModule: 'IoT 计划任务', tags: ['IoT 计划任务'], feature: 'iot' });
