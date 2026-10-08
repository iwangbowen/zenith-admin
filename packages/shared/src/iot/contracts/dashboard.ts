import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { iotAlarmSchema } from './alarms';
import { iotDeviceEventSchema } from './devices';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const iotDashboardStatsSchema = z.object({
  deviceTotal: z.int(),
  onlineCount: z.int(),
  onlineRate: z.number().meta({ description: '在线率 0-100' }),
  telemetryToday: z.int(),
  firingWarning: z.int(),
  firingCritical: z.int(),
  pendingDesiredDevices: z.int().meta({ description: '存在待确认期望值的设备数' }),
  productTotal: z.int(),
}).meta({ id: 'IotDashboardStats' });

export type IotDashboardStats = z.infer<typeof iotDashboardStatsSchema>;

export const iotOnlineTrendPointSchema = z.object({
  time: z.string().meta({ description: 'YYYY-MM-DD HH:mm:ss（10 分钟桶）' }),
  total: z.int(),
  online: z.int(),
});

export type IotOnlineTrendPoint = z.infer<typeof iotOnlineTrendPointSchema>;

export const iotAlarmTrendPointSchema = z.object({
  date: z.string().meta({ description: 'YYYY-MM-DD' }),
  warning: z.int(),
  critical: z.int(),
});

export type IotAlarmTrendPoint = z.infer<typeof iotAlarmTrendPointSchema>;

export const iotProductDistributionItemSchema = z.object({
  name: z.string(),
  value: z.int(),
});

export type IotProductDistributionItem = z.infer<typeof iotProductDistributionItemSchema>;

/** IoT 总览：统计卡 + 在线 / 告警趋势 + 产品分布 + 最近告警与事件 */
export const iotDashboardSchema = z.object({
  stats: iotDashboardStatsSchema,
  onlineTrend: z.array(iotOnlineTrendPointSchema).meta({ description: '近 24h 在线趋势' }),
  alarmTrend: z.array(iotAlarmTrendPointSchema).meta({ description: '近 7 天告警趋势（按级别）' }),
  productDistribution: z.array(iotProductDistributionItemSchema),
  recentAlarms: z.array(iotAlarmSchema),
  recentEvents: z.array(iotDeviceEventSchema.extend({ deviceName: z.string().nullable() })),
}).meta({ id: 'IotDashboard' });

export type IotDashboard = z.infer<typeof iotDashboardSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const iotDashboardContract = defineContract('/api/iot/dashboard', {
  overview: op.get('/', { access: { permission: 'iot:dashboard:view' }, response: iotDashboardSchema, summary: 'IoT 总览（统计卡 / 在线与告警趋势 / 产品分布 / 最近告警与事件）' }),
}, { tags: ['IoT 仪表盘'], feature: 'iot' });
