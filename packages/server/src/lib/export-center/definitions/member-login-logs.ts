import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../db';
import { memberLoginLogs, members } from '../../../db/schema';
import { buildLoginLogWhere } from '../../../services/member/admin-members.service';
import { batchIterable } from '../../excel-export';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const STATUS_LABELS: Record<string, string> = { success: '成功', fail: '失败' };

type Query = { keyword?: string; status?: 'success' | 'fail'; dateStart?: string; dateEnd?: string };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'memberNickname', header: '会员昵称', width: 16 },
  { key: 'ip', header: 'IP', width: 18 },
  { key: 'location', header: '地区', width: 18 },
  { key: 'browser', header: '浏览器', width: 16 },
  { key: 'os', header: '操作系统', width: 16 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_LABELS },
  { key: 'message', header: '消息', width: 26 },
  { key: 'createdAt', header: '登录时间', width: 22, type: 'datetime' },
];

export const memberLoginLogsExportDefinition = defineExport<Query & Record<string, unknown>, Record<string, unknown>>({
  entity: 'member.login-logs',
  moduleName: '会员登录日志',
  filenamePrefix: '会员登录日志',
  sourcePath: '/member/login-logs',
  sheetName: '会员登录日志',
  permissions: { export: 'member:loginlog:list' },
  execution: { mode: 'auto' },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => {
    const rows = await db.select({ v: sql<number>`count(*)::int` })
      .from(memberLoginLogs)
      .leftJoin(members, eq(members.id, memberLoginLogs.memberId))
      .where(buildLoginLogWhere(query));
    return rows[0]?.v ?? 0;
  },
  streamRows: async (query) => {
    const where = buildLoginLogWhere(query);
    return batchIterable(async (limit, offset) => {
      const rows = await db.select({
        id: memberLoginLogs.id,
        memberNickname: members.nickname,
        ip: memberLoginLogs.ip,
        location: memberLoginLogs.location,
        browser: memberLoginLogs.browser,
        os: memberLoginLogs.os,
        status: memberLoginLogs.status,
        message: memberLoginLogs.message,
        createdAt: memberLoginLogs.createdAt,
      })
        .from(memberLoginLogs)
        .leftJoin(members, eq(members.id, memberLoginLogs.memberId))
        .where(where)
        .orderBy(desc(memberLoginLogs.createdAt))
        .limit(limit)
        .offset(offset);
      return rows;
    });
  },
});
