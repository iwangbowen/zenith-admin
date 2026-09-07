import type { DriveShareAccessLog } from '@zenith/shared/drive';
import { listShareAccessLogsForAdmin, type ListShareAccessLogsQuery } from '../../../services/drive/drive-share.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

interface ShareAccessLogExportRow extends Record<string, unknown> {
  id: number;
  createdAt: string;
  shareId: number;
  nodeName: string;
  spaceName: string;
  action: string;
  ok: string;
  clientIp: string;
}

const ACTION_LABELS: Record<string, string> = {
  access: '进入 / 校验', list: '浏览目录', preview: '预览', download: '下载', save: '转存', upload: '收集上传',
};

const columns: ExportColumn<ShareAccessLogExportRow>[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'createdAt', header: '时间', width: 22, type: 'datetime' },
  { key: 'shareId', header: '外链 ID', width: 10, type: 'number' },
  { key: 'nodeName', header: '对象', width: 40 },
  { key: 'spaceName', header: '空间', width: 24 },
  { key: 'action', header: '动作', width: 14, enumMap: ACTION_LABELS },
  { key: 'ok', header: '结果', width: 10 },
  { key: 'clientIp', header: 'IP', width: 18 },
];

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** 导出中心传入的 query 与治理页筛选同名：按管理端列表同一套过滤（含数据权限收窄） */
function normalizeQuery(query: Record<string, unknown>): ListShareAccessLogsQuery {
  return {
    shareId: asPositiveInt(query.shareId),
    spaceId: asPositiveInt(query.spaceId),
    action: asString(query.action),
    ok: asBool(query.ok),
    startTime: asString(query.startTime),
    endTime: asString(query.endTime),
  };
}

function toRow(item: DriveShareAccessLog): ShareAccessLogExportRow {
  return {
    id: item.id,
    createdAt: item.createdAt,
    shareId: item.shareId,
    nodeName: item.nodeName ?? `#${item.nodeId}`,
    spaceName: item.spaceName ?? '',
    action: item.action,
    ok: item.ok ? '通过' : '拒绝',
    clientIp: item.clientIp ?? '',
  };
}

const PAGE_SIZE = 500;

export const driveShareAccessLogsExportDefinition = defineExport<Record<string, unknown>, ShareAccessLogExportRow>({
  entity: 'drive.share_access_logs',
  moduleName: '网盘外链访问日志',
  filenamePrefix: '网盘外链访问日志',
  sourcePath: '/drive/admin/governance',
  sheetName: '外链访问日志',
  permissions: { export: 'drive:admin:link:export' },
  execution: { mode: 'auto', syncMaxRows: 5000 },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => (await listShareAccessLogsForAdmin({ ...normalizeQuery(query), page: 1, pageSize: 1 })).total,
  streamRows: (query) => {
    const q = normalizeQuery(query);
    return (async function* () {
      for (let page = 1; ; page++) {
        const { list } = await listShareAccessLogsForAdmin({ ...q, page, pageSize: PAGE_SIZE });
        for (const item of list) yield toRow(item);
        if (list.length < PAGE_SIZE) return;
      }
    })();
  },
});
