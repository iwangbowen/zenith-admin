import { describe, expect, it } from 'vitest';
import { operationLogCleanQuery } from '../platform/contracts/operation-logs';
import { cronJobClearLogsQuery } from '../platform/contracts/cron-jobs';
import { loginLogCleanQuery } from '../identity/contracts/login-logs';

describe.each([['operation', operationLogCleanQuery], ['login', loginLogCleanQuery], ['cron', cronJobClearLogsQuery]] as const)('%s log cleanup query', (_name, schema) => {
  it('defaults to retention cleanup and accepts only explicit zero for all', () => {
    expect(schema.parse({})).toEqual({ days: 180 });
    expect(schema.parse({ days: 0 })).toEqual({ days: 0 });
    expect(schema.parse({ days: '0' })).toEqual({ days: 0 });
    expect(schema.parse({ days: '30' })).toEqual({ days: 30 });
  });
  it.each(['', ' ', null, false, true, -1, 'abc', 0.5, 3651])('rejects an invalid or ambiguous days value: %j', days => {
    expect(schema.safeParse({ days }).success).toBe(false);
  });
});
