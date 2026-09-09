import { listEventsForExport, countEventsForExport, type EventListFilter } from '../../../services/analytics/analytics.service';
import { parseDateRangeEnd, parseDateRangeStart } from '../../datetime';
import { asString } from '../query-normalize';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

function normalizeQuery(query: Record<string, unknown>): EventListFilter {
  return {
    eventType: asString(query.eventType) as EventListFilter['eventType'],
    eventName: asString(query.eventName),
    username: asString(query.username),
    pagePath: asString(query.pagePath),
    deviceType: asString(query.deviceType) as EventListFilter['deviceType'],
    startTime: parseDateRangeStart(asString(query.startTime)) ?? undefined,
    endTime: parseDateRangeEnd(asString(query.endTime)) ?? undefined,
  };
}

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'username', header: '用户', width: 16 },
  { key: 'eventType', header: '事件类型', width: 14 },
  { key: 'eventName', header: '事件名', width: 18 },
  { key: 'pagePath', header: '页面', width: 28 },
  { key: 'pageTitle', header: '标题', width: 20 },
  { key: 'elementLabel', header: '功能', width: 16 },
  { key: 'componentArea', header: '区域', width: 14 },
  { key: 'durationMs', header: '时长(ms)', width: 12 },
  { key: 'browser', header: '浏览器', width: 14 },
  { key: 'os', header: '系统', width: 14 },
  { key: 'deviceType', header: '设备', width: 10 },
  { key: 'region', header: '地域', width: 14 },
  { key: 'createdAt', header: '时间', width: 20 },
  { key: 'memberId', header: '会员ID', width: 10 },
  { key: 'source', header: '来源', width: 12 },
  { key: 'appId', header: '应用', width: 12 },
  { key: 'environment', header: '环境', width: 12 },
];

export const analyticsEventsExportDefinition = defineExport({
  entity: 'analytics.events',
  moduleName: '行为分析数据',
  filenamePrefix: '埋点事件',
  sourcePath: '/analytics/data',
  sheetName: '埋点事件',
  permissions: { export: 'analytics:export' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => countEventsForExport(normalizeQuery(query)),
  streamRows: async (query) => listEventsForExport(normalizeQuery(query)),
});
