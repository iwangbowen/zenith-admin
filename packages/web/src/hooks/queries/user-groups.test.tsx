/**
 * user-groups 域缓存一致性契约
 *
 * 收敛前成员分配 / 角色绑定 / 手动同步都 `invalidateQueries({ queryKey: userGroupKeys.all })`，
 * 角色绑定还连带 `userKeys.all`——把用户管理的列表、详情与跨页共享的 useAllUsers 下拉源全部打掉。
 *
 * 建模依据：
 *  - 列表行渲染 memberPreview / memberCount 与 roleCount，详情含 memberCount / roleCount
 *  - 用户组下拉源（useAllUserGroups）只渲染名称，成员 / 角色变化不影响它
 *  - 组角色变化只改变成员的**有效权限**视图（`effectivePermissions` 操作），用户列表 / 详情 / 下拉源不展示继承权限
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

import {
  userGroupKeys,
  useAllUserGroups,
  useAssignUserGroupMembers,
  useAssignUserGroupRoles,
  useSyncUserGroup,
  useUserGroupList,
  useUserGroupMembers,
  useUserGroupRoles,
} from './user-groups';
import { userKeys, useAllUsers, useUserEffectivePermissions, useUserList } from './users';
import { scopeMemberKeys, useScopeMembers } from './scope-members';

const LIST_PARAMS = { page: 1, pageSize: 10 };
const PREVIEW_PARAMS = { page: 1, pageSize: 10 };
const GROUP = { id: 1, name: '审批组', code: 'approver', memberMode: 'static', memberCount: 1, roleCount: 1, status: 'enabled' };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/user-groups', { list: [GROUP], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/user-groups/all', [GROUP])
    .on('GET', '/api/user-groups/1/members', [{ id: 7, username: 'alice', nickname: '爱丽丝' }])
    .on('GET', '/api/user-groups/1/roles', [{ id: 2, name: '审核员' }])
    .on('GET', '/api/user-groups/1/member-preview', { list: [{ id: 7, nickname: '爱丽丝', username: 'alice', avatar: null }], total: 1, page: 1, pageSize: 10 })
    .on('PUT', '/api/user-groups/1/members', null)
    .on('PUT', '/api/user-groups/1/roles', null)
    .on('POST', '/api/user-groups/1/sync', { added: 1, removed: 0 })
    .on('GET', '/api/users', { list: [{ id: 7, username: 'alice', nickname: '爱丽丝' }], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/users/all', [{ id: 7, username: 'alice', nickname: '爱丽丝' }])
    .on('GET', '/api/users/7/effective-permissions', { effectiveMenuIds: [1] })
    .on('GET', '/api/menus/user', [])
    .on('GET', '/api/data-mask/effective', { masked: [], canReveal: false });
});

describe('useAssignUserGroupMembers', () => {
  it('refreshes the member sheet, the preview modal, the list and nothing in the group lookup', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useUserGroupList(LIST_PARAMS),
        lookup: useAllUserGroups(),
        members: useUserGroupMembers(1),
        roles: useUserGroupRoles(1),
        preview: useScopeMembers('userGroup', 1, PREVIEW_PARAMS),
        assign: useAssignUserGroupMembers(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.lookup.isSuccess).toBe(true);
      expect(result.current.members.isSuccess).toBe(true);
      expect(result.current.roles.isSuccess).toBe(true);
      expect(result.current.preview.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.assign.mutateAsync({ params: { id: 1 }, body: { userIds: [7, 8] } });
    await waitFor(() => {
      expect(fetches.countOf(userGroupKeys.members(1))).toBe(1);
      expect(fetches.countOf(userGroupKeys.lists)).toBe(1);
      // 查看弹窗的成员预览是 memberPreview 操作，不再与 members 共享前缀，须显式失效
      expect(fetches.countOf(scopeMemberKeys.page('userGroup', 1, PREVIEW_PARAMS))).toBe(1);
    });

    expect(fetches.countOf(userGroupKeys.roles(1))).toBe(0);
    expect(fetches.countOf(userGroupKeys.lookup)).toBe(0);
    expect(isFresh(qc, userGroupKeys.lookup)).toBe(true);
    expect(api.countOf('GET', '/api/user-groups/all')).toBe(0);

    fetches.stop();
  });
});

describe('useAssignUserGroupRoles', () => {
  it('refreshes group roles, the list (roleCount) and effective permissions, but leaves the users domain lookups alone', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useUserGroupList(LIST_PARAMS),
        roles: useUserGroupRoles(1),
        members: useUserGroupMembers(1),
        users: useUserList(LIST_PARAMS),
        allUsers: useAllUsers(),
        effective: useUserEffectivePermissions(7),
        assignRoles: useAssignUserGroupRoles(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.roles.isSuccess).toBe(true);
      expect(result.current.members.isSuccess).toBe(true);
      expect(result.current.users.isSuccess).toBe(true);
      expect(result.current.allUsers.isSuccess).toBe(true);
      expect(result.current.effective.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.assignRoles.mutateAsync({ params: { id: 1 }, body: { roleIds: [2, 3] } });
    await waitFor(() => {
      expect(fetches.countOf(userGroupKeys.roles(1))).toBe(1);
      expect(fetches.countOf(userGroupKeys.lists)).toBe(1);
      // 成员继承的权限变了：有效权限视图回源
      expect(fetches.countOf(userKeys.effectivePermissions(7))).toBe(1);
    });

    // 收敛前 `userKeys.all` 广播会把这两个一并打掉
    expect(fetches.countOf(userKeys.lists)).toBe(0);
    expect(fetches.countOf(userKeys.allUsers)).toBe(0);
    expect(isFresh(qc, userKeys.allUsers)).toBe(true);
    expect(api.countOf('GET', '/api/users/all')).toBe(0);
    expect(api.countOf('GET', '/api/users')).toBe(0);
    // 成员名单与角色无关
    expect(fetches.countOf(userGroupKeys.members(1))).toBe(0);

    fetches.stop();
  });
});

describe('useSyncUserGroup', () => {
  it('refreshes membership surfaces but not the roles sheet or the group lookup', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useUserGroupList(LIST_PARAMS),
        lookup: useAllUserGroups(),
        members: useUserGroupMembers(1),
        roles: useUserGroupRoles(1),
        sync: useSyncUserGroup(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.lookup.isSuccess).toBe(true);
      expect(result.current.members.isSuccess).toBe(true);
      expect(result.current.roles.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.sync.mutateAsync({ params: { id: 1 } });
    await waitFor(() => {
      expect(fetches.countOf(userGroupKeys.members(1))).toBe(1);
      expect(fetches.countOf(userGroupKeys.lists)).toBe(1);
    });

    expect(fetches.countOf(userGroupKeys.roles(1))).toBe(0);
    expect(fetches.countOf(userGroupKeys.lookup)).toBe(0);
    expect(isFresh(qc, userGroupKeys.lookup)).toBe(true);

    fetches.stop();
  });
});
