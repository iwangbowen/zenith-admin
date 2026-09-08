import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identitySecurityContract, authContract, type LoginRiskEvent } from '@zenith/shared/identity';
import { identitySecurityHandlers } from './handlers/identity-security';
import { authHandlers } from './handlers/auth';
import { mockUsers } from './data/users';
import { mockAccessToken } from './utils/auth';
import type { HttpHandler } from 'msw';

const originals = mockUsers.map((user) => ({ ...user, roles: [...user.roles] }));

async function call(path: string, token?: string, body?: unknown) {
  const request = new Request(`${window.location.origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const handler of [...identitySecurityHandlers, ...authHandlers]) {
    const result = await (handler as HttpHandler).run({ request, requestId: 'risk-test' });
    if (result?.response) return result.response;
  }
  throw new Error('No handler matched');
}

beforeEach(() => {
  mockUsers[1].tenantId = 1;
  mockUsers[1].roles = [{ ...mockUsers[1].roles[0], menuIds: [2022] }];
});
afterEach(() => { mockUsers.splice(0, mockUsers.length, ...originals.map((user) => ({ ...user, roles: [...user.roles] }))); });

describe('risk event Mock authorization and tenant scope', () => {
  const path = identitySecurityContract.riskEvents.fullPath;
  it('requires authentication and the dedicated read permission', async () => {
    expect((await call(path)).status).toBe(401);
    mockUsers[1].roles[0].menuIds = [2021];
    expect((await call(path, mockAccessToken(mockUsers[1].username))).status).toBe(403);
  });
  it('filters other tenants and totals before keyword matching and pagination', async () => {
    const token = mockAccessToken(mockUsers[1].username);
    const { data } = await (await call(path, token)).json();
    expect(data.total).toBe(1);
    expect(data.list.every((row: LoginRiskEvent) => row.tenantId === 1)).toBe(true);
    const searched = await (await call(`${path}?keyword=tenant-2`, token)).json();
    expect(searched.data).toMatchObject({ list: [], total: 0 });
  });
  it('gives ordinary platform accounts only platform records', async () => {
    mockUsers[1].tenantId = null;
    const { data } = await (await call(path, mockAccessToken(mockUsers[1].username))).json();
    expect(data.total).toBe(1);
    expect(data.list[0].tenantId).toBeNull();
  });
  it('keeps a super-admin tenant view through token refresh', async () => {
    const switched = await (await call(authContract.switchTenant.fullPath, mockAccessToken('admin'), { tenantId: 2 })).json();
    const refreshed = await (await call(authContract.refresh.fullPath, undefined, { refreshToken: switched.data.refreshToken })).json();
    const { data } = await (await call(path, refreshed.data.accessToken)).json();
    expect(data.total).toBe(1);
    expect(data.list[0].tenantId).toBe(2);
  });
  it('orders equal timestamps by descending ID in the global view', async () => {
    const { data } = await (await call(`${path}?pageSize=2`, mockAccessToken('admin', null))).json();
    expect(data.total).toBe(3);
    expect(data.list.map((row: LoginRiskEvent) => row.id)).toEqual([3, 2]);
  });
});
