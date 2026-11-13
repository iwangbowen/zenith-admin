import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { JwtPayload } from '../../middleware/auth';

const mocks = vi.hoisted(() => ({
  remove: vi.fn(), select: vi.fn(), count: vi.fn(), getJob: vi.fn(),
  user: { userId: 1, username: 'tenant-admin', roles: ['admin'], tenantId: 42 } as JwtPayload,
}));
vi.mock('../../db', () => ({ db: { select: mocks.select, $count: mocks.count } }));
vi.mock('./log-cleanup', () => ({ deleteLogRows: mocks.remove }));
vi.mock('../../config', () => ({ config: { multiTenantMode: true } }));
vi.mock('../../lib/context', () => ({ currentUser: () => mocks.user, currentUserOrNull: () => mocks.user }));
vi.mock('../../lib/user-nicknames', () => ({ getNicknameMap: vi.fn(), findUsernamesByNickname: vi.fn() }));
vi.mock('../../lib/pg-boss-scheduler', () => ({}));
vi.mock('../../lib/crud-service', () => ({ defineCrudService: () => ({ get: mocks.getJob }) }));
import { cleanOperationLogs, getCleanOperationLogsBeforeAudit } from './operation-logs.service';
import { cleanLoginLogs, getCleanLoginLogsBeforeAudit } from '../identity/login-logs.service';
import { clearCronJobLogs } from '../tasks/cron-jobs.service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { userId: 1, username: 'tenant-admin', roles: ['admin'], tenantId: 42, viewingTenantId: undefined };
  mocks.remove.mockResolvedValue(7);
  mocks.getJob.mockResolvedValue({ id: 9 });
  mocks.count.mockResolvedValue(7);
  mocks.select.mockReturnValue({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) });
});
const compile = (condition: Parameters<PgDialect['sqlToQuery']>[0]) => new PgDialect({ casing: 'snake_case' }).sqlToQuery(condition);

describe('manual log cleanup scope contracts', () => {
  it.each([['operations', cleanOperationLogs, getCleanOperationLogsBeforeAudit], ['login', cleanLoginLogs, getCleanLoginLogsBeforeAudit]] as const)('%s all-clean retains tenant filtering and matches the audit scope', async (_name, clean, audit) => {
    await expect(clean(0)).resolves.toBe(7);
    const where = mocks.remove.mock.calls[0][1];
    expect(compile(where).sql).toContain('tenant_id');
    expect(compile(where).sql).not.toContain('created_at');
    expect(compile(where).params).toEqual([42]);
    expect(await audit(0)).toMatchObject({ days: 0, total: 7, sample: [] });
    expect(compile(mocks.count.mock.calls[0][1])).toEqual(compile(where));
  });
  it.each([cleanOperationLogs, cleanLoginLogs])('positive retention cleanup keeps both date and tenant constraints', async clean => {
    await clean(30);
    const where = compile(mocks.remove.mock.calls[0][1]);
    expect(where.sql).toContain('created_at');
    expect(where.sql).toContain('tenant_id');
    expect(where.params[1]).toBe(42);
    expect(new Date(String(where.params[0])).getTime()).toBeCloseTo(Date.now() - 30 * 86_400_000, -3);
  });
  it.each([cleanOperationLogs, cleanLoginLogs])('a platform admin in a selected tenant still clears only that tenant', async clean => {
    mocks.user.roles = ['super_admin'];
    mocks.user.tenantId = null;
    mocks.user.viewingTenantId = 53;
    await clean(0);
    expect(compile(mocks.remove.mock.calls[0][1]).params).toEqual([53]);
  });
  it('per-task all-clean validates the task and deletes only its jobId', async () => {
    await expect(clearCronJobLogs(0, 9)).resolves.toBe(7);
    expect(mocks.getJob).toHaveBeenCalledWith(9);
    const where = compile(mocks.remove.mock.calls[0][1]);
    expect(where.sql).toContain('job_id');
    expect(where.sql).not.toContain('started_at');
    expect(where.params).toEqual([9]);
  });
  it('all-tasks all-clean has no job or age filter', async () => {
    await clearCronJobLogs(0);
    expect(mocks.remove.mock.calls[0][1]).toBeUndefined();
    expect(mocks.getJob).not.toHaveBeenCalled();
  });
  it('rejects unknown task IDs without invoking deletion', async () => {
    mocks.getJob.mockRejectedValueOnce(new Error('任务不存在'));
    await expect(clearCronJobLogs(0, 999)).rejects.toThrow('任务不存在');
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
