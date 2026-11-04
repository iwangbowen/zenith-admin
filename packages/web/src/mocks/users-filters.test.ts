import { afterEach, describe, expect, it } from 'vitest';
import type { HttpHandler } from 'msw';
import { userContract, type User } from '@zenith/shared/identity';
import { usersHandlers } from './handlers/users';
import { mockUsers, normalUserRole, superAdminRole } from './data/users';
import { mockOnlineSessions } from './data/system';

const sessions = [...mockOnlineSessions];

afterEach(() => { mockOnlineSessions.splice(0, mockOnlineSessions.length, ...sessions); });

async function list(query = '') {
  const request = new Request(`${window.location.origin}${userContract.list.fullPath}${query}`);
  for (const handler of usersHandlers) {
    const result = await (handler as HttpHandler).run({ request, requestId: 'users-filter-test' });
    if (result?.response) return result.response;
  }
  throw new Error('No users handler matched');
}

describe('user filters in Demo', () => {
  it('deduplicates multi-session users and filters before pagination and totals', async () => {
    const { data } = await (await list('?onlineStatus=online&pageSize=1&page=2')).json();
    expect(data.total).toBe(2);
    expect(data.list).toHaveLength(1);
    expect(data.list[0]).toMatchObject({ id: 2, isOnline: true });

    const offline = await (await list('?onlineStatus=offline')).json();
    expect(offline.data.total).toBe(mockUsers.length - 2);
    expect(offline.data.list.every((user: User) => !user.isOnline && user.lastActiveAt === null)).toBe(true);
  });

  it('combines role and online status and leaves the role-only total independent of pagination', async () => {
    const { data } = await (await list(`?roleId=${normalUserRole.id}&onlineStatus=online`)).json();
    expect(data.total).toBe(1);
    expect(data.list[0].id).toBe(2);

    const page = await (await list(`?roleId=${normalUserRole.id}&pageSize=1&page=2`)).json();
    expect(page.data.total).toBe(3);
    expect(page.data.list.map((user: User) => user.id)).toEqual([3]);

    const empty = await (await list(`?roleId=${superAdminRole.id}&onlineStatus=offline`)).json();
    expect(empty.data).toMatchObject({ list: [], total: 0 });
  });

  it('handles no active sessions and clearing both filters', async () => {
    mockOnlineSessions.length = 0;
    expect((await (await list('?onlineStatus=online')).json()).data).toMatchObject({ list: [], total: 0 });
    expect((await (await list('?onlineStatus=offline')).json()).data.total).toBe(mockUsers.length);
    expect((await (await list('?onlineStatus=')).json()).data.total).toBe(mockUsers.length);
  });

  it('rejects invalid filters through the shared contract', async () => {
    expect((await list('?roleId=-1')).status).toBe(400);
    expect((await list('?onlineStatus=unknown')).status).toBe(400);
  });
});
