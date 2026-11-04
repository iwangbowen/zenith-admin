import { db } from '../../../db/index';
import { memberCheckins } from '../../../db/schema';
import { buildCheckinWhere, selectCheckinRows } from '../member-checkin.service';
import { batchIterable } from '../../../lib/excel-export';
import { defineExport } from '../../../lib/export-center/registry';
import { RETENTION_7_DAYS } from '../../../lib/export-center/presets';
import type { ExportColumn } from '../../../lib/export-center/types';

type Query = { memberKeyword?: string; dateStart?: string; dateEnd?: string };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'memberId', header: '会员ID', width: 10, type: 'number' },
  { key: 'memberNickname', header: '会员昵称', width: 16 },
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
    // 列集、关联与排序与管理端列表同源（selectCheckinRows），导出与页面看到的是同一份数据
    const where = buildCheckinWhere(query);
    return batchIterable((limit, offset) => selectCheckinRows(where).limit(limit).offset(offset));
  },
});
