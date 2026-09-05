import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  ACCOUNT_SWITCH_BROADCAST_KEY,
  PREFERENCES_KEY,
  REFRESH_TOKEN_KEY,
  TABS_STORAGE_KEY,
  TOKEN_KEY,
} from '@zenith/shared/core';
import { AuthProvider } from '@/providers/AuthProvider';
import { ADMIN_AUTH_INVALIDATED_EVENT, request } from '@/utils/request';
import {
  broadcastSwitchAndReload,
  listParkedAccounts,
  parkAccount,
  reloadForExternalAccountSwitch,
} from '@/lib/account-store';
import { useAuth } from './useAuth';

vi.mock('@/utils/request', () => ({
  ADMIN_AUTH_INVALIDATED_EVENT: 'auth:invalidated',
  request: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// 整页重载在 jsdom 中不可用：局部 mock 重载入口，仓库函数保持真实实现
vi.mock('@/lib/account-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/account-store')>();
  return {
    ...actual,
    broadcastSwitchAndReload: vi.fn(),
    reloadForExternalAccountSwitch: vi.fn(),
  };
});

const mockRequest = vi.mocked(request);

function makeMeResponse(overrides: Record<string, unknown> = {}) {
  return {
    code: 0,
    message: 'success',
    data: {
      id: 1,
      username: 'admin',
      nickname: '管理员',
      email: 'admin@example.com',
      permissions: ['user:read', 'role:read'],
      ...overrides,
    },
  };
}

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return (
      <QueryClientProvider client={client}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );
  };
}

function renderAuthHook(client = createClient()) {
  return {
    client,
    ...renderHook(() => useAuth(), { wrapper: createWrapper(client) }),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('AuthProvider initialization', () => {
  it('stays anonymous without credentials and does not request /api/auth/me', () => {
    const { result } = renderAuthHook();

    expect(result.current.status).toBe('anonymous');
    expect(result.current.user).toBeNull();
    expect(mockRequest.get).not.toHaveBeenCalled();
  });

  it('loads one shared session for multiple consumers', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-token');
    mockRequest.get.mockResolvedValue(makeMeResponse());
    const client = createClient();

    function Consumer({ name }: Readonly<{ name: string }>) {
      const auth = useAuth();
      return <span data-testid={name}>{auth.user?.username ?? auth.status}</span>;
    }

    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Consumer name="first" />
          <Consumer name="second" />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('first')).toHaveTextContent('admin');
      expect(screen.getByTestId('second')).toHaveTextContent('admin');
    });
    expect(mockRequest.get).toHaveBeenCalledTimes(1);
    expect(mockRequest.get).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ silent: true }));
  });

  it('keeps credentials and exposes unavailable status on network failure', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-token');
    mockRequest.get.mockResolvedValue({ code: -1, message: '网络请求失败', data: null });

    const { result } = renderAuthHook();

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('valid-token');
  });

  it('stays on the unavailable page while a retry is in flight', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-token');
    mockRequest.get.mockResolvedValueOnce({ code: -1, message: '网络请求失败', data: null });
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('unavailable'));

    let resolveRetry: (value: ReturnType<typeof makeMeResponse>) => void = () => {};
    mockRequest.get.mockReturnValueOnce(
      new Promise<ReturnType<typeof makeMeResponse>>((resolve) => { resolveRetry = resolve; }),
    );

    act(() => { void result.current.refresh(); });

    // 重试期间若回落到 checking，整页会闪回加载点再弹回错误页
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.status).toBe('unavailable');

    await act(async () => { resolveRetry(makeMeResponse()); });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
  });

  it('clears credentials when the session is rejected', async () => {
    localStorage.setItem(TOKEN_KEY, 'expired-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'expired-refresh');
    mockRequest.get.mockResolvedValue({ code: 401, message: 'Unauthorized', data: null });

    const { result } = renderAuthHook();

    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });
});

describe('AuthProvider actions', () => {
  it('stores login credentials and fetches the session exactly once', async () => {
    mockRequest.post.mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: {
        token: { accessToken: 'new-access-token', refreshToken: 'new-refresh-token' },
        user: { id: 1 },
      },
    });
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    const { result } = renderAuthHook();

    await act(async () => {
      await result.current.login('admin', 'password');
    });

    expect(localStorage.getItem(TOKEN_KEY)).toBe('new-access-token');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('new-refresh-token');
    expect(result.current.user?.username).toBe('admin');
    expect(mockRequest.get).toHaveBeenCalledTimes(1);
  });

  it('does not persist credentials after a failed login', async () => {
    mockRequest.post.mockResolvedValueOnce({
      code: 400,
      message: '用户名或密码错误',
      data: null,
    });
    const { result } = renderAuthHook();

    await act(async () => {
      await result.current.login('admin', 'wrong');
    });

    expect(result.current.status).toBe('anonymous');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(mockRequest.get).not.toHaveBeenCalled();
  });

  it('logs out without issuing another /api/auth/me request and clears identity caches', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'valid-refresh');
    localStorage.setItem(PREFERENCES_KEY, '{}');
    localStorage.setItem(TABS_STORAGE_KEY, '[]');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    mockRequest.post.mockResolvedValueOnce({ code: 0, message: 'success', data: null });
    const client = createClient();
    client.setQueryData(['private', 'data'], { owner: 1 });
    const { result } = renderAuthHook(client);
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    act(() => result.current.logout());

    await waitFor(() => {
      expect(result.current.status).toBe('anonymous');
      expect(client.getQueryData(['private', 'data'])).toBeUndefined();
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(PREFERENCES_KEY)).toBeNull();
    expect(localStorage.getItem(TABS_STORAGE_KEY)).toBeNull();
    expect(mockRequest.get).toHaveBeenCalledTimes(1);
  });

  it('updates the shared user while preserving permissions and avoiding refetch', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-token');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    const current = result.current.user!;

    act(() => result.current.updateUser({ ...current, nickname: '新昵称' }));

    await waitFor(() => expect(result.current.user?.nickname).toBe('新昵称'));
    expect(result.current.permissions).toEqual(['user:read', 'role:read']);
    expect(mockRequest.get).toHaveBeenCalledTimes(1);
  });

  it('does not replace the session user when another account is edited', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-token');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    const current = result.current.user!;

    act(() => result.current.updateUser({ ...current, id: 2, nickname: '其他用户' }));

    expect(result.current.user?.id).toBe(1);
    expect(result.current.user?.nickname).toBe('管理员');
  });
});

describe('AuthProvider invalidation synchronization', () => {
  it('handles HTTP unauthorized notifications through the shared state machine', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'valid-refresh');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    act(() => globalThis.dispatchEvent(new Event(ADMIN_AUTH_INVALIDATED_EVENT)));

    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(mockRequest.get).toHaveBeenCalledTimes(1);
  });

  it('synchronizes logout from another browser tab', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-token');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    localStorage.removeItem(TOKEN_KEY);

    act(() => {
      globalThis.dispatchEvent(new StorageEvent('storage', {
        key: TOKEN_KEY,
        oldValue: 'valid-token',
        newValue: null,
      }));
    });

    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(mockRequest.get).toHaveBeenCalledTimes(1);
  });
});

describe('AuthProvider account switching', () => {
  function parkLisi(overrides: Record<string, unknown> = {}) {
    parkAccount({
      userId: 2,
      username: 'lisi',
      nickname: '李四',
      refreshToken: 'lisi-refresh',
      lastUsedAt: 1000,
      ...overrides,
    });
  }

  it('switches to a parked account: refreshes tokens, parks current, reloads', async () => {
    localStorage.setItem(TOKEN_KEY, 'admin-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'admin-refresh');
    localStorage.setItem(PREFERENCES_KEY, '{}');
    localStorage.setItem(TABS_STORAGE_KEY, '[]');
    parkLisi();
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    mockRequest.post.mockResolvedValueOnce({ code: 0, message: 'ok', data: { accessToken: 'lisi-access' } });
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.parkedAccounts.map((a) => a.userId)).toEqual([2]);

    let switchResult: Awaited<ReturnType<typeof result.current.switchAccount>> | undefined;
    await act(async () => {
      switchResult = await result.current.switchAccount(2);
    });

    expect(switchResult?.ok).toBe(true);
    expect(mockRequest.post).toHaveBeenCalledWith(
      '/api/auth/refresh',
      { refreshToken: 'lisi-refresh' },
      expect.objectContaining({ silent: true, skipAuth: true }),
    );
    // 槽位切换为目标账号凭证
    expect(localStorage.getItem(TOKEN_KEY)).toBe('lisi-access');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('lisi-refresh');
    // 原账号带最新 refreshToken 停靠，目标账号移出停靠区
    const parked = listParkedAccounts();
    expect(parked.map((a) => a.userId)).toEqual([1]);
    expect(parked[0].refreshToken).toBe('admin-refresh');
    // 跟随账号的本地状态被清除，整页重载被触发
    expect(localStorage.getItem(PREFERENCES_KEY)).toBeNull();
    expect(localStorage.getItem(TABS_STORAGE_KEY)).toBeNull();
    expect(vi.mocked(broadcastSwitchAndReload)).toHaveBeenCalledTimes(1);
  });

  it('drops an expired parked account and reports expired without touching current session', async () => {
    localStorage.setItem(TOKEN_KEY, 'admin-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'admin-refresh');
    parkLisi();
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    mockRequest.post.mockResolvedValueOnce({ code: 401, message: 'refresh token 已过期', data: null });
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    let switchResult: Awaited<ReturnType<typeof result.current.switchAccount>> | undefined;
    await act(async () => {
      switchResult = await result.current.switchAccount(2);
    });

    expect(switchResult?.ok).toBe(false);
    expect(switchResult?.expired).toBe(true);
    expect(switchResult?.username).toBe('lisi');
    expect(listParkedAccounts()).toEqual([]);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('admin-token');
    expect(vi.mocked(broadcastSwitchAndReload)).not.toHaveBeenCalled();
  });

  it('keeps the parked account on network failure', async () => {
    localStorage.setItem(TOKEN_KEY, 'admin-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'admin-refresh');
    parkLisi();
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    mockRequest.post.mockResolvedValueOnce({ code: -1, message: '网络请求失败', data: null });
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    let switchResult: Awaited<ReturnType<typeof result.current.switchAccount>> | undefined;
    await act(async () => {
      switchResult = await result.current.switchAccount(2);
    });

    expect(switchResult?.ok).toBe(false);
    expect(switchResult?.expired).toBeUndefined();
    expect(listParkedAccounts().map((a) => a.userId)).toEqual([2]);
  });

  it('adds an account: parks the current one and activates the new identity', async () => {
    localStorage.setItem(TOKEN_KEY, 'admin-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'admin-refresh');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    mockRequest.post.mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: {
        token: { accessToken: 'lisi-access', refreshToken: 'lisi-refresh' },
        user: { id: 2, username: 'lisi', nickname: '李四' },
      },
    });
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => {
      await result.current.login('lisi', 'password', undefined, undefined, undefined, { addAccount: true });
    });

    expect(localStorage.getItem(TOKEN_KEY)).toBe('lisi-access');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('lisi-refresh');
    const parked = listParkedAccounts();
    expect(parked.map((a) => a.userId)).toEqual([1]);
    expect(parked[0].refreshToken).toBe('admin-refresh');
    expect(vi.mocked(broadcastSwitchAndReload)).toHaveBeenCalledTimes(1);
    // 添加账号走整页重载，不应触发 SPA 内的 /me 重取
    expect(mockRequest.get).toHaveBeenCalledTimes(1);
  });

  it('falls back to the most recent parked account on logout', async () => {
    localStorage.setItem(TOKEN_KEY, 'admin-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'admin-refresh');
    parkLisi();
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    mockRequest.post.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') return { code: 0, message: 'ok', data: { accessToken: 'lisi-access' } };
      return { code: 0, message: 'ok', data: null };
    });
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    act(() => result.current.logout());

    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBe('lisi-access'));
    expect(mockRequest.post).toHaveBeenCalledWith('/api/auth/logout', undefined, expect.objectContaining({ skipAuth: true }));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('lisi-refresh');
    expect(listParkedAccounts()).toEqual([]);
    expect(vi.mocked(broadcastSwitchAndReload)).toHaveBeenCalledTimes(1);
  });

  it('removes a parked account and revokes its session server-side', async () => {
    localStorage.setItem(TOKEN_KEY, 'admin-token');
    parkLisi();
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    mockRequest.post.mockResolvedValue({ code: 0, message: 'ok', data: null });
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => {
      await result.current.removeAccount(2);
    });

    expect(mockRequest.post).toHaveBeenCalledWith(
      '/api/auth/logout-by-refresh',
      { refreshToken: 'lisi-refresh' },
      expect.objectContaining({ silent: true, skipAuth: true }),
    );
    expect(listParkedAccounts()).toEqual([]);
    await waitFor(() => expect(result.current.parkedAccounts).toEqual([]));
    expect(localStorage.getItem(TOKEN_KEY)).toBe('admin-token');
  });

  it('logs out all accounts: revokes every parked session and goes anonymous', async () => {
    localStorage.setItem(TOKEN_KEY, 'admin-token');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'admin-refresh');
    parkLisi();
    parkAccount({ userId: 3, username: 'wangwu', nickname: '王五', refreshToken: 'wangwu-refresh', lastUsedAt: 2000 });
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    mockRequest.post.mockResolvedValue({ code: 0, message: 'ok', data: null });
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => {
      await result.current.logoutAllAccounts();
    });

    expect(mockRequest.post).toHaveBeenCalledWith('/api/auth/logout-by-refresh', { refreshToken: 'lisi-refresh' }, expect.objectContaining({ skipAuth: true }));
    expect(mockRequest.post).toHaveBeenCalledWith('/api/auth/logout-by-refresh', { refreshToken: 'wangwu-refresh' }, expect.objectContaining({ skipAuth: true }));
    expect(mockRequest.post).toHaveBeenCalledWith('/api/auth/logout', undefined, expect.objectContaining({ skipAuth: true }));
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(listParkedAccounts()).toEqual([]);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('reloads the page when another tab broadcasts an account switch', async () => {
    localStorage.setItem(TOKEN_KEY, 'admin-token');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    const { result } = renderAuthHook();
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    act(() => {
      globalThis.dispatchEvent(new StorageEvent('storage', {
        key: ACCOUNT_SWITCH_BROADCAST_KEY,
        oldValue: null,
        newValue: String(Date.now()),
      }));
    });

    expect(vi.mocked(reloadForExternalAccountSwitch)).toHaveBeenCalledTimes(1);
  });

  it('deduplicates the active user from the parked registry after any login path', async () => {
    localStorage.setItem(TOKEN_KEY, 'admin-token');
    // 模拟 OAuth 回调等路径直接写槽位后，同一账号仍残留在停靠区
    parkAccount({ userId: 1, username: 'admin', nickname: '管理员', refreshToken: 'stale-refresh', lastUsedAt: 500 });
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    const { result } = renderAuthHook();

    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    await waitFor(() => expect(listParkedAccounts()).toEqual([]));
  });
});
