import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { authContract } from '@zenith/shared/identity';
import { authHandlers } from './handlers/auth';
import { mockUsers } from './data/users';
import { mockAccessToken } from './utils/auth';

const server = setupServer(...authHandlers);
const original = structuredClone(mockUsers[0]);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => Object.assign(mockUsers[0], structuredClone(original)));
afterAll(() => server.close());

async function saveProfile(body: Record<string, unknown>) {
  const response = await fetch(`${window.location.origin}${authContract.updateProfile.fullPath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${mockAccessToken('admin')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

describe('个人资料邮箱保存', () => {
  it('支持填写、清空邮箱，并在未提交邮箱时保留原值', async () => {
    expect((await saveProfile({ email: 'profile@example.com' })).status).toBe(200);
    expect(mockUsers[0].email).toBe('profile@example.com');
    expect((await saveProfile({ nickname: '修改昵称' })).body.data.email).toBe('profile@example.com');
    const cleared = await saveProfile({ email: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.email).toBeNull();
    expect(mockUsers[0].email).toBeNull();
    expect((await saveProfile({ nickname: '无邮箱用户' })).body.data.email).toBeNull();
  });

  it('拒绝无效邮箱且不改变已保存资料', async () => {
    const before = mockUsers[0].email;
    expect((await saveProfile({ email: 'invalid-email' })).status).toBe(400);
    expect(mockUsers[0].email).toBe(before);
  });
});
