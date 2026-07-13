import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { paymentContracts } from '../../../db/schema';
import { buildContractsWhere, type ListContractsQuery } from '../../../services/payment/payment-contract.service';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CONTRACT_STATUS_LABELS } from '@zenith/shared';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

const EXPORT_LIMIT = 50000;

const columns: ExportColumn[] = [
  { key: 'contractNo', header: '协议号', width: 22 },
  { key: 'channel', header: '渠道', width: 10, enumMap: PAYMENT_CHANNEL_LABELS },
  { key: 'signerAccount', header: '签约账号', width: 20 },
  { key: 'signerName', header: '签约人', width: 14 },
  { key: 'status', header: '状态', width: 10, enumMap: PAYMENT_CONTRACT_STATUS_LABELS },
  { key: 'bizType', header: '业务类型', width: 14 },
  { key: 'bizId', header: '业务ID', width: 14 },
  { key: 'totalDeductCount', header: '累计扣款期数', width: 12 },
  { key: 'failCount', header: '连续失败次数', width: 12 },
  { key: 'nextDeductAt', header: '下次扣款时间', width: 20, type: 'datetime' },
  { key: 'lastDeductAt', header: '上次扣款时间', width: 20, type: 'datetime' },
  { key: 'signedAt', header: '签约时间', width: 20, type: 'datetime' },
  { key: 'createdAt', header: '创建时间', width: 20, type: 'datetime' },
];

export const paymentContractsExportDefinition = defineExport<ListContractsQuery & Record<string, unknown>, Record<string, unknown>>({
  entity: 'payment.contracts',
  moduleName: '签约代扣',
  filenamePrefix: '签约协议',
  sourcePath: '/payment/contracts',
  sheetName: '签约协议',
  permissions: { export: 'payment:contract:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => Math.min(await db.$count(paymentContracts, await buildContractsWhere(query)), EXPORT_LIMIT),
  streamRows: async (query) =>
    db.select().from(paymentContracts).where(await buildContractsWhere(query)).orderBy(desc(paymentContracts.id)).limit(EXPORT_LIMIT),
});
