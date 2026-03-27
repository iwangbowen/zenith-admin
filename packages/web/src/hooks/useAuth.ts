import { useState, useEffect, useCallback } from 'react';
import { request } from '@/utils/request';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import type { User, LoginResponse } from '@zenith/shared';

interface AuthState {
  user: Omit<User, 'password'> | null;
  permissions: string[];
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, permissions: [], loading: true });

  const fetchUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setState({ user: null, permissions: [], loading: false });
      return;
    }
    try {
      const res = await request.get<User & { permissions: string[] }>('/api/auth/me', { silent: true });
      if (res.code === 0) {
        const { permissions, ...userData } = res.data;
        setState({ user: userData, permissions: permissions ?? [], loading: false });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        setState({ user: null, permissions: [], loading: false });
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      setState({ user: null, permissions: [], loading: false });
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (username: string, password: string, captchaId?: string, captchaCode?: string) => {
    const res = await request.post<LoginResponse>('/api/auth/login', { username, password, captchaId, captchaCode }, { silent: true });
    if (res.code === 0) {
      localStorage.setItem(TOKEN_KEY, res.data.token.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, res.data.token.refreshToken);
      await fetchUser();
    }
    return res;
  };

  const register = async (data: { username: string; nickname: string; email: string; password: string }) => {
    const res = await request.post<LoginResponse>('/api/auth/register', data, { silent: true });
    if (res.code === 0) {
      localStorage.setItem(TOKEN_KEY, res.data.token.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, res.data.token.refreshToken);
      await fetchUser();
    }
    return res;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setState({ user: null, permissions: [], loading: false });
  };

  const updateUser = (user: Omit<User, 'password'>) => {
    setState((prev) => ({ ...prev, user }));
  };

  return { ...state, login, register, logout, refresh: fetchUser, updateUser };
}
