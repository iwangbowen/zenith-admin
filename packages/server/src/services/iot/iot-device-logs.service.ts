import { iotDeviceContract } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT 设备日志通道：设备上报运行日志（追加型，保留策略裁剪）。
 */
import { desc, eq, gte, lte } from 'drizzle-orm';
import type { IotLogIngestInput } from '@zenith/shared/iot';
import { db } from '../../db';
import { iotDeviceLogs, type IotDeviceLogRow, type IotDeviceRow } from '../../db/schema';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';

export function mapIotDeviceLog(row: IotDeviceLogRow) {
  return {
    id: row.id,
    deviceId: row.deviceId,
    level: row.level,
    tag: row.tag ?? null,
    content: row.content,
    reportedAt: formatDateTime(row.reportedAt),
  };
}

/** 设备侧批量上报（HTTP ingest 与 WS log 帧共用） */
export async function ingestIotDeviceLogs(device: IotDeviceRow, input: IotLogIngestInput): Promise<number> {
  const rows = input.items.map((item) => ({
    deviceId: device.id,
    level: item.level,
    tag: item.tag ?? null,
    content: item.content,
    reportedAt: (item.reportedAt ? parseDateTimeInput(item.reportedAt) : null) ?? new Date(),
  }));
  if (rows.length > 0) await db.insert(iotDeviceLogs).values(rows);
  return rows.length;
}

export type ListDeviceLogsFilter = Omit<QueryOutputOf<typeof iotDeviceContract.logs>, 'page' | 'pageSize'>;
export type ListDeviceLogsQuery = QueryOutputOf<typeof iotDeviceContract.logs>;

export async function listIotDeviceLogs(deviceId: number, q: ListDeviceLogsQuery) {
  const { page, pageSize } = q;
  const start = q.startTime ? parseDateTimeInput(q.startTime) : null;
  const end = q.endTime ? parseDateTimeInput(q.endTime) : null;
  const where = buildWhere(
    eq(iotDeviceLogs.deviceId, deviceId),
    q.level ? eq(iotDeviceLogs.level, q.level) : undefined,
    keywordCondition(q.keyword, [iotDeviceLogs.content], 'ilike'),
    start ? gte(iotDeviceLogs.reportedAt, start) : undefined,
    end ? lte(iotDeviceLogs.reportedAt, end) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotDeviceLogs, where),
    rows: () => withPagination(
      db.select().from(iotDeviceLogs).where(where).orderBy(desc(iotDeviceLogs.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: mapIotDeviceLog,
  });
}
