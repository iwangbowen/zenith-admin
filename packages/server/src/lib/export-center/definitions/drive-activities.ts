import { DRIVE_ACTIVITY_ACTION_LABELS, DRIVE_ACTIVITY_ACTIONS, type DriveActivity, type DriveActivityAction } from '@zenith/shared/drive';
import { listDriveActivitiesForAdmin, type ListDriveActivitiesQuery } from '../../../services/drive/drive-activity.service';
import { asPositiveInt, asString } from '../query-normalize';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

interface DriveActivityExportRow extends Record<string, unknown> {
  id: number;
  createdAt: string;
  actorName: string;
  action: DriveActivityAction;
  nodeName: string;
  nodeType: string;
  spaceName: string;
  detail: string;
  clientIp: string;
}

const NODE_TYPE_LABELS: Record<string, string> = { file: '文件', folder: '文件夹' };

/** 与动态审计页「详情」列同一口径的摘要（大小 / 版本 / 来源→目标 / 经外链 / 打包） */
function describeDetail(detail: Record<string, unknown> | null): string {
  if (!detail) return '';
  const parts: string[] = [];
  if (typeof detail.size === 'number') parts.push(`${detail.size} B`);
  if (typeof detail.version === 'number') parts.push(`v${detail.version}`);
  if (typeof detail.from === 'string' && typeof detail.to === 'string') parts.push(`${detail.from} → ${detail.to}`);
  if (detail.viaShare) parts.push('经外链');
  if (detail.batch) parts.push('打包');
  return parts.join(' · ');
}

const columns: ExportColumn<DriveActivityExportRow>[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'createdAt', header: '时间', width: 22, type: 'datetime' },
  { key: 'actorName', header: '操作人', width: 16 },
  { key: 'action', header: '动作', width: 14, enumMap: DRIVE_ACTIVITY_ACTION_LABELS },
  { key: 'nodeName', header: '对象', width: 40 },
  { key: 'nodeType', header: '类型', width: 10, enumMap: NODE_TYPE_LABELS },
  { key: 'spaceName', header: '空间', width: 24 },
  { key: 'detail', header: '详情', width: 32 },
  { key: 'clientIp', header: 'IP', width: 18 },
];

/** 导出中心传入的 query 与页面筛选同名：按管理端列表同一套过滤（含数据权限收窄） */
function normalizeQuery(query: Record<string, unknown>): ListDriveActivitiesQuery {
  const action = asString(query.action);
  return {
    keyword: asString(query.keyword),
    spaceId: asPositiveInt(query.spaceId),
    actorId: asPositiveInt(query.actorId),
    action: action && (DRIVE_ACTIVITY_ACTIONS as readonly string[]).includes(action) ? (action as DriveActivityAction) : undefined,
    startTime: asString(query.startTime),
    endTime: asString(query.endTime),
  };
}

function toRow(item: DriveActivity): DriveActivityExportRow {
  return {
    id: item.id,
    createdAt: item.createdAt,
    actorName: item.actorName ?? (item.shareId ? '外链访客' : ''),
    action: item.action,
    nodeName: item.nodeName,
    nodeType: item.nodeType,
    spaceName: item.spaceName ?? '',
    detail: describeDetail(item.detail),
    clientIp: item.clientIp ?? '',
  };
}

const PAGE_SIZE = 500;

export const driveActivitiesExportDefinition = defineExport<Record<string, unknown>, DriveActivityExportRow>({
  entity: 'drive.activities',
  moduleName: '网盘动态审计',
  filenamePrefix: '网盘动态审计',
  sourcePath: '/drive/admin/activities',
  sheetName: '动态审计',
  permissions: { export: 'drive:admin:activity:export' },
  execution: { mode: 'auto', syncMaxRows: 5000 },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => (await listDriveActivitiesForAdmin({ ...normalizeQuery(query), page: 1, pageSize: 1 })).total,
  streamRows: (query) => {
    const q = normalizeQuery(query);
    return (async function* () {
      for (let page = 1; ; page++) {
        const { list } = await listDriveActivitiesForAdmin({ ...q, page, pageSize: PAGE_SIZE });
        for (const item of list) yield toRow(item);
        if (list.length < PAGE_SIZE) return;
      }
    })();
  },
});
