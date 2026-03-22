import { useState, useEffect, useCallback } from 'react';
import { request } from '../utils/request';
import { TOKEN_KEY } from '@zenith/shared';
import type { User, LoginResponse } from '@zenith/shared';

interface AuthState {
  user: Omit<User, 'password'> | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  const fetchUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setState({ user: null, loading: false });
      return;
    }
    try {
      const res = await request.get<User>('/api/auth/me');
      if (res.code === 0) {
        setState({ user: res.data, loading: false });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setState({ user: null, loading: false });
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setState({ user: null, loading: false });
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (username: string, password: string) => {
    const res = await request.post<LoginResponse>('/api/auth/login', { username, password });
    if (res.code === 0) {
      localStorage.setItem(TOKEN_KEY, res.data.token.accessToken);
      setState({ user: res.data.user, loading: false });
    }
    return res;
  };

  const register = async (data: { username: string; nickname: string; email: string; password: string }) => {
    const res = await request.post<LoginResponse>('/api/auth/register', data);
    if (res.code === 0) {
      localStorage.setItem(TOKEN_KEY, res.data.token.accessToken);
      setState({ user: res.data.user, loading: false });
    }
    return res;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setState({ user: null, loading: false });
  };

  return { ...state, login, register, logout, refresh: fetchUser };
}
