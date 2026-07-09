import { desc, eq } from 'drizzle-orm';
import { db } from '../../../db';
import { memberWalletTransactions, members } from '../../../db/schema';
import { buildWalletTxWhere } from '../../../services/member/member-wallet.service';
import { batchIterable } from '../../excel-export';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';
import type { WalletTxType } from '@zenith/shared';
import { WALLET_TX_TYPE_LABELS } from '@zenith/shared';

const TYPE_LABELS: Record<string, string> = WALLET_TX_TYPE_LABELS;

type Query = { memberKeyword?: string; type?: WalletTxType };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'memberId', header: '会员ID', width: 10, type: 'number' },
  { key: 'memberName', header: '会员昵称', width: 16 },
  { key: 'type', header: '类型', width: 10, enumMap: TYPE_LABELS },
  { key: 'amount', header: '变动金额(元)', width: 14, type: 'money' },
  { key: 'balanceAfter', header: '变动后余额(元)', width: 14, type: 'money' },
  { key: 'bizType', header: '业务类型', width: 20 },
  { key: 'bizId', header: '业务单号', width: 24 },
  { key: 'remark', header: '备注', width: 30 },
  { key: 'createdAt', header: '发生时间', width: 22, type: 'datetime' },
];

export const memberWalletTxExportDefinition = defineExport<Query & Record<string, unknown>, Record<string, unknown>>({
  entity: 'member.wallet-transactions',
  moduleName: '会员钱包',
  filenamePrefix: '钱包流水',
  sourcePath: '/member/wallets',
  sheetName: '钱包流水',
  permissions: { export: 'member:wallet:list' },
  execution: { mode: 'auto' },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => db.$count(memberWalletTransactions, buildWalletTxWhere(query)),
  streamRows: async (query) => {
    const where = buildWalletTxWhere(query);
    return batchIterable(async (limit, offset) => {
      const rows = await db.select({
        id: memberWalletTransactions.id,
        memberId: memberWalletTransactions.memberId,
        memberName: members.nickname,
        type: memberWalletTransactions.type,
        amount: memberWalletTransactions.amount,
        balanceAfter: memberWalletTransactions.balanceAfter,
        bizType: memberWalletTransactions.bizType,
        bizId: memberWalletTransactions.bizId,
        remark: memberWalletTransactions.remark,
        createdAt: memberWalletTransactions.createdAt,
      })
        .from(memberWalletTransactions)
        .leftJoin(members, eq(members.id, memberWalletTransactions.memberId))
        .where(where)
        .orderBy(desc(memberWalletTransactions.id))
        .limit(limit)
        .offset(offset);
      return rows;
    });
  },
});
