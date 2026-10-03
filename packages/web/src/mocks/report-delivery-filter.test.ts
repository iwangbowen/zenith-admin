import { describe, expect, it } from 'vitest';
import { reportDeliveryRunContract, type ReportDeliveryRun } from '@zenith/shared/report';
import { reportHandlers } from './handlers/report';

async function list(status?: string): Promise<ReportDeliveryRun[]> {
  const request = new Request(new URL(`${reportDeliveryRunContract.list.fullPath}${status ? `?status=${status}` : ''}`, window.location.origin));
  for (const handler of reportHandlers) {
    const result = await (handler as unknown as { run: (args: unknown) => Promise<{ response?: Response } | null> }).run({ request, requestId: 'delivery-filter-test' });
    if (result?.response) return (await result.response.json() as { data: { list: ReportDeliveryRun[] } }).data.list;
  }
  throw new Error('No delivery-run mock matched');
}

describe('report delivery run status in Demo', () => {
  it('returns only the requested status instead of all delivery history', async () => {
    const all = await list();
    expect(all.length).toBeGreaterThan(0);
    const status = all[0].status;
    expect((await list(status)).every((run) => run.status === status)).toBe(true);
    expect(await list('failed')).toHaveLength(0);
  });
});
