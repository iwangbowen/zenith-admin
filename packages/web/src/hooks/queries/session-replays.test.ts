import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useApiMutationMock, contract } = vi.hoisted(() => ({
  useApiMutationMock: vi.fn((..._args: unknown[]) => ({})),
  contract: {
    basePath: '/api/session-replays', list: {}, detail: {}, stats: {}, heatmapPages: {}, heatmap: {},
    accessLogs: {}, removeBatch: {}, segmentData: {},
  },
}));

vi.mock('@zenith/shared/analytics', () => ({ sessionReplayContract: contract }));
vi.mock('@zenith/shared/core', () => ({ resourceKeyOf: () => 'session-replays' }));
vi.mock('@/lib/contract-query', () => ({
  contractKey: (op: unknown) => ['contract', op],
  urlOf: () => '/unused',
  useApiMutation: (...args: unknown[]) => useApiMutationMock(...args),
  useApiQuery: vi.fn(),
}));
vi.mock('@/utils/request', () => ({ request: { getBlob: vi.fn() } }));

import { replayKeys, useBatchDeleteReplays } from './session-replays';

describe('useBatchDeleteReplays', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invalidates both the replay list and storage stats after deletion', () => {
    useBatchDeleteReplays();
    const call = useApiMutationMock.mock.calls[0] as unknown[] | undefined;
    const options = call?.[1] as { invalidate: (qc: { invalidateQueries: (input: { queryKey: readonly unknown[] }) => void }) => void };
    const invalidateQueries = vi.fn();

    options.invalidate({ invalidateQueries });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: replayKeys.lists });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: replayKeys.stats });
  });
});
