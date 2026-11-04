/**
 * users 域缓存一致性契约（S10b）
 *
 * 这是刻意押到最后的域：一个根键下同时挂着列表、详情、跨页共享的下拉源
 * （useAllUsers 被角色分配、岗位成员、用户组等多页使用）、数据权限与有效权限，
 * 11 处 `.all` 让任何一次写操作都把它们全部打掉。
 *
 * 最关键的一条约束是**不能回填详情**，而且理由与前几个域不同：
 * 写接口返回 mapUser（未脱敏），详情接口返回 mapUserWithMask（按查看者角色脱敏）。
 * 用写接口响应覆盖详情缓存，会把未脱敏的手机号与邮箱写进本不该展示它们的界面。
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
  userKeys,
  useAlertRecipientUsers,
  useAllUsers,
  useAssignUserRoles,
  useDeleteUsers,
  useSaveUser,
  useSaveUserDataPermission,
  useSaveUserMenus,
  useUserDataPermission,
  useUserDetail,
  useUserEffectivePermissions,
  useUserList,
} from './users';

const LIST_PARAMS = { page: 1, pageSize: 10 };

/** 详情走脱敏：手机号中间四位被打码 */
const MASKED_USER = { id: 1, username: 'alice', nickname: '爱丽丝', phone: '138****8000' };
/** 写接口返回未脱敏原文 */
const RAW_USER = { id: 1, username: 'alice', nickname: '爱丽丝', phone: '13812348000' };
const ALERT_RECIPIENT = { id: 1, username: 'alice', nickname: '爱丽丝', departmentName: '技术部', hasEmail: true };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/users/all', [MASKED_USER])
    .on('GET', '/api/users/alert-recipients', [ALERT_RECIPIENT])
    .on('GET', '/api/users/1/data-permission', { userDataScope: 'all', deptScopeIds: [] })
    .on('GET', '/api/users/1/effective-permissions', { effectiveMenuIds: [1] })
    .on('GET', '/api/users/1', MASKED_USER)
    .on('GET', '/api/users', { list: [MASKED_USER], total: 1, page: 1, pageSize: 10 })
    .on('PUT', '/api/users/1', RAW_USER)
    .on('PUT', '/api/users/1/roles', null)
    .on('PUT', '/api/users/1/data-permission', null)
    .on('PUT', '/api/users/1/menus', null)
    .on('DELETE', '/api/users/1', null)
    .on('DELETE', '/api/users/batch', null);
});

describe('useUserList filters', () => {
  it('sends the role and online status and keeps differently filtered lists in separate caches', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      online: useUserList({ ...LIST_PARAMS, roleId: 2, onlineStatus: 'online' }),
      offline: useUserList({ ...LIST_PARAMS, roleId: 2, onlineStatus: 'offline' }),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => {
      expect(result.current.online.isSuccess).toBe(true);
      expect(result.current.offline.isSuccess).toBe(true);
    });

    const queries = api.urls('GET').map((url) => new URL(url, 'http://localhost').searchParams);
    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.get('roleId') === '2')).toBe(true);
    expect(queries.map((query) => query.get('onlineStatus')).sort()).toEqual(['offline', 'online']);
  });
});

describe('useSaveUser', () => {
  it('refetches the masked detail instead of filling it from the unmasked save response', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ detail: useUserDetail(1), save: useSaveUser() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));
    expect(result.current.detail.data?.phone).toBe('138****8000');

    await result.current.save.mutateAsync({ id: 1, values: { nickname: '爱丽丝' } });
    await waitFor(() => expect(result.current.detail.isFetching).toBe(false));

    // 若误用 setQueryData 回填，这里会变成未脱敏的 13812348000
    expect(result.current.detail.data?.phone).toBe('138****8000');
  });

  it('refreshes both general and alert-recipient user lookups', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        lookup: useAllUsers(),
        alertRecipients: useAlertRecipientUsers(),
        save: useSaveUser(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.lookup.isSuccess).toBe(true);
      expect(result.current.alertRecipients.isSuccess).toBe(true);
    });

    api.resetCalls();
    await result.current.save.mutateAsync({ id: 1, values: { nickname: '爱丽丝（改）' } });
    await waitFor(() => {
      expect(api.countOf('GET', '/api/users/all')).toBe(1);
      expect(api.countOf('GET', '/api/users/alert-recipients')).toBe(1);
    });
  });
});

describe('权限类写操作只影响各自的权限查询', () => {
  it('saving data permission touches neither the list, the detail, nor the dropdown', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useUserList(LIST_PARAMS),
        detail: useUserDetail(1),
        lookup: useAllUsers(),
        dataPermission: useUserDataPermission(1),
        effective: useUserEffectivePermissions(1),
        saveDataPermission: useSaveUserDataPermission(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.lookup.isSuccess).toBe(true);
      expect(result.current.dataPermission.isSuccess).toBe(true);
      expect(result.current.effective.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.saveDataPermission.mutateAsync({ params: { id: 1 }, body: { dataScope: 'dept', deptScopeIds: [3] } });
    await waitFor(() => expect(fetches.countOf(userKeys.dataPermission(1))).toBe(1));

    expect(fetches.countOf(userKeys.lists)).toBe(0);
    expect(fetches.countOf(userKeys.detail(1))).toBe(0);
    expect(fetches.countOf(userKeys.allUsers)).toBe(0);
    expect(fetches.countOf(userKeys.effectivePermissions(1))).toBe(0);
    expect(isFresh(qc, userKeys.allUsers)).toBe(true);
    expect(api.countOf('GET', '/api/users/all')).toBe(0);

    fetches.stop();
  });

  it('saving directly granted menus only refreshes the effective permission view', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useUserList(LIST_PARAMS),
        effective: useUserEffectivePermissions(1),
        dataPermission: useUserDataPermission(1),
        saveMenus: useSaveUserMenus(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.effective.isSuccess).toBe(true);
      expect(result.current.dataPermission.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    await result.current.saveMenus.mutateAsync({ params: { id: 1 }, body: { menuIds: [1, 2] } });
    await waitFor(() => expect(fetches.countOf(userKeys.effectivePermissions(1))).toBe(1));

    expect(fetches.countOf(userKeys.lists)).toBe(0);
    expect(fetches.countOf(userKeys.dataPermission(1))).toBe(0);

    fetches.stop();
  });

  it('assigning roles refreshes the detail, the list and the effective permissions', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useUserList(LIST_PARAMS),
        detail: useUserDetail(1),
        effective: useUserEffectivePermissions(1),
        dataPermission: useUserDataPermission(1),
        assignRoles: useAssignUserRoles(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.effective.isSuccess).toBe(true);
      expect(result.current.dataPermission.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    await result.current.assignRoles.mutateAsync({ params: { id: 1 }, body: { roleIds: [2] } });
    await waitFor(() => expect(fetches.countOf(userKeys.effectivePermissions(1))).toBe(1));
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    expect(fetches.countOf(userKeys.detail(1))).toBe(1);
    expect(fetches.countOf(userKeys.lists)).toBe(1);
    // 角色不影响数据权限范围
    expect(fetches.countOf(userKeys.dataPermission(1))).toBe(0);

    fetches.stop();
  });
});

describe('useDeleteUsers', () => {
  it('drops every per-user cache of the deleted users', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: useUserList(LIST_PARAMS), batchDelete: useDeleteUsers() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    qc.setQueryData(userKeys.detail(1), MASKED_USER);
    qc.setQueryData(userKeys.dataPermission(1), { userDataScope: 'all' });
    qc.setQueryData(userKeys.effectivePermissions(1), { effectiveMenuIds: [1] });

    await result.current.batchDelete.mutateAsync([1]);
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    expect(hasCacheEntry(qc, userKeys.detail(1))).toBe(false);
    expect(hasCacheEntry(qc, userKeys.dataPermission(1))).toBe(false);
    expect(hasCacheEntry(qc, userKeys.effectivePermissions(1))).toBe(false);
  });
});
