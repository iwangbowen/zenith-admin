/**
 * roles / departments 域缓存一致性契约（S9 全局共享 lookup）
 *
 * 这两个域的下拉源（useAllRoles / useFlatDepartments / useDepartmentTree）被
 * 多个页面复用，S4 之后公告页的收件人选项也直接依赖它们，因此
 * 「该失效的必须失效」与「不该失效的不要碰」在这里同等重要。
 *
 * 注意 roles 与 announcements 一样**不能回填详情**：写接口返回的 mapRole 不带
 * menuIds（详情才另查关联菜单），拿它覆盖详情缓存会把菜单勾选状态清空。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  hasCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  roleKeys,
  useAllRoles,
  useAssignRoleMenus,
  useAssignRoleUsers,
  useDeleteRoles,
  useRoleDetail,
  useRoleList,
  useRoleUsers,
  useSaveRole,
} from './roles';
import { departmentKeys, useDeleteDepartment, useDepartmentTree, useFlatDepartments, useSaveDepartment } from './departments';

const LIST_PARAMS = { page: 1, pageSize: 10 };
const ROLE = { id: 1, name: '管理员', code: 'admin', dataScope: 'all', status: 'enabled', menuIds: [1, 2] };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/roles', { list: [ROLE], total: 1, page: 1, pageSize: 10 })
    .on('GET', '/api/roles/all', [ROLE])
    .on('GET', '/api/roles/1', ROLE)
    .on('GET', '/api/roles/1/users', [{ id: 7 }])
    .on('PUT', '/api/roles/1', { ...ROLE, menuIds: undefined })
    .on('PUT', '/api/roles/1/menus', null)
    .on('PUT', '/api/roles/1/users', null)
    .on('DELETE', '/api/roles/1', null)
    .on('GET', '/api/departments', [{ id: 1, name: '研发部' }])
    .on('GET', '/api/departments/flat', [{ id: 1, name: '研发部' }])
    .on('PUT', '/api/departments/1', { id: 1, name: '研发中心' })
    .on('DELETE', '/api/departments/1', null);
});

describe('useAssignRoleMenus —— 菜单只存在于角色详情', () => {
  it('refreshes the role detail without touching the list or the shared role dropdown', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useRoleList(LIST_PARAMS),
        detail: useRoleDetail(1),
        lookup: useAllRoles(),
        assignMenus: useAssignRoleMenus(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.lookup.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.assignMenus.mutateAsync({ params: { id: 1 }, body: { menuIds: [1, 2, 3], permissionCodes: [] } });
    await waitFor(() => expect(fetches.countOf(roleKeys.detail(1))).toBe(1));

    expect(fetches.countOf(roleKeys.lists)).toBe(0);
    expect(fetches.countOf(roleKeys.allRoles)).toBe(0);
    expect(isFresh(qc, roleKeys.allRoles)).toBe(true);
    expect(api.countOf('GET', '/api/roles/all')).toBe(0);

    fetches.stop();
  });
});

describe('useAssignRoleUsers —— 列表展示 userCount', () => {
  it('refreshes the role members and the list, but not the dropdown', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useRoleList(LIST_PARAMS),
        users: useRoleUsers(1),
        lookup: useAllRoles(),
        assignUsers: useAssignRoleUsers(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.users.isSuccess).toBe(true);
      expect(result.current.lookup.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.assignUsers.mutateAsync({ params: { id: 1 }, body: { userIds: [7, 8] } });
    await waitFor(() => expect(fetches.countOf(roleKeys.users(1))).toBe(1));
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    expect(fetches.countOf(roleKeys.lists)).toBe(1);
    expect(fetches.countOf(roleKeys.allRoles)).toBe(0);

    fetches.stop();
  });
});

describe('useSaveRole', () => {
  it('invalidates the detail rather than filling it, because the save response drops menuIds', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ detail: useRoleDetail(1), save: useSaveRole() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));
    expect(result.current.detail.data?.menuIds).toEqual([1, 2]);

    await result.current.save.mutateAsync({ id: 1, values: { name: '管理员（改）' } });
    await waitFor(() => expect(result.current.detail.isFetching).toBe(false));

    // 回源后 menuIds 仍在；若误用 setQueryData 回填，这里会变成 undefined
    expect(result.current.detail.data?.menuIds).toEqual([1, 2]);
  });

  it('refreshes the shared role dropdown that other domains depend on', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ lookup: useAllRoles(), save: useSaveRole() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.lookup.isSuccess).toBe(true));

    api.resetCalls();
    await result.current.save.mutateAsync({ id: 1, values: { name: '管理员（改）' } });
    await waitFor(() => expect(api.countOf('GET', '/api/roles/all')).toBe(1));
  });
});

describe('useDeleteRoles', () => {
  it('drops the deleted role detail and member caches', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: useRoleList(LIST_PARAMS), remove: useDeleteRoles() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    qc.setQueryData(roleKeys.detail(1), ROLE);
    qc.setQueryData(roleKeys.users(1), [{ id: 7 }]);

    await result.current.remove.mutateAsync([1]);
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    expect(hasCacheEntry(qc, roleKeys.detail(1))).toBe(false);
    expect(hasCacheEntry(qc, roleKeys.users(1))).toBe(false);
  });
});

describe('departments', () => {
  it('refreshes both the tree and the flat lookup when a department is renamed', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ tree: useDepartmentTree(), flat: useFlatDepartments(), save: useSaveDepartment() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.tree.isSuccess).toBe(true);
      expect(result.current.flat.isSuccess).toBe(true);
    });

    api.resetCalls();
    await result.current.save.mutateAsync({ id: 1, values: { name: '研发中心' } });

    await waitFor(() => expect(api.countOf('GET', '/api/departments')).toBe(1));
    await waitFor(() => expect(api.countOf('GET', '/api/departments/flat')).toBe(1));
  });

  it('drops the deleted department detail', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ tree: useDepartmentTree(), remove: useDeleteDepartment() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.tree.isSuccess).toBe(true));

    qc.setQueryData(departmentKeys.detail(1), { id: 1, name: '研发部' });
    await result.current.remove.mutateAsync({ params: { id: 1 } });

    expect(hasCacheEntry(qc, departmentKeys.detail(1))).toBe(false);
  });
});
