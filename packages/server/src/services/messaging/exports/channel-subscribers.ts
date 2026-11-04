import { HTTPException } from 'hono/http-exception';
import { exportChannelSubscribers } from '../channel.service';
import { asString } from '../../../lib/export-center/query-normalize';
import { defineExport } from '../../../lib/export-center/registry';
import { RETENTION_7_DAYS } from '../../../lib/export-center/presets';
import type { ExportColumn } from '../../../lib/export-center/types';

function asRequiredPositiveNumber(value: unknown, label: string): number {
  const next = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(next) || next <= 0) throw new HTTPException(400, { message: `${label}不能为空` });
  return next;
}

const columns: ExportColumn[] = [
  { key: 'userId', header: '用户ID', width: 12, type: 'number' },
  { key: 'name', header: '姓名', width: 20 },
  { key: 'subscribedAt', header: '订阅时间', width: 22 },
  { key: 'isMutedText', header: '免打扰', width: 12 },
];

export const channelSubscribersExportDefinition = defineExport({
  entity: 'channel.subscribers',
  moduleName: '频道订阅者',
  filenamePrefix: '频道订阅者',
  sourcePath: '/system/channels',
  sheetName: '频道订阅者',
  permissions: { export: 'channel:channel:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => {
    const rows = await exportChannelSubscribers(asRequiredPositiveNumber(query.channelId, '频道ID'), asString(query.keyword));
    return rows.length;
  },
  streamRows: async (query) => {
    const rows = await exportChannelSubscribers(asRequiredPositiveNumber(query.channelId, '频道ID'), asString(query.keyword));
    return rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      subscribedAt: row.subscribedAt ?? '',
      isMutedText: row.isMuted ? '是' : '否',
    }));
  },
});
