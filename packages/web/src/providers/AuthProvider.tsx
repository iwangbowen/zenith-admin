import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACCOUNT_SWITCH_BROADCAST_KEY,
  ACCOUNTS_STORE_KEY,
  MAX_STORED_ACCOUNTS,
  PREFERENCES_KEY,
  REFRESH_TOKEN_KEY,
  TABS_STORAGE_KEY,
  TOKEN_KEY,
} from '@zenith/shared/core';
import { authContract, type LoginResponse, type LoginResult } from '@zenith/shared/identity';
import { apiRaw } from '@/lib/contract-query';
import { AuthContext, type AuthContextValue, type AuthStatus } from '@/hooks/useAuth';
import { PermissionContext } from '@/hooks/usePermission';
import {
  AuthRejectedError,
  authKeys,
  authSessionQueryOptions,
  updateCachedAuthUser,
  type AuthSession,
} from '@/hooks/queries/auth';
import {
  broadcastSwitchAndReload,
  clearParkedAccounts,
  getParkedAccount,
  listParkedAccounts,
  parkAccount,
  reloadForExternalAccountSwitch,
  removeParkedAccount,
  takeParkedAccount,
  type StoredAccount,
} from '@/lib/account-store';
import { ADMIN_AUTH_INVALIDATED_EVENT } from '@/utils/request';
import { LOCK_SCREEN_STORAGE_KEYS } from '@/hooks/useLockScreen';

const DEVICE_ID_KEY = 'zenith_device_id';
const AUTH_PUBLIC_QUERY_ROOT = 'auth-public';

function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, value);
  return value;
}

function isLoginResponse(data: LoginResult): data is LoginResponse {
  return 'token' in data;
}

/** 清除跟随账号的本地状态（偏好缓存、多标签页、锁屏凭证），账号切换与退出共用 */
function clearAccountScopedData(): void {
  localStorage.removeItem(PREFERENCES_KEY);
  localStorage.removeItem(TABS_STORAGE_KEY);
  for (const key of LOCK_SCREEN_STORAGE_KEYS) localStorage.removeItem(key);
}

function clearStoredUserData(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  clearAccountScopedData();
}

function collectDeviceInfo(): Record<string, unknown> | undefined {
  try {
    const screen = window.screen;
    const nav = navigator as Navigator & { deviceMemory?: number };
    let gpu: string | undefined;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
      if (gl) {
        const ext = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          gpu = (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL) as string || undefined;
        }
      }
    } catch { /* Best-effort device metadata. */ }
    return {
      screenWidth: screen.width,
      screenHeight: screen.height,
      // 保留 2 位小数：浏览器缩放会产生 1.1000000238418579 之类的长小数，后端列为 varchar(8)
      devicePixelRatio: String(Math.round((window.devicePixelRatio ?? 1) * 100) / 100),
      ...(gpu ? { gpu } : {}),
      ...(nav.hardwareConcurrency ? { cpuCores: nav.hardwareConcurrency } : {}),
      ...(nav.deviceMemory ? { memoryGb: String(nav.deviceMemory) } : {}),
    };
  } catch {
    return undefined;
  }
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();
  const initialCredentials = Boolean(localStorage.getItem(TOKEN_KEY));
  const [hasCredentials, setHasCredentials] = useState(initialCredentials);
  const hasCredentialsRef = useRef(initialCredentials);
  const previousCredentialsRef = useRef(initialCredentials);

  const sessionQuery = useQuery({
    ...authSessionQueryOptions(),
    enabled: hasCredentials,
  });

  const setCredentialPresence = useCallback((present: boolean) => {
    hasCredentialsRef.current = present;
    setHasCredentials(present);
  }, []);

  const clearIdentityCache = useCallback(async () => {
    const predicate = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== AUTH_PUBLIC_QUERY_ROOT;
    await queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
    queryClient.getMutationCache().clear();
  }, [queryClient]);

  const transitionToAnonymous = useCallback(() => {
    setCredentialPresence(false);
    clearStoredUserData();
    void queryClient.cancelQueries({ queryKey: authKeys.all });
  }, [queryClient, setCredentialPresence]);

  const fetchCurrentSession = useCallback(async () => {
    if (!hasCredentialsRef.current) return;
    try {
      await queryClient.fetchQuery({ ...authSessionQueryOptions(), staleTime: 0 });
    } catch (error) {
      if (error instanceof AuthRejectedError) transitionToAnonymous();
    }
  }, [queryClient, transitionToAnonymous]);

  const activateSession = useCallback(async (token: LoginResponse['token']) => {
    hasCredentialsRef.current = true;
    await clearIdentityCache();
    localStorage.setItem(TOKEN_KEY, token.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, token.refreshToken);
    setHasCredentials(true);
    await fetchCurrentSession();
  }, [clearIdentityCache, fetchCurrentSession]);

  // ─── 账号切换器 ────────────────────────────────────────────────────
  const [parkedAccounts, setParkedAccounts] = useState<StoredAccount[]>(() => listParkedAccounts());
  const syncParkedAccounts = useCallback(() => setParkedAccounts(listParkedAccounts()), []);

  /** 把当前活跃账号快照为可停靠账号（凭证取槽位最新值，资料取 /me 缓存） */
  const snapshotCurrentAccount = useCallback((): StoredAccount | null => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;
    const cached = queryClient.getQueryData<AuthSession>(authKeys.me);
    const u = cached?.user;
    if (!u) return null;
    return {
      userId: u.id,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar ?? undefined,
      tenantName: u.tenantName ?? null,
      refreshToken,
      lastUsedAt: Date.now(),
    };
  }, [queryClient]);

  /** 添加账号模式登录成功：停靠原账号 → 写入新账号凭证 → 整页重载 */
  const activateAddedAccount = useCallback((data: LoginResponse) => {
    const current = snapshotCurrentAccount();
    if (current && current.userId !== data.user.id) parkAccount(current);
    removeParkedAccount(data.user.id);
    localStorage.setItem(TOKEN_KEY, data.token.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.token.refreshToken);
    clearAccountScopedData();
    broadcastSwitchAndReload();
  }, [snapshotCurrentAccount]);

  const switchAccount = useCallback<AuthContextValue['switchAccount']>(async (userId) => {
    const target = getParkedAccount(userId);
    if (!target) return { ok: false, message: '该账号不在已登录列表中' };
    // 用停靠的 refreshToken 换发新令牌：既拿到凭证也校验了会话有效性（服务端会轮换 refreshToken，旧值随即失效）
    const res = await apiRaw(authContract.refresh, { body: { refreshToken: target.refreshToken } }, { silent: true, skipAuth: true });
    if (res.code !== 0 || !res.data?.accessToken) {
      if (res.code === -1) return { ok: false, message: res.message || '网络异常，切换失败，请稍后重试' };
      // 会话已失效（过期 / 被管理员下线）：移除死账号并引导重新登录
      removeParkedAccount(userId);
      syncParkedAccounts();
      return { ok: false, expired: true, username: target.username, message: res.message || '该账号登录状态已失效，请重新登录' };
    }
    const current = snapshotCurrentAccount();
    takeParkedAccount(userId);
    if (current && current.userId !== userId) parkAccount(current);
    localStorage.setItem(TOKEN_KEY, res.data.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, res.data.refreshToken ?? target.refreshToken);
    clearAccountScopedData();
    broadcastSwitchAndReload();
    return { ok: true };
  }, [snapshotCurrentAccount, syncParkedAccounts]);

  /** 退出当前账号后自动切到最近使用的停靠账号；全部失效则回登录页 */
  const switchToNextParked = useCallback(async () => {
    for (;;) {
      const next = listParkedAccounts()[0];
      if (!next) {
        transitionToAnonymous();
        return;
      }
      const res = await apiRaw(authContract.refresh, { body: { refreshToken: next.refreshToken } }, { silent: true, skipAuth: true });
      if (res.code === 0 && res.data?.accessToken) {
        takeParkedAccount(next.userId);
        localStorage.setItem(TOKEN_KEY, res.data.accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, res.data.refreshToken ?? next.refreshToken);
        clearAccountScopedData();
        broadcastSwitchAndReload();
        return;
      }
      if (res.code === -1) {
        // 网络异常：不误删可能仍有效的会话，回登录页（登录页保留快捷入口）
        transitionToAnonymous();
        return;
      }
      removeParkedAccount(next.userId);
    }
  }, [transitionToAnonymous]);

  const removeAccount = useCallback<AuthContextValue['removeAccount']>(async (userId) => {
    const target = getParkedAccount(userId);
    if (!target) return;
    // 服务端按 refreshToken 注销对应会话；网络失败也照常移除本地条目
    await apiRaw(authContract.logoutByRefresh, { body: { refreshToken: target.refreshToken } }, { silent: true, skipAuth: true }).catch(() => {});
    removeParkedAccount(userId);
    syncParkedAccounts();
  }, [syncParkedAccounts]);

  const logoutAllAccounts = useCallback<AuthContextValue['logoutAllAccounts']>(async () => {
    const parked = listParkedAccounts();
    await Promise.allSettled(parked.map((a) =>
      apiRaw(authContract.logoutByRefresh, { body: { refreshToken: a.refreshToken } }, { silent: true, skipAuth: true }),
    ));
    clearParkedAccounts();
    syncParkedAccounts();
    apiRaw(authContract.logout, { silent: true, skipAuth: true }).catch(() => {});
    transitionToAnonymous();
  }, [syncParkedAccounts, transitionToAnonymous]);

  // 任何路径（含 OAuth / SSO 回调）登录后，若当前用户仍留在停靠区则去重
  useEffect(() => {
    const uid = sessionQuery.data?.user?.id;
    if (uid == null) return;
    if (getParkedAccount(uid)) {
      removeParkedAccount(uid);
      syncParkedAccounts();
    }
  }, [sessionQuery.data, syncParkedAccounts]);

  useEffect(() => {
    const wasAuthenticated = previousCredentialsRef.current;
    previousCredentialsRef.current = hasCredentials;
    if (hasCredentials || !wasAuthenticated) return;

    let active = true;
    void clearIdentityCache().then(() => {
      if (active && !hasCredentialsRef.current) {
        queryClient.removeQueries({ queryKey: authKeys.all });
      }
    });
    return () => { active = false; };
  }, [clearIdentityCache, hasCredentials, queryClient]);

  useEffect(() => {
    if (sessionQuery.error instanceof AuthRejectedError) transitionToAnonymous();
  }, [sessionQuery.error, transitionToAnonymous]);

  useEffect(() => {
    const handleInvalidated = () => transitionToAnonymous();
    globalThis.addEventListener(ADMIN_AUTH_INVALIDATED_EVENT, handleInvalidated);
    return () => globalThis.removeEventListener(ADMIN_AUTH_INVALIDATED_EVENT, handleInvalidated);
  }, [transitionToAnonymous]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      // 其他标签页切换了账号：整页重载为新账号，避免旧界面发新账号请求
      if (event.key === ACCOUNT_SWITCH_BROADCAST_KEY && event.newValue) {
        reloadForExternalAccountSwitch();
        return;
      }
      if (event.key === ACCOUNTS_STORE_KEY) {
        syncParkedAccounts();
        return;
      }
      if (event.key !== TOKEN_KEY) return;
      if (!event.newValue) {
        transitionToAnonymous();
        return;
      }
      if (!hasCredentialsRef.current) {
        hasCredentialsRef.current = true;
        void clearIdentityCache().then(() => {
          if (!localStorage.getItem(TOKEN_KEY)) {
            transitionToAnonymous();
            return;
          }
          setHasCredentials(true);
          void fetchCurrentSession();
        });
      }
    };
    globalThis.addEventListener('storage', handleStorage);
    return () => globalThis.removeEventListener('storage', handleStorage);
  }, [clearIdentityCache, fetchCurrentSession, syncParkedAccounts, transitionToAnonymous]);

  const login = useCallback<AuthContextValue['login']>(async (
    username,
    password,
    captchaId,
    captchaCode,
    tenantCode,
    options,
  ) => {
    // 登录类接口保留原始响应包络：限流 429 的 retryAfterSeconds 由登录页展示倒计时，不能被 api() 解包吞掉
    const res = await apiRaw(authContract.login, {
      body: {
        username,
        password,
        captchaId,
        captchaCode,
        tenantCode,
        deviceInfo: collectDeviceInfo(),
        deviceId: getDeviceId(),
        rememberDevice: true,
      },
    }, { silent: true });
    if (res.code === 0 && isLoginResponse(res.data)) {
      if (options?.addAccount) activateAddedAccount(res.data);
      else await activateSession(res.data.token);
    }
    return res;
  }, [activateAddedAccount, activateSession]);

  const verifyMfaLogin = useCallback<AuthContextValue['verifyMfaLogin']>(async (
    challengeId,
    code,
    rememberDevice,
    options,
  ) => {
    const res = await apiRaw(authContract.mfaVerify, { body: { challengeId, code, rememberDevice } }, { silent: true });
    if (res.code === 0) {
      if (options?.addAccount) activateAddedAccount(res.data);
      else await activateSession(res.data.token);
    }
    return res;
  }, [activateAddedAccount, activateSession]);

  const register = useCallback<AuthContextValue['register']>(async (data, options) => {
    const res = await apiRaw(authContract.register, { body: data }, { silent: true });
    if (res.code === 0) {
      if (options?.addAccount) activateAddedAccount(res.data);
      else await activateSession(res.data.token);
    }
    return res;
  }, [activateAddedAccount, activateSession]);

  const logout = useCallback(() => {
    apiRaw(authContract.logout, { silent: true, skipAuth: true }).catch(() => {});
    // 还有停靠账号时对齐 GitHub：退出当前账号后自动回落到最近使用的账号
    if (listParkedAccounts().length > 0) {
      void switchToNextParked();
      return;
    }
    transitionToAnonymous();
  }, [switchToNextParked, transitionToAnonymous]);

  const refresh = useCallback(async () => {
    await fetchCurrentSession();
  }, [fetchCurrentSession]);

  const updateUser = useCallback<AuthContextValue['updateUser']>((user) => {
    updateCachedAuthUser(queryClient, user);
  }, [queryClient]);

  const session = hasCredentials ? sessionQuery.data : undefined;
  let status: AuthStatus;
  if (!hasCredentials) status = 'anonymous';
  else if (session) status = 'authenticated';
  // 401 由上面的 effect 立即切到 anonymous，这一帧继续显示加载态，避免闪一下「连不上服务器」
  else if (sessionQuery.error instanceof AuthRejectedError) status = 'checking';
  // 失败过就停在 unavailable：无数据的查询重新 fetch 时，TanStack Query 会把 status 重置回 pending
  // 并清空 error，若据此判为 checking，点「重试」会整页闪回加载点再弹回错误页；
  // errorUpdatedAt 不参与这次重置，是「曾经失败」的稳定信号
  else if (sessionQuery.errorUpdatedAt > 0) status = 'unavailable';
  else if (sessionQuery.isFetching || sessionQuery.isPending) status = 'checking';
  else status = 'unavailable';

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    permissions: session?.permissions ?? [],
    status,
    loading: status === 'checking',
    refreshing: sessionQuery.isFetching,
    error: sessionQuery.error,
    parkedAccounts,
    canAddAccount: parkedAccounts.length + (session?.user ? 1 : 0) < MAX_STORED_ACCOUNTS,
    login,
    verifyMfaLogin,
    register,
    logout,
    refresh,
    updateUser,
    switchAccount,
    removeAccount,
    logoutAllAccounts,
  }), [
    login,
    logout,
    logoutAllAccounts,
    parkedAccounts,
    refresh,
    register,
    removeAccount,
    session,
    sessionQuery.error,
    sessionQuery.isFetching,
    status,
    switchAccount,
    updateUser,
    verifyMfaLogin,
  ]);

  return (
    <AuthContext.Provider value={value}>
      <PermissionContext.Provider value={value.permissions}>
        {children}
      </PermissionContext.Provider>
    </AuthContext.Provider>
  );
}
