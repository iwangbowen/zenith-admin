/**
 * menus 域缓存一致性契约（导航树查询化 + 访问变更联动）
 *
 * 导航树（userTree）是动态路由注册与侧边栏的唯一数据源；权限来源
 * （角色菜单 / 用户直授 / 用户组角色 / 租户套餐）变更后，客户端无法判断
 * 是否覆盖当前登录者，因此统一无条件失效 userTree + auth/me。
 * 断言全部落在可观测行为（实际请求数、真正进入 fetching 的查询）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
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
  invalidateCurrentUserAccess,
  menuKeys,
  useCurrentUserMenuTree,
  useMenuTree,
  useSaveMenu,
} from './menus';
import { authKeys } from './auth';
import { useAssignRoleMenus } from './roles';

const MENU = { id: 2590, parentId: 2440, title: 'SSL 证书', path: '/system/ssl-certificates', component: 'system/ssl-certificates/SslCertificatesPage', type: 'menu', status: 'enabled', visible: true };

/** 挂一个与 AuthProvider 同 key 的观察者，模拟已登录会话查询 */
function useAuthMeProbe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: () => api.dispatch('GET', '/api/auth/me').then((res) => (res as { data: unknown }).data),
  });
}

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/menus', [MENU])
    .on('GET', '/api/menus/user', [MENU])
    .on('GET', '/api/auth/me', { id: 1, username: 'admin', permissions: ['*'] })
    .on('PUT', '/api/menus/2590', MENU)
    .on('PUT', '/api/roles/1/menus', null);
});

describe('导航树与管理树查询', () => {
  it('loads both trees from their own endpoints without cross-fetching', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ userTree: useCurrentUserMenuTree(), tree: useMenuTree() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.userTree.isSuccess).toBe(true);
      expect(result.current.tree.isSuccess).toBe(true);
    });

    expect(api.countOf('GET', '/api/menus/user')).toBe(1);
    expect(api.countOf('GET', '/api/menus')).toBe(1);
  });

  it('exposes an error state instead of silently returning an empty tree', async () => {
    api.reset();
    // 未注册 /api/menus/user 桩：请求 reject，查询必须进入 error 而非成功返回空数组
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useCurrentUserMenuTree(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('useSaveMenu —— 菜单结构变化广播到导航树', () => {
  it('refetches the management tree and the user navigation tree', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ userTree: useCurrentUserMenuTree(), tree: useMenuTree(), save: useSaveMenu() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.userTree.isSuccess).toBe(true);
      expect(result.current.tree.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.save.mutateAsync({ id: 2590, values: { title: 'SSL 证书管理' } });
    await waitFor(() => {
      expect(fetches.countOf(menuKeys.tree)).toBe(1);
      expect(fetches.countOf(menuKeys.userTree)).toBe(1);
    });
    expect(api.countOf('GET', '/api/menus/user')).toBe(1);

    fetches.stop();
  });
});

describe('invalidateCurrentUserAccess —— 权限来源变更联动', () => {
  it('refetches the mounted user tree and auth session snapshot', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ userTree: useCurrentUserMenuTree(), tree: useMenuTree(), me: useAuthMeProbe() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.userTree.isSuccess).toBe(true);
      expect(result.current.tree.isSuccess).toBe(true);
      expect(result.current.me.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    invalidateCurrentUserAccess(qc);
    await waitFor(() => {
      expect(fetches.countOf(menuKeys.userTree)).toBe(1);
      expect(fetches.countOf(authKeys.me)).toBe(1);
    });
    // 管理树未被打扰
    expect(fetches.countOf(menuKeys.tree)).toBe(0);
    expect(isFresh(qc, menuKeys.tree)).toBe(true);

    fetches.stop();
  });

  it('is wired into role menu assignment', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ userTree: useCurrentUserMenuTree(), assign: useAssignRoleMenus() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.userTree.isSuccess).toBe(true));

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.assign.mutateAsync({ params: { id: 1 }, body: { menuIds: [2590], permissionCodes: [] } });
    await waitFor(() => expect(fetches.countOf(menuKeys.userTree)).toBe(1));
    expect(api.countOf('GET', '/api/menus/user')).toBe(1);

    fetches.stop();
  });
});
