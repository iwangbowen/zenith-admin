import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { cronJobContract, operationLogContract } from '@zenith/shared/platform';
import { loginLogContract } from '@zenith/shared/identity';
import { cronJobsHandlers } from './cron-jobs';
import { operationLogsHandlers } from './operation-logs';
import { loginLogsHandlers } from './login-logs';
import { mockLoginLogs, mockOperationLogs } from '@/mocks/data/logs';
import { mockCronJobLogs } from '@/mocks/data/cron-job-logs';

const server = setupServer(...cronJobsHandlers, ...operationLogsHandlers, ...loginLogsHandlers);
const initial = { login: structuredClone(mockLoginLogs), operation: structuredClone(mockOperationLogs), cron: structuredClone(mockCronJobLogs) };
const url = (path: string) => new URL(path, window.location.origin).href;
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  mockLoginLogs.splice(0, mockLoginLogs.length, ...structuredClone(initial.login));
  mockOperationLogs.splice(0, mockOperationLogs.length, ...structuredClone(initial.operation));
  mockCronJobLogs.splice(0, mockCronJobLogs.length, ...structuredClone(initial.cron));
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Demo log clear-all keeps lists and derived statistics consistent', () => {
  it.each([['login', loginLogContract.clean, mockLoginLogs], ['operation', operationLogContract.clean, mockOperationLogs]] as const)('clears recent and old %s records when days is explicitly zero', async (_name, clean, store) => {
    expect(store.length).toBeGreaterThan(0);
    const response = await fetch(url(`${clean.fullPath}?days=0`), { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(store).toHaveLength(0);
  });
  it('keeps another task intact when clearing all logs of a single job', async () => {
    const jobId = mockCronJobLogs[0].jobId;
    const others = mockCronJobLogs.filter(log => log.jobId !== jobId);
    const path = cronJobContract.clearJobLogs.fullPath.replace('{id}', String(jobId));
    const response = await fetch(url(`${path}?days=0`), { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(mockCronJobLogs).toEqual(others);
    expect(others.length).toBeGreaterThan(0);
  });
  it('clears all tasks logs and returns empty list/statistics', async () => {
    const response = await fetch(url(`${cronJobContract.clearLogs.fullPath}?days=0`), { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(mockCronJobLogs).toHaveLength(0);
    const listed = await (await fetch(url(cronJobContract.logs.fullPath))).json();
    expect(listed.data).toMatchObject({ list: [], total: 0 });
  });
  it('does not treat blank days as all', async () => {
    const count = mockLoginLogs.length;
    const response = await fetch(url(`${loginLogContract.clean.fullPath}?days=`), { method: 'DELETE' });
    expect(response.status).toBe(400);
    expect(mockLoginLogs).toHaveLength(count);
  });
});
