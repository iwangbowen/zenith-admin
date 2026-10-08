import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { authContract } from '@zenith/shared/identity';
import { mockAccessToken } from './utils/auth';
import { mockUsers } from './data/users';
import { authHandlers } from './handlers/auth';
import { deleteMockMySignature, resolveMockUserSignature } from './utils/personal-signature';
import { SIGNATURE_TEST_PNG } from '@/test-utils/signature';

const server = setupServer(...authHandlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
const endpoint = `${window.location.origin}${authContract.mySignature.fullPath}`;
const token = (tenantId?: number) => mockAccessToken('admin', tenantId);
const actorRequest = (accessToken: string) => new Request(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
async function call(method: 'GET' | 'PUT' | 'DELETE', accessToken?: string, body?: unknown) {
  const response = await fetch(endpoint, { method, headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

describe('我的签名契约与Demo身份隔离', () => {
  it('匿名不可读写，保存签名按账号和有效租户隔离', async () => {
    expect((await call('GET')).status).toBe(401);
    deleteMockMySignature(actorRequest(token()));
    deleteMockMySignature(actorRequest(token(1)));
    const saved = await call('PUT', token(), { dataUrl: SIGNATURE_TEST_PNG });
    expect(saved.status).toBe(200);
    expect((await call('GET', token())).body.data).toEqual(saved.body.data);
    expect((await call('GET', token(1))).body.data).toBeNull();
    const other = mockUsers.find((user) => user.username !== 'admin' && user.status === 'enabled')!;
    expect((await call('GET', mockAccessToken(other.username))).body.data).toBeNull();
  });
  it('更换递增版本、旧选择失效，已固化记录不随更换或删除变化', async () => {
    const request = actorRequest(token());
    const first = (await call('PUT', token(), { dataUrl: SIGNATURE_TEST_PNG })).body.data;
    const selection = { source: 'saved' as const, signatureId: first.id, version: first.version };
    const snapshot = resolveMockUserSignature(request, selection, 'reusable');
    const replaced = (await call('PUT', token(), { dataUrl: SIGNATURE_TEST_PNG })).body.data;
    expect(replaced.version).toBe(first.version + 1);
    expect(() => resolveMockUserSignature(request, selection, 'reusable')).toThrow();
    await call('DELETE', token());
    expect((await call('GET', token())).body.data).toBeNull();
    expect(snapshot).toMatchObject({ dataUrl: SIGNATURE_TEST_PNG, signatureVersion: first.version, signerId: mockUsers.find((user) => user.username === 'admin')!.id });
  });
  it('必须手写拒绝复用；模拟登录无法管理或使用签名', async () => {
    const first = (await call('PUT', token(), { dataUrl: SIGNATURE_TEST_PNG })).body.data;
    const selection = { source: 'saved' as const, signatureId: first.id, version: first.version };
    expect(() => resolveMockUserSignature(actorRequest(token()), selection, 'handwritten')).toThrow();
    const simulated = mockAccessToken('admin', undefined, { id: 1, byUserId: 2, byUsername: 'operator', readOnly: false, reason: 'test', startedAt: '2026-09-15 10:00:00', expiresAt: '2099-01-01 00:00:00' });
    expect((await call('GET', simulated)).status).toBe(403);
    expect((await call('PUT', simulated, { dataUrl: SIGNATURE_TEST_PNG })).status).toBe(403);
    expect((await call('DELETE', simulated)).status).toBe(403);
    expect(() => resolveMockUserSignature(actorRequest(simulated), { source: 'drawn', dataUrl: SIGNATURE_TEST_PNG }, 'handwritten')).toThrow();
  });
});
