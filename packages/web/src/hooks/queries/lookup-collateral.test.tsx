/**
 * lookup 连坐批次的行为测试（B1 / B2）
 *
 * 这批域的共同形态：同一个根键下既有列表/详情，又挂着一份长 staleTime 的
 * 静态下拉源或与本域无关的派生查询，`.all` 会把它们一并打掉。
 *
 * 每个用例只断言一件事：那份不该被波及的查询在写操作后仍然新鲜。
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

import { useDataMaskList, useSaveDataMask } from './data-mask';
import { roleKeys, useAllRoles } from './roles';
import {
  fileStorageConfigKeys,
  useFileStorageConfigList,
  useSaveFileStorageConfig,
  useStorageBrowse,
} from './file-storage-configs';
import { useIdentityProviderList, useIdentityProviderTenants, useSaveIdentityProvider } from './identity-providers';
import { tenantKeys } from './tenants';
import {
  paymentSharingKeys,
  useCreatePaymentSharingOrder,
  useEnabledPaymentSharingReceivers,
  usePaymentSharingOrders,
  usePaymentSharingReceivers,
} from './payment-sharing';
import { tenantPackageKeys, useAllTenantPackages, useAssignTenantPackageFeatures, useTenantPackageDetail } from './tenant-packages';
import { aiProviderKeys, useAiChatModels } from './ai-providers';
import { aiUserConfigKeys, useAiUserConfigs, useSaveAiUserConfig } from './ai-user-config';

const LIST_PARAMS = { page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/roles/all', [{ id: 1, code: 'admin', name: '管理员' }])
    .on('GET', '/api/data-mask-configs', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('POST', '/api/data-mask-configs', { id: 1 })
    .on('GET', '/api/file-storage-configs', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('POST', '/api/file-storage-configs', { id: 1 })
    .on('GET', /\/api\/files\/browse/, { entries: [] })
    .on('GET', '/api/identity-providers', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/tenants/all', [{ id: 1, name: '租户 A' }])
    .on('POST', '/api/identity-providers', { id: 1 })
    .on('GET', '/api/payment/sharing/receivers', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/payment/sharing/orders', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('POST', '/api/payment/sharing/orders', { id: 9 })
    .on('GET', '/api/tenant-packages/all', [{ id: 1, name: '基础版' }])
    .on('GET', '/api/tenant-packages/1', { id: 1, name: '基础版', features: ['wiki'] })
    .on('PUT', '/api/tenant-packages/1/features', null)
    .on('GET', '/api/ai/models', [{ id: 'gpt', name: 'GPT' }])
    .on('GET', '/api/ai/user-configs', [])
    .on('POST', '/api/ai/user-configs', { id: 1 });
});

describe('data-mask：角色下拉源归还 roles 域', () => {
  it('does not refetch the role lookup when a mask config is saved', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: useDataMaskList(LIST_PARAMS), roles: useAllRoles(), save: useSaveDataMask() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.roles.isSuccess).toBe(true);
    });

    api.resetCalls();
    await result.current.save.mutateAsync({ values: { entity: 'users', field: 'phone', label: '手机号' } });
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    expect(api.countOf('GET', '/api/roles/all')).toBe(0);
    expect(isFresh(qc, roleKeys.allRoles)).toBe(true);
  });
});

describe('file-storage-configs：保存配置不触发文件浏览', () => {
  it('keeps the browse result cache untouched', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useFileStorageConfigList(LIST_PARAMS),
        browse: useStorageBrowse(1, '/'),
        save: useSaveFileStorageConfig(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.browse.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    await result.current.save.mutateAsync({ values: { name: 'oss' } });
    await waitFor(() => expect(fetches.countOf(fileStorageConfigKeys.lists)).toBe(1));

    // 浏览一个目录可能很贵，且与配置增删改无关
    expect(fetches.countOf(fileStorageConfigKeys.browseRoot)).toBe(0);
    expect(isFresh(qc, fileStorageConfigKeys.browse(1, '/'))).toBe(true);

    fetches.stop();
  });
});

describe('identity-providers：租户下拉源与身份源配置无关', () => {
  it('leaves the tenant lookup fresh after saving a provider', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        list: useIdentityProviderList(LIST_PARAMS),
        tenants: useIdentityProviderTenants(),
        save: useSaveIdentityProvider(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.tenants.isSuccess).toBe(true);
    });

    api.resetCalls();
    await result.current.save.mutateAsync({ values: { name: 'ldap' } });
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));

    expect(api.countOf('GET', '/api/tenants/all')).toBe(0);
    // 租户下拉已收敛到 tenants 域的共享 lookup（原先在 identityProviderKeys.tenants
    // 下另存一份，与 AdminLayout 常驻的租户切换器重复请求同一端点）
    expect(isFresh(qc, tenantKeys.lookup)).toBe(true);
  });
});

describe('payment-sharing：新增分账单不改变分账方名单', () => {
  it('refreshes only the order list', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        receivers: usePaymentSharingReceivers(LIST_PARAMS),
        orders: usePaymentSharingOrders(LIST_PARAMS),
        enabled: useEnabledPaymentSharingReceivers(),
        createOrder: useCreatePaymentSharingOrder(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.receivers.isSuccess).toBe(true);
      expect(result.current.orders.isSuccess).toBe(true);
      expect(result.current.enabled.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    await result.current.createOrder.mutateAsync({ body: { orderNo: 'X1', receiverId: 1 } });
    await waitFor(() => expect(fetches.countOf(paymentSharingKeys.orderLists)).toBe(1));

    expect(fetches.countOf(paymentSharingKeys.receiverLists)).toBe(0);
    expect(fetches.countOf(paymentSharingKeys.enabledReceivers)).toBe(0);
    expect(isFresh(qc, paymentSharingKeys.enabledReceivers)).toBe(true);

    fetches.stop();
  });
});

describe('tenant-packages：分配功能只影响列表与详情', () => {
  it('leaves the package dropdown untouched', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        detail: useTenantPackageDetail(1),
        lookup: useAllTenantPackages(),
        assignFeatures: useAssignTenantPackageFeatures(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.lookup.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    await result.current.assignFeatures.mutateAsync({ params: { id: 1 }, body: { features: ['wiki', 'workflow'] } });
    await waitFor(() => expect(fetches.countOf(tenantPackageKeys.detail(1))).toBe(1));

    expect(fetches.countOf(tenantPackageKeys.lookup)).toBe(0);
    expect(isFresh(qc, tenantPackageKeys.lookup)).toBe(true);

    fetches.stop();
  });
});

describe('ai-user-config：个人 Key 只影响可用模型', () => {
  it('refreshes chat models without wiping the whole provider domain', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ configs: useAiUserConfigs(), models: useAiChatModels(), save: useSaveAiUserConfig() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.configs.isSuccess).toBe(true);
      expect(result.current.models.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    await result.current.save.mutateAsync({ values: { apiKey: 'sk-x' } });
    await waitFor(() => expect(fetches.countOf(aiProviderKeys.chatModels)).toBe(1));

    expect(fetches.countOf(aiUserConfigKeys.lists)).toBe(1);

    fetches.stop();
  });
});
