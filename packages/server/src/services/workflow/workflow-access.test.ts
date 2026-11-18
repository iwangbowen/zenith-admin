import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { workflowInstances } from '../../db/schema';

const state = vi.hoisted(() => ({
  user: { userId: 7, username: 'reader', roles: [] as string[], tenantId: 2 as number | null, viewingTenantId: undefined as number | null | undefined },
  rows: [] as unknown[],
  permission: false,
}));
vi.mock('../../lib/context', () => ({ currentUser: () => state.user, hasPermission: async () => state.permission }));
vi.mock('../../lib/data-scope', () => ({ getDataScopeCondition: async () => eq(workflowInstances.initiatorId, state.user.userId) }));
vi.mock('../../lib/tenant', () => ({
  tenantCondition: (table: typeof workflowInstances, user: typeof state.user) => eq(table.tenantId, user.tenantId ?? 0),
  isPlatformAdmin: (user: typeof state.user) => user.roles.includes('super_admin') && user.tenantId === null,
}));
import { db } from '../../db';
import { requireMonitorWorkflowInstance, requirePlatformWorkflowAccess, workflowJobScope, workflowMonitorScope } from './workflow-access';

beforeEach(() => { state.user = { userId: 7, username: 'reader', roles: [], tenantId: 2, viewingTenantId: undefined }; state.permission = false; });

describe('workflow monitoring access boundaries', () => {
  it('correlates instance scope with initiator ownership and tenant', async () => {
    const query = new PgDialect({ casing: 'snake_case' }).sqlToQuery((await workflowMonitorScope())!);
    expect(query.sql).toContain('exists');
    expect(query.sql).toContain('initiator_id');
    expect(query.params).toContain(7);
    expect(query.params).toContain(2);
  });
  it('filters jobs through authorized instances instead of leaking payloads by job id', async () => {
    const query = new PgDialect({ casing: 'snake_case' }).sqlToQuery((await workflowJobScope())!);
    expect(query.sql).toContain('workflow_jobs');
    expect(query.sql).toContain('workflow_instances');
    expect(query.params).toContain(7);
    expect(query.sql).toContain('false');
  });
  it('requires an explicit platform view and capability for process-wide telemetry', async () => {
    await expect(requirePlatformWorkflowAccess()).rejects.toMatchObject({ status: 403 });
    state.user.roles = ['super_admin']; state.user.tenantId = null; state.permission = true;
    await expect(requirePlatformWorkflowAccess()).resolves.toBeUndefined();
    state.user.viewingTenantId = 2;
    await expect(requirePlatformWorkflowAccess()).rejects.toMatchObject({ status: 403 });
  });
  it('returns 404 when an instance is outside the monitor scope', async () => {
    const query = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    const executor = { select: vi.fn(() => query) } as unknown as typeof db;
    await expect(requireMonitorWorkflowInstance(42, executor)).rejects.toMatchObject({ status: 404 });
  });
});
