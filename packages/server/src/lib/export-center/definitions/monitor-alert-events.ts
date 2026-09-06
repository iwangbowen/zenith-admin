import { desc, eq } from 'drizzle-orm';
import {
  MONITOR_ALERT_EVENT_STATUS_LABELS,
  MONITOR_ALERT_HANDLE_STATUS_LABELS,
  MONITOR_ALERT_LEVEL_LABELS,
  MONITOR_ALERT_NOTIFY_STATUS_LABELS,
  MONITOR_METRIC_LABELS,
} from '@zenith/shared/platform';
import { NOTIFY_CHANNEL_LABELS } from '@zenith/shared/messaging';
import { db } from '../../../db';
import { monitorAlertEvents, users } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { buildEventListWhere } from '../../../services/platform/monitor-alert.service';
import type { MonitorAlertEventQuery } from '@zenith/shared/platform';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const OPERATOR_LABELS: Record<string, string> = { gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于' };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'ruleName', header: '规则名称', width: 24 },
  { key: 'metric', header: '监控指标', width: 18, enumMap: MONITOR_METRIC_LABELS },
  { key: 'operator', header: '比较符', width: 12, enumMap: OPERATOR_LABELS },
  { key: 'threshold', header: '阈值', width: 12, type: 'number' },
  { key: 'value', header: '实际值', width: 12, type: 'number' },
  { key: 'level', header: '告警级别', width: 10, enumMap: MONITOR_ALERT_LEVEL_LABELS },
  { key: 'status', header: '告警状态', width: 10, enumMap: MONITOR_ALERT_EVENT_STATUS_LABELS },
  { key: 'message', header: '描述', width: 48 },
  { key: 'notifyStatus', header: '通知状态', width: 12, enumMap: MONITOR_ALERT_NOTIFY_STATUS_LABELS },
  { key: 'notifyChannels', header: '通知渠道', width: 20 },
  { key: 'notifyError', header: '通知失败原因', width: 40 },
  { key: 'notifiedAt', header: '通知时间', width: 20, type: 'datetime' },
  { key: 'handleStatus', header: '处理状态', width: 12, enumMap: MONITOR_ALERT_HANDLE_STATUS_LABELS },
  { key: 'handledByName', header: '处理人', width: 16 },
  { key: 'acknowledgedAt', header: '确认时间', width: 20, type: 'datetime' },
  { key: 'handledAt', header: '最近处理时间', width: 20, type: 'datetime' },
  { key: 'handleNote', header: '处理备注', width: 40 },
  { key: 'triggeredAt', header: '触发时间', width: 20, type: 'datetime' },
  { key: 'resolvedAt', header: '恢复时间', width: 20, type: 'datetime' },
];

export const monitorAlertEventsExportDefinition = defineExport<
  MonitorAlertEventQuery & Record<string, unknown>,
  Record<string, unknown>
>({
  entity: 'alert.monitor-alert-events',
  moduleName: '告警事件',
  filenamePrefix: '告警事件',
  sourcePath: '/alerts/events',
  sheetName: '告警事件',
  permissions: { export: 'alert:event:export' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => db.$count(monitorAlertEvents, buildEventListWhere(query)),
  streamRows: async (query) => {
    const where = buildEventListWhere(query);
    return batchIterable(async (limit, offset) => {
      const rows = await db
        .select({ row: monitorAlertEvents, handledByName: users.nickname })
        .from(monitorAlertEvents)
        .leftJoin(users, eq(users.id, monitorAlertEvents.handledBy))
        .where(where)
        .orderBy(desc(monitorAlertEvents.id))
        .limit(limit)
        .offset(offset);
      // 渠道是数组，导出成中文顿号分隔的一格，避免表格里出现 ["inapp","email"]
      return rows.map(({ row, handledByName }) => ({
        ...row,
        handledByName,
        notifyChannels: (row.notifyChannels ?? [])
          .map((channel) => NOTIFY_CHANNEL_LABELS[channel as keyof typeof NOTIFY_CHANNEL_LABELS] ?? channel)
          .join('、'),
      }));
    });
  },
});
