import { describe, expect, it, vi } from 'vitest';
import type { NewIpAccessLog } from '../../db/schema';
const state = vi.hoisted(() => ({ values: vi.fn(async (_entries: NewIpAccessLog[]) => undefined) }));
vi.mock('../../db', () => ({ db: { insert: () => ({ values: state.values }) } }));
import { flushIpAccessLogs, ipAccessLogStats, writeIpAccessLog } from './ip-access-logs.service';
describe('IP access log bounded persistence', () => {
  it('buffers a burst, retains safe decision metadata and caps queue size', async () => {
    for (let i = 0; i < 2500; i++) writeIpAccessLog({ ip: '192.0.2.1', path: '/api/users/{id}', method: 'GET', blockType: 'blacklist', matchedEntry: '192.0.2.0/24', policyVersion: 4, correlationId: 'request-1' });
    expect(state.values).not.toHaveBeenCalled();
    expect(ipAccessLogStats()).toMatchObject({ pending: 2000, dropped: 500 });
    await flushIpAccessLogs();
    expect(state.values).toHaveBeenCalledTimes(20);
    expect(state.values.mock.calls[0][0][0]).toMatchObject({ matchedEntry: '192.0.2.0/24', policyVersion: 4, correlationId: 'request-1' });
    expect(ipAccessLogStats()).toMatchObject({ stored: 2000, pending: 0 });
  });
});
