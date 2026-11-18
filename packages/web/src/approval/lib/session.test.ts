import { describe, expect, it } from 'vitest';
import { TOKEN_KEY } from '@zenith/shared/core';
import { approvalQueryClient } from './query-client';
import { activateApprovalSession, approvalReturnTo, approvalSessionIdentity, clearApprovalSession } from './session';

describe('approval identity isolation', () => {
  it('removes all personal namespaces on login and logout', () => {
    approvalQueryClient.setQueryData(['approval', 'list'], { owner: 1 });
    approvalQueryClient.setQueryData(['contract', 'messages'], { owner: 1 });
    activateApprovalSession({ accessToken: 'new-token', refreshToken: 'new-refresh' });
    expect(approvalQueryClient.getQueryCache().getAll()).toHaveLength(0);
    approvalQueryClient.setQueryData(['contract', 'messages'], { owner: 2 });
    clearApprovalSession();
    expect(approvalQueryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
  it('does not treat token rotation as a new identity', () => {
    const token = (jti: string) => `x.${btoa(JSON.stringify({ userId: 1, tenantId: 2, jti }))}.x`;
    expect(approvalSessionIdentity(token('a'))).toBe(approvalSessionIdentity(token('b')));
  });
  it('only restores approval routes', () => {
    expect(approvalReturnTo('/detail/3/5')).toBe('/detail/3/5');
    for (const path of ['//evil.test', 'https://evil.test', '/login', '/detail/../login']) expect(approvalReturnTo(path)).toBe('/');
  });
});
