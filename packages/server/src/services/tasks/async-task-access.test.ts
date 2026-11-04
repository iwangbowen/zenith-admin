import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { userId: 27, username: 'publisher', roles: ['publisher'], tenantId: 7 },
  permissions: new Set<string>(),
  hasPermission: vi.fn(),
}));
vi.mock('../../lib/context', () => ({
  currentUser: () => state.user,
  hasPermission: state.hasPermission,
}));

import { canAccessAsyncTaskForScope, resolveAsyncTaskAccessScope } from './public/access';

beforeEach(() => {
  state.user = { userId: 27, username: 'publisher', roles: ['publisher'], tenantId: 7 };
  state.permissions = new Set();
  state.hasPermission.mockReset().mockImplementation(async (permission: string) => state.permissions.has(permission));
});

describe('async task owner access', () => {
  it('prevents a publisher from reading or operating a system-owned notification task', () => {
    const systemTask = { createdBy: 1 };
    const publisher = { userId: 27, global: false };
    expect(canAccessAsyncTaskForScope(systemTask, publisher)).toBe(false);
    expect(canAccessAsyncTaskForScope(systemTask, { userId: 1, global: false })).toBe(true);
    expect(canAccessAsyncTaskForScope(systemTask, { userId: 27, global: true })).toBe(true);
  });

  it('keeps read and manage permissions independent', async () => {
    state.permissions.add('system:async-task:list');
    await expect(resolveAsyncTaskAccessScope()).resolves.toEqual({ userId: 27, global: true });
    await expect(resolveAsyncTaskAccessScope('system:async-task:manage')).resolves.toEqual({ userId: 27, global: false });
    state.permissions = new Set(['system:async-task:manage']);
    await expect(resolveAsyncTaskAccessScope()).resolves.toEqual({ userId: 27, global: false });
    await expect(resolveAsyncTaskAccessScope('system:async-task:manage')).resolves.toEqual({ userId: 27, global: true });
  });

  it('does not infer global access from roles or unrelated permissions', async () => {
    state.user.roles = ['super_admin'];
    state.permissions.add('cms:content:list');
    await expect(resolveAsyncTaskAccessScope()).resolves.toEqual({ userId: 27, global: false });
    expect(state.hasPermission).toHaveBeenCalledWith('system:async-task:list');
    expect(canAccessAsyncTaskForScope({ createdBy: null }, { userId: 27, global: false })).toBe(false);
    expect(canAccessAsyncTaskForScope({ createdBy: null }, { userId: 27, global: true })).toBe(true);
  });

  it('resolves the active principal each time without retaining an earlier global grant', async () => {
    state.permissions.add('system:async-task:list');
    await expect(resolveAsyncTaskAccessScope()).resolves.toEqual({ userId: 27, global: true });
    state.user.userId = 31;
    state.permissions.clear();
    await expect(resolveAsyncTaskAccessScope()).resolves.toEqual({ userId: 31, global: false });
  });

  it('propagates authorization failures instead of granting access', async () => {
    state.hasPermission.mockRejectedValueOnce(new Error('permission store unavailable'));
    await expect(resolveAsyncTaskAccessScope()).rejects.toThrow('permission store unavailable');
  });
});
