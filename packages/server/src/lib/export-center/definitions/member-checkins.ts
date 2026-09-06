import { desc, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { memberCheckins, members } from '../../../db/schema';
import { buildCheckinWhere } from '../../../services/member/member-checkin.service';
import { batchIterable } from '../../excel-export';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

type Query = { memberKeyword?: string; dateStart?: string; dateEnd?: string };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'memberId', header: '会员ID', width: 10, type: 'number' },
  { key: 'memberName', header: '会员昵称', width: 16 },
  { key: 'checkinDate', header: '签到日期', width: 14 },
  { key: 'consecutiveDays', header: '连续天数', width: 10, type: 'number' },
  { key: 'pointsAwarded', header: '积分奖励', width: 10, type: 'number' },
  { key: 'experienceAwarded', header: '经验奖励', width: 10, type: 'number' },
  { key: 'isMakeup', header: '类型', width: 10, transform: (v) => (v ? '补签' : '正常') },
  { key: 'remark', header: '备注', width: 30 },
  { key: 'createdAt', header: '签到时间', width: 22, type: 'datetime' },
];

export const memberCheckinsExportDefinition = defineExport<Query & Record<string, unknown>, Record<string, unknown>>({
  entity: 'member.checkins',
  moduleName: '会员签到',
  filenamePrefix: '签到记录',
  sourcePath: '/member/checkin-logs',
  sheetName: '签到记录',
  permissions: { export: 'member:checkin:log:list' },
  execution: { mode: 'auto' },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => db.$count(memberCheckins, buildCheckinWhere(query)),
  streamRows: async (query) => {
    const where = buildCheckinWhere(query);
    return batchIterable(async (limit, offset) => {
      const rows = await db.select({
        id: memberCheckins.id,
        memberId: memberCheckins.memberId,
        memberName: members.nickname,
        checkinDate: memberCheckins.checkinDate,
        consecutiveDays: memberCheckins.consecutiveDays,
        pointsAwarded: memberCheckins.pointsAwarded,
        experienceAwarded: memberCheckins.experienceAwarded,
        isMakeup: memberCheckins.isMakeup,
        remark: memberCheckins.remark,
        createdAt: memberCheckins.createdAt,
      })
        .from(memberCheckins)
        .leftJoin(members, eq(members.id, memberCheckins.memberId))
        .where(where)
        .orderBy(desc(memberCheckins.createdAt))
        .limit(limit)
        .offset(offset);
      return rows;
    });
  },
});
