import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LoginLog,
  MfaFactor,
  OAuthAccount,
  OAuthProviderType,
  OperationLog,
  PaginatedResponse,
  TotpSetupResult,
  User,
  UserApiToken,
  UserApiTokenCreated,
  UserSession,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';
import type { PasswordPolicy } from '@/utils/password-policy';

export interface ProfileLogParams {
  page: number;
  pageSize: number;
}

export interface UpdateProfilePayload {
  nickname?: string;
  email?: string;
  phone?: string;
  gender?: string | null;
  avatar?: string | null;
}

export const profileKeys = {
  all: ['profile'] as const,
  passwordPolicy: ['profile', 'password-policy'] as const,
  oauthAccounts: ['profile', 'oauth-accounts'] as const,
  mfaFactors: ['profile', 'mfa-factors'] as const,
  sessions: ['profile', 'sessions'] as const,
  loginLogs: ['profile', 'login-logs'] as const,
  loginLogList: (params: ProfileLogParams) => ['profile', 'login-logs', params] as const,
  operationLogs: ['profile', 'operation-logs'] as const,
  operationLogList: (params: ProfileLogParams) => ['profile', 'operation-logs', params] as const,
  apiTokens: ['profile', 'api-tokens'] as const,
};

export function useProfilePasswordPolicy() {
  return useQuery({
    queryKey: profileKeys.passwordPolicy,
    queryFn: () => request.get<PasswordPolicy>('/api/system-configs/password-policy').then(unwrap),
  });
}

export function useProfileOauthAccounts(enabled = true) {
  return useQuery({
    queryKey: profileKeys.oauthAccounts,
    queryFn: () => request.get<OAuthAccount[]>('/api/auth/oauth/accounts').then(unwrap),
    enabled,
  });
}

export function useProfileMfaFactors(enabled = true) {
  return useQuery({
    queryKey: profileKeys.mfaFactors,
    queryFn: () => request.get<MfaFactor[]>('/api/auth/mfa/factors').then(unwrap),
    enabled,
  });
}

export function useProfileSessions(enabled = true) {
  return useQuery({
    queryKey: profileKeys.sessions,
    queryFn: () => request.get<UserSession[]>('/api/auth/my-sessions').then(unwrap),
    enabled,
  });
}

export function useProfileLoginLogs(params: ProfileLogParams, enabled = true) {
  return useQuery({
    queryKey: profileKeys.loginLogList(params),
    queryFn: () =>
      request.get<PaginatedResponse<LoginLog>>(`/api/auth/my-login-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useProfileOperationLogs(params: ProfileLogParams, enabled = true) {
  return useQuery({
    queryKey: profileKeys.operationLogList(params),
    queryFn: () =>
      request
        .get<PaginatedResponse<OperationLog>>(`/api/auth/my-operation-logs${toQueryString(params)}`)
        .then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useProfileApiTokens(enabled = true) {
  return useQuery({
    queryKey: profileKeys.apiTokens,
    queryFn: () => request.get<UserApiToken[]>('/api/api-tokens').then(unwrap),
    enabled,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: UpdateProfilePayload) => request.put<Omit<User, 'password'>>('/api/auth/profile', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.all }),
  });
}

export function useChangeProfilePassword() {
  return useMutation({
    mutationFn: (values: { oldPassword: string; newPassword: string }) =>
      request.put<null>('/api/auth/password', values).then(unwrap),
  });
}

export function useProfileOAuthBindUrl() {
  return useMutation({
    mutationFn: (provider: OAuthProviderType) =>
      request.get<{ authUrl: string; state: string }>(`/api/auth/oauth/${provider}`).then(unwrap),
  });
}

export function useUnbindProfileOAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: OAuthProviderType) => request.delete<null>(`/api/auth/oauth/unbind/${provider}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.oauthAccounts }),
  });
}

export function useBeginTotpSetup() {
  return useMutation({
    mutationFn: () => request.post<TotpSetupResult>('/api/auth/mfa/totp/setup').then(unwrap),
  });
}

export function useVerifyTotpSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { factorId: number; code: string }) =>
      request.post<null>('/api/auth/mfa/totp/verify', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.mfaFactors }),
  });
}

export function useDisableMfaFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/auth/mfa/factors/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.mfaFactors }),
  });
}

export function useKickOtherProfileSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request.delete<{ count: number }>('/api/auth/my-sessions/others').then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.sessions }),
  });
}

export function useKickProfileSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => request.delete<null>(`/api/auth/my-sessions/${tokenId}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.sessions }),
  });
}

export function useCreateApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { name: string; expiresAt?: string }) =>
      request.post<UserApiTokenCreated>('/api/api-tokens', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.apiTokens }),
  });
}

export function useDeleteApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/api-tokens/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.apiTokens }),
  });
}
