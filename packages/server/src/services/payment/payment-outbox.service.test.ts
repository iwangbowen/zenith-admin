import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ publish: vi.fn(), retry: vi.fn() }));
vi.mock('../../lib/domain-events', () => ({ publishEventInTx: mocks.publish, retryEventConsumer: mocks.retry }));
import { processEvent, dispatchPendingPaymentEvents } from './payment-outbox.service';

describe('payment event handoff', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.retry.mockResolvedValue(true); });
  it('does not synchronously execute business subscribers when a legacy caller asks to process an id', async () => {
    await expect(processEvent(42)).resolves.toBeUndefined();
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it('leaves recovery to the domain-event ledger worker', async () => {
    await expect(dispatchPendingPaymentEvents()).resolves.toBe(0);
  });
});
