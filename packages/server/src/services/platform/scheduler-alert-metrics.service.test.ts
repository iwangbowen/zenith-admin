import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ workers: vi.fn(), backlog: vi.fn() }));
vi.mock('../../lib/pg-boss-scheduler', () => ({
  countActiveWorkerNodes: mocks.workers,
  getQueueBacklog: mocks.backlog,
}));

import { getSchedulerAlertMetrics } from './scheduler-alert-metrics.service';

beforeEach(() => vi.clearAllMocks());

describe('scheduler alert metrics availability', () => {
  it('preserves zero as a real reading', async () => {
    mocks.workers.mockResolvedValue(0);
    mocks.backlog.mockResolvedValue(0);
    await expect(getSchedulerAlertMetrics()).resolves.toEqual({ schedulerWorkerNodes: 0, schedulerQueueBacklog: 0 });
  });

  it('returns null when worker or queue source is unavailable', async () => {
    mocks.workers.mockRejectedValue(new Error('database offline'));
    mocks.backlog.mockResolvedValue(null);
    await expect(getSchedulerAlertMetrics()).resolves.toEqual({ schedulerWorkerNodes: null, schedulerQueueBacklog: null });
  });
});
