/**
 * scope-members（成员预览弹窗）缓存一致性契约
 *
 * 预览 key 曾挂在所有者域的 `members` 字面量前缀下，靠前缀匹配「顺带」被分配成员的 mutation 失效。
 * 契约 key 下预览是独立的 `memberPreview` 操作，与 `members` 不再共享前缀：
 * 所有者域的成员分配 mutation 必须显式失效 `scopeMemberKeys.of(scope, id)`，用户保存则打掉全部范围的预览。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { scopeMemberKeys, useScopeMembers } from './scope-members';
import { useAssignPositionMembers } from './positions';
import { useAssignRoleUsers } from './roles';
import { useSaveUser } from './users';

const PAGE = { page: 1, pageSize: 10 };
const PREVIEW = { list: [{ id: 7, nickname: '爱丽丝', username: 'alice', avatar: null }], total: 1, page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/positions/1/member-preview', PREVIEW)
    .on('GET', '/api/positions/2/member-preview', PREVIEW)
    .on('GET', '/api/roles/1/member-preview', PREVIEW)
    .on('GET', '/api/departments/1/member-preview', PREVIEW)
    .on('PUT', '/api/positions/1/members', null)
    .on('PUT', '/api/roles/1/users', null)
    .on('PUT', '/api/users/7', { id: 7, username: 'alice', nickname: '爱丽丝' })
    .on('GET', '/api/users/alert-recipients', []);
});

describe('所有者域的成员分配', () => {
  it('assigning position members refreshes only that position\'s preview pages', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        mine: useScopeMembers('position', 1, PAGE),
        other: useScopeMembers('position', 2, PAGE),
        role: useScopeMembers('role', 1, PAGE),
        assign: useAssignPositionMembers(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.mine.isSuccess).toBe(true);
      expect(result.current.other.isSuccess).toBe(true);
      expect(result.current.role.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.assign.mutateAsync({ params: { id: 1 }, body: { userIds: [7, 8] } });
    await waitFor(() => expect(fetches.countOf(scopeMemberKeys.page('position', 1, PAGE))).toBe(1));

    expect(fetches.countOf(scopeMemberKeys.page('position', 2, PAGE))).toBe(0);
    expect(fetches.countOf(scopeMemberKeys.page('role', 1, PAGE))).toBe(0);
    expect(isFresh(qc, scopeMemberKeys.page('position', 2, PAGE))).toBe(true);
    expect(api.countOf('GET', '/api/positions/2/member-preview')).toBe(0);
    expect(api.countOf('GET', '/api/roles/1/member-preview')).toBe(0);

    fetches.stop();
  });

  it('assigning role users refreshes the role preview', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ role: useScopeMembers('role', 1, PAGE), assign: useAssignRoleUsers() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.role.isSuccess).toBe(true));

    api.resetCalls();
    await result.current.assign.mutateAsync({ params: { id: 1 }, body: { userIds: [7] } });
    await waitFor(() => expect(api.countOf('GET', '/api/roles/1/member-preview')).toBe(1));
  });
});

describe('用户保存', () => {
  it('marks every scope preview stale because the user may have moved department / position / role', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        department: useScopeMembers('department', 1, PAGE),
        position: useScopeMembers('position', 1, PAGE),
        save: useSaveUser(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.department.isSuccess).toBe(true);
      expect(result.current.position.isSuccess).toBe(true);
    });

    api.resetCalls();
    await result.current.save.mutateAsync({ id: 7, values: { nickname: '爱丽丝（改）' } });
    await waitFor(() => {
      expect(api.countOf('GET', '/api/departments/1/member-preview')).toBe(1);
      expect(api.countOf('GET', '/api/positions/1/member-preview')).toBe(1);
    });
  });
});
