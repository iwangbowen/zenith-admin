import { HTTPException } from 'hono/http-exception';
import { exportAnnouncements, exportAnnouncementsAsCsv } from '../../../services/announcements.service';
import { exportChannelSubscribers } from '../../../services/channel.service';
import { exportCronJobs, exportCronJobsAsCsv } from '../../../services/cron-jobs.service';
import { exportDepartments, exportDepartmentsAsCsv } from '../../../services/departments.service';
import { exportDicts, exportDictsAsCsv } from '../../../services/dicts.service';
import { exportEmailSendLogs, exportEmailSendLogsAsCsv } from '../../../services/email-send-logs.service';
import { exportFileStorageConfigs, exportFileStorageConfigsAsCsv } from '../../../services/file-storage-configs.service';
import { exportLoginLogs, exportLoginLogsAsCsv } from '../../../services/login-logs.service';
import { exportMembers, exportMembersAsCsv } from '../../../services/admin-members.service';
import { exportOperationLogs, exportOperationLogsAsCsv } from '../../../services/operation-logs.service';
import { exportOrders, exportOrdersCsv, exportRefunds, exportRefundsCsv } from '../../../services/payment-stats.service';
import { exportPositions, exportPositionsAsCsv } from '../../../services/positions.service';
import { exportProcesses, exportProcessesAsCsv } from '../../../services/processes.service';
import { exportRegions, exportRegionsAsCsv } from '../../../services/regions.service';
import { exportRoles, exportRolesAsCsv } from '../../../services/roles.service';
import { exportSmsSendLogs, exportSmsSendLogsAsCsv } from '../../../services/sms-send-logs.service';
import { exportSystemConfigs, exportSystemConfigsAsCsv } from '../../../services/system-configs.service';
import { exportTenants, exportTenantsAsCsv } from '../../../services/tenants.service';
import { exportToExcel, streamToCsv, type ExcelColumn } from '../../excel-export';
import { formatFileTimestamp, parseDateRangeEnd, parseDateRangeStart } from '../../datetime';
import { listEventsForExport, type EventListQuery } from '../../../services/analytics.service';
import { exportInstances } from '../../../services/workflow-analytics.service';
import { defineExport } from '../registry';
import type { AnyExportDefinition, ExportFormat, ExportRuntimeContext } from '../types';

interface LegacyFileResult {
  stream: ReadableStream<Uint8Array> | ReadableStream;
  filename: string;
}

type LegacyExporter = (query: Record<string, unknown>) => Promise<LegacyFileResult>;

const GENERIC_COLUMNS = [{ key: 'file', header: '文件' }];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';

const analyticsColumns: ExcelColumn[] = [
  { header: 'ID', key: 'id', width: 10 },
  { header: '用户', key: 'username', width: 16 },
  { header: '事件类型', key: 'eventType', width: 14 },
  { header: '事件名', key: 'eventName', width: 18 },
  { header: '页面', key: 'pagePath', width: 28 },
  { header: '标题', key: 'pageTitle', width: 20 },
  { header: '功能', key: 'elementLabel', width: 16 },
  { header: '区域', key: 'componentArea', width: 14 },
  { header: '时长(ms)', key: 'durationMs', width: 12 },
  { header: '浏览器', key: 'browser', width: 14 },
  { header: '系统', key: 'os', width: 14 },
  { header: '设备', key: 'deviceType', width: 10 },
  { header: '地域', key: 'region', width: 14 },
  { header: '时间', key: 'createdAt', width: 20 },
];

function asRecord(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : undefined;
}

function asRequiredPositiveNumber(value: unknown, label: string): number {
  const next = asPositiveNumber(value);
  if (!next) throw new HTTPException(400, { message: `${label}不能为空` });
  return next;
}

function asDate(value: unknown, boundary: 'start' | 'end'): Date | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  return boundary === 'start' ? parseDateRangeStart(raw) ?? undefined : parseDateRangeEnd(raw) ?? undefined;
}

function mapChannelSubscriberRow(
  row: Awaited<ReturnType<typeof exportChannelSubscribers>>[number],
): Record<string, unknown> {
  return {
    userId: row.userId,
    name: row.name,
    subscribedAt: row.subscribedAt ?? '',
    isMutedText: row.isMuted ? '是' : '否',
  };
}

async function streamToBuffer(stream: ReadableStream<Uint8Array> | ReadableStream): Promise<Buffer> {
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function defineLegacyExport(config: {
  entity: string;
  moduleName: string;
  filenamePrefix: string;
  permission: string;
  sourcePath: string;
  xlsx: LegacyExporter;
  csv: LegacyExporter;
}): AnyExportDefinition {
  return defineExport<Record<string, unknown>, Record<string, unknown>>({
    entity: config.entity,
    moduleName: config.moduleName,
    filenamePrefix: config.filenamePrefix,
    sourcePath: config.sourcePath,
    formats: ['xlsx', 'csv'],
    permissions: { export: config.permission },
    execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
    retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
    columns: GENERIC_COLUMNS,
    countRows: async () => 0,
    streamRows: async function* () {
      return;
    },
    renderFile: async (ctx) => {
      const result = ctx.format === 'csv' ? await config.csv(ctx.query) : await config.xlsx(ctx.query);
      return {
        buffer: await streamToBuffer(result.stream),
        filename: result.filename,
        mimeType: ctx.format === 'csv' ? CSV_MIME : XLSX_MIME,
      };
    },
  }) as AnyExportDefinition;
}

async function renderPaymentStream(
  ctx: ExportRuntimeContext<Record<string, unknown>>,
  xlsx: (query: Record<string, unknown>) => Promise<ReadableStream>,
  csv: (query: Record<string, unknown>) => Promise<ReadableStream>,
  filenamePrefix: string,
) {
  const stream = ctx.format === 'csv' ? await csv(asRecord(ctx.query)) : await xlsx(asRecord(ctx.query));
  return {
    buffer: await streamToBuffer(stream),
    filename: `${filenamePrefix}_${formatFileTimestamp()}.${ctx.format}`,
    mimeType: ctx.format === 'csv' ? CSV_MIME : XLSX_MIME,
  };
}

async function exportAnalyticsEvents(query: Record<string, unknown>, format: ExportFormat): Promise<LegacyFileResult> {
  const q: EventListQuery = {
    eventType: asString(query.eventType) as EventListQuery['eventType'],
    eventName: asString(query.eventName),
    username: asString(query.username),
    pagePath: asString(query.pagePath),
    deviceType: asString(query.deviceType),
    startTime: asDate(query.startTime, 'start'),
    endTime: asDate(query.endTime, 'end'),
  };
  const rows = await listEventsForExport(q);
  if (format === 'csv') {
    return { stream: streamToCsv(analyticsColumns, rows), filename: `events_${formatFileTimestamp()}.csv` };
  }
  const buffer = await exportToExcel(analyticsColumns, rows, '埋点事件');
  return {
    stream: new Blob([buffer]).stream(),
    filename: `events_${formatFileTimestamp()}.xlsx`,
  };
}

export const legacyExportDefinitions: AnyExportDefinition[] = [
  defineLegacyExport({
    entity: 'system.departments',
    moduleName: '部门管理',
    filenamePrefix: '部门列表',
    permission: 'system:department:list',
    sourcePath: '/system/departments',
    xlsx: async () => exportDepartments(),
    csv: async () => exportDepartmentsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.positions',
    moduleName: '岗位管理',
    filenamePrefix: '岗位列表',
    permission: 'system:position:list',
    sourcePath: '/system/positions',
    xlsx: async () => exportPositions(),
    csv: async () => exportPositionsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.roles',
    moduleName: '角色管理',
    filenamePrefix: '角色列表',
    permission: 'system:role:list',
    sourcePath: '/system/roles',
    xlsx: async () => exportRoles(),
    csv: async () => exportRolesAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.dicts',
    moduleName: '字典管理',
    filenamePrefix: '字典列表',
    permission: 'system:dict:list',
    sourcePath: '/system/dicts',
    xlsx: async () => exportDicts(),
    csv: async () => exportDictsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.tenants',
    moduleName: '租户管理',
    filenamePrefix: '租户列表',
    permission: 'system:tenant:list',
    sourcePath: '/system/tenants',
    xlsx: async () => exportTenants(),
    csv: async () => exportTenantsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.regions',
    moduleName: '地区管理',
    filenamePrefix: '地区列表',
    permission: 'system:region:export',
    sourcePath: '/system/regions',
    xlsx: async () => exportRegions(),
    csv: async () => exportRegionsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.configs',
    moduleName: '系统配置',
    filenamePrefix: '系统配置',
    permission: 'system:config:list',
    sourcePath: '/system/configs',
    xlsx: async () => exportSystemConfigs(),
    csv: async () => exportSystemConfigsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.file-storage-configs',
    moduleName: '文件配置',
    filenamePrefix: '文件存储配置',
    permission: 'system:file:config',
    sourcePath: '/system/file-configs',
    xlsx: async () => exportFileStorageConfigs(),
    csv: async () => exportFileStorageConfigsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.cron-jobs',
    moduleName: '定时任务',
    filenamePrefix: '定时任务',
    permission: 'system:cronjob:list',
    sourcePath: '/system/cron-jobs',
    xlsx: async () => exportCronJobs(),
    csv: async () => exportCronJobsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.processes',
    moduleName: '进程管理',
    filenamePrefix: '进程列表',
    permission: 'system:process:view',
    sourcePath: '/system/processes',
    xlsx: async () => exportProcesses(),
    csv: async () => exportProcessesAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.login-logs',
    moduleName: '登录日志',
    filenamePrefix: '登录日志',
    permission: 'system:log:login',
    sourcePath: '/system/login-logs',
    xlsx: async () => exportLoginLogs(),
    csv: async () => exportLoginLogsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.operation-logs',
    moduleName: '操作日志',
    filenamePrefix: '操作日志',
    permission: 'system:log:operation',
    sourcePath: '/system/operation-logs',
    xlsx: async (query) => exportOperationLogs(asRecord(query) as Parameters<typeof exportOperationLogs>[0]),
    csv: async (query) => exportOperationLogsAsCsv(asRecord(query) as Parameters<typeof exportOperationLogsAsCsv>[0]),
  }),
  defineLegacyExport({
    entity: 'system.announcements',
    moduleName: '公告管理',
    filenamePrefix: '公告列表',
    permission: 'system:announcement:list',
    sourcePath: '/system/announcements',
    xlsx: async () => exportAnnouncements(),
    csv: async () => exportAnnouncementsAsCsv(),
  }),
  defineLegacyExport({
    entity: 'system.email-send-logs',
    moduleName: '邮件发送记录',
    filenamePrefix: '邮件发送记录',
    permission: 'system:email-send-log:export',
    sourcePath: '/system/email-send-logs',
    xlsx: async (query) => exportEmailSendLogs(asRecord(query) as Parameters<typeof exportEmailSendLogs>[0]),
    csv: async (query) => exportEmailSendLogsAsCsv(asRecord(query) as Parameters<typeof exportEmailSendLogsAsCsv>[0]),
  }),
  defineLegacyExport({
    entity: 'system.sms-send-logs',
    moduleName: '短信发送记录',
    filenamePrefix: '短信发送记录',
    permission: 'system:sms-send-log:export',
    sourcePath: '/system/sms-send-logs',
    xlsx: async (query) => exportSmsSendLogs(asRecord(query) as Parameters<typeof exportSmsSendLogs>[0]),
    csv: async (query) => exportSmsSendLogsAsCsv(asRecord(query) as Parameters<typeof exportSmsSendLogsAsCsv>[0]),
  }),
  defineLegacyExport({
    entity: 'member.members',
    moduleName: '会员管理',
    filenamePrefix: '会员列表',
    permission: 'member:member:list',
    sourcePath: '/member/members',
    xlsx: async (query) => exportMembers({
      keyword: asString(query.keyword),
      status: query.status === 'active' || query.status === 'inactive' || query.status === 'banned' ? query.status : undefined,
      levelId: asPositiveNumber(query.levelId),
    }),
    csv: async (query) => exportMembersAsCsv({
      keyword: asString(query.keyword),
      status: query.status === 'active' || query.status === 'inactive' || query.status === 'banned' ? query.status : undefined,
      levelId: asPositiveNumber(query.levelId),
    }),
  }),
  defineExport<Record<string, unknown>, Record<string, unknown>>({
    entity: 'channel.subscribers',
    moduleName: '频道订阅者',
    filenamePrefix: '频道订阅者',
    sourcePath: '/system/channels',
    formats: ['xlsx', 'csv'],
    permissions: { export: 'channel:channel:list' },
    execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
    retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
    columns: [
      { key: 'userId', header: '用户ID', width: 12, type: 'number' },
      { key: 'name', header: '姓名', width: 20 },
      { key: 'subscribedAt', header: '订阅时间', width: 22 },
      { key: 'isMutedText', header: '免打扰', width: 12 },
    ],
    countRows: async (query) => {
      const rows = await exportChannelSubscribers(
        asRequiredPositiveNumber(query.channelId, '频道ID'),
        asString(query.keyword),
      );
      return rows.length;
    },
    streamRows: async function* (query) {
      const rows = await exportChannelSubscribers(
        asRequiredPositiveNumber(query.channelId, '频道ID'),
        asString(query.keyword),
      );
      for (const row of rows) yield mapChannelSubscriberRow(row);
    },
  }) as AnyExportDefinition,
  defineLegacyExport({
    entity: 'analytics.events',
    moduleName: '行为分析数据',
    filenamePrefix: '埋点事件',
    permission: 'analytics:export',
    sourcePath: '/analytics/data',
    xlsx: async (query) => exportAnalyticsEvents(query, 'xlsx'),
    csv: async (query) => exportAnalyticsEvents(query, 'csv'),
  }),
  defineExport<Record<string, unknown>, Record<string, unknown>>({
    entity: 'payment.orders',
    moduleName: '支付订单',
    filenamePrefix: '支付订单',
    sourcePath: '/payment/orders',
    formats: ['xlsx', 'csv'],
    permissions: { export: 'payment:order:list' },
    execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
    retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
    columns: GENERIC_COLUMNS,
    countRows: async () => 0,
    streamRows: async function* () {
      return;
    },
    renderFile: async (ctx) => renderPaymentStream(
      ctx,
      (query) => exportOrders(query as Parameters<typeof exportOrders>[0]),
      (query) => exportOrdersCsv(query as Parameters<typeof exportOrdersCsv>[0]),
      '支付订单',
    ),
  }) as AnyExportDefinition,
  defineExport<Record<string, unknown>, Record<string, unknown>>({
    entity: 'payment.refunds',
    moduleName: '退款记录',
    filenamePrefix: '退款记录',
    sourcePath: '/payment/refunds',
    formats: ['xlsx', 'csv'],
    permissions: { export: 'payment:refund:list' },
    execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
    retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
    columns: GENERIC_COLUMNS,
    countRows: async () => 0,
    streamRows: async function* () {
      return;
    },
    renderFile: async (ctx) => renderPaymentStream(
      ctx,
      (query) => exportRefunds(query as Parameters<typeof exportRefunds>[0]),
      (query) => exportRefundsCsv(query as Parameters<typeof exportRefundsCsv>[0]),
      '退款记录',
    ),
  }) as AnyExportDefinition,
  defineExport<Record<string, unknown>, Record<string, unknown>>({
    entity: 'workflow.instances',
    moduleName: '流程实例',
    filenamePrefix: '流程实例',
    sourcePath: '/workflow/monitor',
    formats: ['xlsx'],
    permissions: { export: 'workflow:instance:monitor' },
    execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
    retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
    columns: GENERIC_COLUMNS,
    countRows: async () => 0,
    streamRows: async function* () {
      return;
    },
    renderFile: async (ctx) => {
      const result = await exportInstances({
        status: asString(ctx.query.status),
        keyword: asString(ctx.query.keyword),
        categoryId: asPositiveNumber(ctx.query.categoryId),
        initiatorKeyword: asString(ctx.query.initiatorKeyword),
      });
      return {
        buffer: await streamToBuffer(result.stream),
        filename: result.filename,
        mimeType: XLSX_MIME,
      };
    },
  }) as AnyExportDefinition,
];
