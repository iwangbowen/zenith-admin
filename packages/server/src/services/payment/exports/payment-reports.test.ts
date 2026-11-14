import { expect, it, vi } from 'vitest';
const summary = { rows: [{ key: 'day', label: '当天', gross: 1000, fee: 20, refund: 100, sharing: 50, net: 830, count: 2 }], totalGross: 1000, totalFee: 20, totalRefund: 100, totalSharing: 50, totalNet: 830, totalCount: 2, prev: null };
const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../payment-report.service', () => ({ getReportSummary: state.get }));
import { paymentReportsExportDefinition as definition } from './payment-reports';
import type { ExportRuntimeContext } from '../../../lib/export-center/types';
const user = { userId: 1, username: 'admin', tenantId: null, roles: ['super_admin'] };
it.each([true, false])('accepts JSON compare=%s and remains valid when prepared again', async compare => {
  state.get.mockResolvedValue(summary);
  const query = await definition.prepareQuery!({ groupBy: 'day', compare }, user);
  expect(query.compare).toBe(compare);
  expect(await definition.prepareQuery!(query, user)).toEqual(query);
  expect(await definition.countRows(query, user)).toBe(2);
  const rows = await definition.streamRows(query, user, {} as ExportRuntimeContext) as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ gross: 1000, average: 500, refundRate: 10 });
  expect(rows[1]).toMatchObject({ key: 'total', label: '合计', net: 830 });
});
