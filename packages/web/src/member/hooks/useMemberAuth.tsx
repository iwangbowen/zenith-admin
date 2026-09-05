import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { MEMBER_TOKEN_KEY, MEMBER_REFRESH_TOKEN_KEY } from '@zenith/shared/core';
import type { ApiResponse, BodyOf } from '@zenith/shared/core';
import { memberAuthContract, type Member, type MemberLoginResult } from '@zenith/shared/member';
import { urlOf } from '@/lib/contract-query';
import { prepareTrackerLogout } from '@/utils/tracker';
import { memberRequest } from '../utils/member-request';
import { memberQueryClient } from '../lib/member-query';

export type MemberLoginParams = BodyOf<typeof memberAuthContract.login>;

export type MemberRegisterParams = BodyOf<typeof memberAuthContract.register>;

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
      const res = await memberRequest.get<Member>(urlOf(memberAuthContract.me), { silent: true });
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
    // 直接消费响应包络：code / message 决定登录页的错误提示分支，不走 api() 解包
    const res = await memberRequest.post<MemberLoginResult>(urlOf(memberAuthContract.login), params satisfies BodyOf<typeof memberAuthContract.login>, { silent: true });
    if (res.code === 0) {
      localStorage.setItem(MEMBER_TOKEN_KEY, res.data.token.accessToken);
      localStorage.setItem(MEMBER_REFRESH_TOKEN_KEY, res.data.token.refreshToken);
      setState({ member: res.data.member, loading: false });
    }
    return res;
  }, []);

  const register = useCallback(async (params: MemberRegisterParams) => {
    const res = await memberRequest.post<MemberLoginResult>(urlOf(memberAuthContract.register), params satisfies BodyOf<typeof memberAuthContract.register>, { silent: true });
    if (res.code === 0) {
      localStorage.setItem(MEMBER_TOKEN_KEY, res.data.token.accessToken);
      localStorage.setItem(MEMBER_REFRESH_TOKEN_KEY, res.data.token.refreshToken);
      setState({ member: res.data.member, loading: false });
    }
    return res;
  }, []);

  const logout = useCallback(() => {
    // 请求构造会在本行同步读取当前 token，随后再清理本地身份。
    memberRequest.post(urlOf(memberAuthContract.logout), {}, { silent: true }).catch(() => {});
    // 退出前用当前会员 token 尽力发送旧身份事件，避免残留队列被下一个账号接管
    prepareTrackerLogout();
    localStorage.removeItem(MEMBER_TOKEN_KEY);
    localStorage.removeItem(MEMBER_REFRESH_TOKEN_KEY);
    memberQueryClient.clear();
    setState({ member: null, loading: false });
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
