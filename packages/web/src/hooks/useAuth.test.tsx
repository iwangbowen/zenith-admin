/**
 * useAuth hook 单元测试
 *
 * 覆盖要点：
 *  1. 初始无 token  → user = null，loading 最终为 false
 *  2. 有 token + 接口成功 → user 被设置，permissions 正确
 *  3. 有 token + 接口失败 → token 被清除，user = null
 *  4. 有 token + 接口抛出异常 → token 被清除，user = null
 *  5. login() 成功 → 保存 accessToken / refreshToken，fetchUser 被触发
 *  6. logout() → 立即清除 localStorage，user 置空
 *  7. updateUser() → 更新 user 状态（不触发网络请求）
 *
 * Mock 策略：
 *  - vi.mock '@/utils/request' 拦截所有 HTTP 请求
 *  - localStorage 由 jsdom 提供，beforeEach 调用 localStorage.clear() 隔离
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import { useAuth } from './useAuth';

// ─── Mock request ─────────────────────────────────────────────────────────────
vi.mock('@/utils/request', () => ({
  request: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// 动态导入 mock，避免循环依赖顺序问题
import { request } from '@/utils/request';
const mockRequest = vi.mocked(request);

// ─── 辅助：构造 /api/auth/me 的成功响应 ───────────────────────────────────────
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

// ─── Setup ───────────────────────────────────────────────────────────────────
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('初始化', () => {
  it('无 token 时 user 为 null，加载完成后 loading 为 false', async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(result.current.permissions).toEqual([]);
    // 无 token 时不应发起网络请求
    expect(mockRequest.get).not.toHaveBeenCalled();
  });

  it('有 token 且接口成功时设置 user 和 permissions', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid-token');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user?.username).toBe('admin');
    expect(result.current.user?.nickname).toBe('管理员');
    expect(result.current.permissions).toContain('user:read');
    expect(result.current.permissions).toContain('role:read');
  });

  it('有 token 但接口返回非 0 时清除 token，user 为 null', async () => {
    localStorage.setItem(TOKEN_KEY, 'expired-token');
    mockRequest.get.mockResolvedValueOnce({
      code: 401,
      message: 'Unauthorized',
      data: null,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  it('有 token 但接口抛出异常时清除 token，user 为 null', async () => {
    localStorage.setItem(TOKEN_KEY, 'bad-token');
    mockRequest.get.mockRejectedValueOnce(new Error('Network Error'));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe('login()', () => {
  it('登录成功后保存 token 并触发 fetchUser', async () => {
    // 第一次 GET（login 后调 fetchUser）
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    mockRequest.post.mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: {
        token: { accessToken: 'new-access-token', refreshToken: 'new-refresh-token' },
        user: { id: 1 },
      },
    });

    const { result } = renderHook(() => useAuth());
    // 等待初始 loading:false（无 token 场景）
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.login('admin', 'password');
    });

    expect(localStorage.getItem(TOKEN_KEY)).toBe('new-access-token');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('new-refresh-token');
    expect(result.current.user?.username).toBe('admin');
  });

  it('登录失败时不保存 token，返回错误响应', async () => {
    mockRequest.post.mockResolvedValueOnce({
      code: 400,
      message: '用户名或密码错误',
      data: null,
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response: { code: number } | undefined;
    await act(async () => {
      response = await result.current.login('admin', 'wrong');
    });

    expect(response?.code).toBe(400);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(result.current.user).toBeNull();
  });
});

describe('logout()', () => {
  it('立即清除 localStorage 的 token 并将 user 置空', async () => {
    localStorage.setItem(TOKEN_KEY, 'some-token');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());
    // logout 会 fire-and-forget 调用 POST /api/auth/logout，需要提供 mock 防止未处理的 rejection
    mockRequest.post.mockResolvedValue({ code: 0, message: 'success', data: null });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user).not.toBeNull());

    act(() => {
      result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });
});

describe('register()', () => {
  it('注册成功后保存 token 并触发 fetchUser', async () => {
    mockRequest.post.mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: {
        token: { accessToken: 'reg-access', refreshToken: 'reg-refresh' },
        user: { id: 2 },
      },
    });
    mockRequest.get.mockResolvedValueOnce(
      makeMeResponse({ id: 2, username: 'newuser', nickname: '新用户' }),
    );

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.register({
        username: 'newuser',
        nickname: '新用户',
        email: 'new@example.com',
        password: 'Abc@1234',
      });
    });

    expect(localStorage.getItem(TOKEN_KEY)).toBe('reg-access');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('reg-refresh');
    expect(result.current.user?.username).toBe('newuser');
  });

  it('注册失败时不保存 token，返回错误响应', async () => {
    mockRequest.post.mockResolvedValueOnce({
      code: 400,
      message: '用户名已存在',
      data: null,
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response: { code: number } | undefined;
    await act(async () => {
      response = await result.current.register({
        username: 'dup',
        nickname: '重复',
        email: 'dup@example.com',
        password: 'pass',
      });
    });

    expect(response?.code).toBe(400);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe('updateUser()', () => {
  it('不触发网络请求，直接更新 user 状态', async () => {
    localStorage.setItem(TOKEN_KEY, 'some-token');
    mockRequest.get.mockResolvedValueOnce(makeMeResponse());

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user?.nickname).toBe('管理员'));

    act(() => {
      result.current.updateUser({
        id: 1,
        username: 'admin',
        nickname: '新昵称',
        email: 'admin@example.com',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        departmentId: null,
        tenantId: null,
        avatar: undefined,
        phone: null,
        remark: null,
        lastLoginAt: null,
        lastLoginIp: null,
      });
    });

    expect(result.current.user?.nickname).toBe('新昵称');
    // updateUser 不应触发额外的网络请求
    expect(mockRequest.get).toHaveBeenCalledTimes(1);
  });
});
