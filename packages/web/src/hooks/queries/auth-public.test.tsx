/**
 * hooks/queries/auth-public.ts —— useOAuthProviders 契约：
 * 登录页只在拿到非空列表时渲染「其他方式登录」，因此后端不可达 / 接口报错必须落为空数组（而不是 error 态），
 * 加载中 data 为 undefined 由调用方 `?? []` 兜底；enabled=false 时不发请求。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const get = vi.fn();

vi.mock('@/utils/request', () => ({ request: { get: (...a: unknown[]) => get(...a) } }));

import { useOAuthProviders } from './auth-public';

const wrapper = () => createWrapper(createTestQueryClient());

beforeEach(() => vi.clearAllMocks());

describe('useOAuthProviders', () => {
  it('静默请求公开接口并返回已启用的提供方', async () => {
    get.mockResolvedValue({ code: 0, message: 'success', data: ['github', 'feishu'] });
    const { result } = renderHook(() => useOAuthProviders(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(['github', 'feishu']);
    expect(get).toHaveBeenCalledWith('/api/auth/oauth/providers', { silent: true });
  });

  it('后端不可达或接口异常时按「无可用提供方」处理：成功态 + 空数组，不进入 error', async () => {
    get.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useOAuthProviders(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('enabled=false 时不发请求（个人中心非安全页签）', () => {
    const { result } = renderHook(() => useOAuthProviders(false), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });
});
