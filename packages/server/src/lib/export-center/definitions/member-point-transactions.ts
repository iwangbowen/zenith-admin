import { desc, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { memberPointTransactions, members } from '../../../db/schema';
import { buildPointTxWhere } from '../../../services/member/member-points.service';
import { batchIterable } from '../../excel-export';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';
import type { PointTxType } from '@zenith/shared';
import { POINT_TX_TYPE_LABELS } from '@zenith/shared';

const TYPE_LABELS: Record<string, string> = POINT_TX_TYPE_LABELS;

type Query = { memberKeyword?: string; type?: PointTxType };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'memberId', header: '会员ID', width: 10, type: 'number' },
  { key: 'memberName', header: '会员昵称', width: 16 },
  { key: 'type', header: '类型', width: 10, enumMap: TYPE_LABELS },
  { key: 'amount', header: '变动积分', width: 12, type: 'number' },
  { key: 'balanceAfter', header: '变动后余额', width: 12, type: 'number' },
  { key: 'bizType', header: '业务类型', width: 20 },
  { key: 'bizId', header: '业务单号', width: 24 },
  { key: 'remark', header: '备注', width: 30 },
  { key: 'createdAt', header: '发生时间', width: 22, type: 'datetime' },
];

export const memberPointTxExportDefinition = defineExport<Query & Record<string, unknown>, Record<string, unknown>>({
  entity: 'member.point-transactions',
  moduleName: '会员积分',
  filenamePrefix: '积分流水',
  sourcePath: '/member/points',
  sheetName: '积分流水',
  permissions: { export: 'member:point:list' },
  execution: { mode: 'auto' },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => db.$count(memberPointTransactions, buildPointTxWhere(query)),
  streamRows: async (query) => {
    const where = buildPointTxWhere(query);
    return batchIterable(async (limit, offset) => {
      const rows = await db.select({
        id: memberPointTransactions.id,
        memberId: memberPointTransactions.memberId,
        memberName: members.nickname,
        type: memberPointTransactions.type,
        amount: memberPointTransactions.amount,
        balanceAfter: memberPointTransactions.balanceAfter,
        bizType: memberPointTransactions.bizType,
        bizId: memberPointTransactions.bizId,
        remark: memberPointTransactions.remark,
        createdAt: memberPointTransactions.createdAt,
      })
        .from(memberPointTransactions)
        .leftJoin(members, eq(members.id, memberPointTransactions.memberId))
        .where(where)
        .orderBy(desc(memberPointTransactions.id))
        .limit(limit)
        .offset(offset);
      return rows;
    });
  },
});
