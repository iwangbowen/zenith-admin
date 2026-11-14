import { paymentReportExportQuerySchema } from '@zenith/shared/payment';
import { getReportSummary } from '../payment-report.service';
import { defineExport } from '../../../lib/export-center/registry';
import type { ExportColumn } from '../../../lib/export-center/types';
const columns: ExportColumn[] = [
  { key: 'label', header: '统计维度', width: 24 },
  ...[['gross', '收款'], ['fee', '手续费'], ['refund', '退款'], ['sharing', '分账'], ['net', '净额']].map(([key, label]) => ({ key, header: label + '(元)', type: 'money' as const, width: 16 })),
  { key: 'count', header: '成功笔数', type: 'number' }, { key: 'average', header: '笔均(元)', type: 'money' },
  { key: 'refundRate', header: '退款率(%)', type: 'number' }, { key: 'grossDelta', header: '收款环比(%)', type: 'number' }, { key: 'netDelta', header: '净额环比(%)', type: 'number' },
];
export const paymentReportsExportDefinition = defineExport({
  entity: 'payment.reports', moduleName: '财务报表', filenamePrefix: '财务报表', sourcePath: '/payment/reports', permissions: { export: 'payment:report:view' }, columns,
  prepareQuery: async query => paymentReportExportQuerySchema.parse(query),
  countRows: async query => (await getReportSummary(paymentReportExportQuerySchema.parse(query))).rows.length + 1,
  streamRows: async query => {
    const summary = await getReportSummary(paymentReportExportQuerySchema.parse(query));
    const prev = new Map(summary.prev?.rows.map(r => [r.key, r]) ?? []);
    const rows = [...summary.rows, { key: 'total', label: '合计', gross: summary.totalGross, fee: summary.totalFee, refund: summary.totalRefund, sharing: summary.totalSharing, net: summary.totalNet, count: summary.totalCount }];
    return rows.map(r => {
      const old = r.key === 'total' && summary.prev ? { gross: summary.prev.totalGross, net: summary.prev.totalNet } : prev.get(r.key);
      return { ...r, average: r.count ? Math.round(r.gross / r.count) : null, refundRate: r.gross ? r.refund / r.gross * 100 : null, grossDelta: old?.gross ? (r.gross - old.gross) / old.gross * 100 : null, netDelta: old?.net ? (r.net - old.net) / old.net * 100 : null };
    });
  },
});

