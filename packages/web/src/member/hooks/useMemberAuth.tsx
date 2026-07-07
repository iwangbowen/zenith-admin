import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { MEMBER_TOKEN_KEY, MEMBER_REFRESH_TOKEN_KEY } from '@zenith/shared';
import type { ApiResponse, Member, MemberLoginResult } from '@zenith/shared';
import { memberRequest } from '../utils/member-request';
import { memberQueryClient } from '../lib/member-query';

export interface MemberLoginParams {
  loginType: 'password' | 'sms';
  account?: string;
  password?: string;
  phone?: string;
  smsCode?: string;
}

export interface MemberRegisterParams {
  username?: string;
  phone?: string;
  email?: string;
  password?: string;
  smsCode?: string;
  nickname?: string;
  inviteCode?: string;
}

interface MemberAuthState {
  member: Member | null;
  loading: boolean;
}

interface MemberAuthContextValue extends MemberAuthState {
  login: (params: MemberLoginParams) => Promise<ApiResponse<MemberLoginResult>>;
  register: (params: MemberRegisterParams) => Promise<ApiResponse<MemberLoginResult>>;
  logout: () => void;
  refresh: () => Promise<void>;
  updateMember: (member: Member) => void;
}

const MemberAuthContext = createContext<MemberAuthContextValue | null>(null);

export function MemberAuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<MemberAuthState>({ member: null, loading: true });

  const fetchMember = useCallback(async () => {
    const token = localStorage.getItem(MEMBER_TOKEN_KEY);
    if (!token) {
      setState({ member: null, loading: false });
      return;
    }
    try {
      const res = await memberRequest.get<Member>('/api/member/auth/me', { silent: true });
      if (res.code === 0) {
        setState({ member: res.data, loading: false });
      } else if (res.code === -1) {
        // 网络错误（如后端未就绪），不清除 token，只重置 loading
        setState((prev) => ({ ...prev, loading: false }));
      } else {
        localStorage.removeItem(MEMBER_TOKEN_KEY);
        localStorage.removeItem(MEMBER_REFRESH_TOKEN_KEY);
        setState({ member: null, loading: false });
      }
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchMember();
  }, [fetchMember]);

  const login = useCallback(async (params: MemberLoginParams) => {
    const res = await memberRequest.post<MemberLoginResult>('/api/member/auth/login', params, { silent: true });
    if (res.code === 0) {
      localStorage.setItem(MEMBER_TOKEN_KEY, res.data.token.accessToken);
      localStorage.setItem(MEMBER_REFRESH_TOKEN_KEY, res.data.token.refreshToken);
      setState({ member: res.data.member, loading: false });
    }
    return res;
  }, []);

  const register = useCallback(async (params: MemberRegisterParams) => {
    const res = await memberRequest.post<MemberLoginResult>('/api/member/auth/register', params, { silent: true });
    if (res.code === 0) {
      localStorage.setItem(MEMBER_TOKEN_KEY, res.data.token.accessToken);
      localStorage.setItem(MEMBER_REFRESH_TOKEN_KEY, res.data.token.refreshToken);
      setState({ member: res.data.member, loading: false });
    }
    return res;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(MEMBER_TOKEN_KEY);
    localStorage.removeItem(MEMBER_REFRESH_TOKEN_KEY);
    memberQueryClient.clear();
    setState({ member: null, loading: false });
    // best-effort 通知服务端删除会话
    memberRequest.post('/api/member/auth/logout', {}, { silent: true }).catch(() => {});
  }, []);

  const updateMember = useCallback((member: Member) => {
    setState((prev) => ({ ...prev, member }));
  }, []);

  // 稳定引用：避免 Provider 每次渲染都生成新 value 导致所有消费组件级联重渲染
  const value = useMemo(
    () => ({ ...state, login, register, logout, refresh: fetchMember, updateMember }),
    [state, login, register, logout, fetchMember, updateMember],
  );

  return (
    <MemberAuthContext.Provider value={value}>
      {children}
    </MemberAuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMemberAuth(): MemberAuthContextValue {
  const ctx = useContext(MemberAuthContext);
  if (!ctx) {
    throw new Error('useMemberAuth 必须在 MemberAuthProvider 内使用');
  }
  return ctx;
}
