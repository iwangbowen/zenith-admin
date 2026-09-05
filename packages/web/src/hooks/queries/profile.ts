import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { apiTokenContract, authContract, oauthContract } from '@zenith/shared/identity';
import { systemConfigContract } from '@zenith/shared/platform';
import { api, useApiMutation } from '@/lib/contract-query';
import { updateCachedAuthUser } from './auth';

export type ProfileLoginLogParams = NonNullable<QueryOf<typeof authContract.myLoginLogs>>;

export type ProfileOperationLogParams = NonNullable<QueryOf<typeof authContract.myOperationLogs>>;

export const profileKeys = {
  all: ['profile'] as const,
  passwordPolicy: ['profile', 'password-policy'] as const,
  oauthAccounts: ['profile', 'oauth-accounts'] as const,
  mfaFactors: ['profile', 'mfa-factors'] as const,
  sessions: ['profile', 'sessions'] as const,
  loginLogs: ['profile', 'login-logs'] as const,
  loginLogList: (params: ProfileLoginLogParams) => ['profile', 'login-logs', params] as const,
  operationLogs: ['profile', 'operation-logs'] as const,
  operationLogList: (params: ProfileOperationLogParams) => ['profile', 'operation-logs', params] as const,
  apiTokens: ['profile', 'api-tokens'] as const,
};

export function useProfilePasswordPolicy() {
  return useQuery({
    queryKey: profileKeys.passwordPolicy,
    queryFn: () => api(systemConfigContract.passwordPolicy),
  });
}

export function useProfileOauthAccounts(enabled = true) {
  return useQuery({
    queryKey: profileKeys.oauthAccounts,
    queryFn: () => api(oauthContract.accounts),
    enabled,
  });
}

export function useProfileMfaFactors(enabled = true) {
  return useQuery({
    queryKey: profileKeys.mfaFactors,
    queryFn: () => api(authContract.mfaFactors),
    enabled,
  });
}

export function useProfileSessions(enabled = true) {
  return useQuery({
    queryKey: profileKeys.sessions,
    queryFn: () => api(authContract.mySessions),
    enabled,
  });
}

export function useProfileLoginLogs(params: ProfileLoginLogParams, enabled = true) {
  return useQuery({
    queryKey: profileKeys.loginLogList(params),
    queryFn: () => api(authContract.myLoginLogs, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useProfileOperationLogs(params: ProfileOperationLogParams, enabled = true) {
  return useQuery({
    queryKey: profileKeys.operationLogList(params),
    queryFn: () => api(authContract.myOperationLogs, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useProfileApiTokens(enabled = true) {
  return useQuery({
    queryKey: profileKeys.apiTokens,
    queryFn: () => api(apiTokenContract.list),
    enabled,
  });
}

/** 修改资料后直接回填登录态里的用户快照，头像 / 昵称立即生效 */
export function useUpdateProfile() {
  return useApiMutation(authContract.updateProfile, {
    invalidate: (qc, user) => updateCachedAuthUser(qc, user),
  });
}

export function useChangeProfilePassword() {
  return useApiMutation(authContract.changePassword);
}

export function useProfileOAuthBindUrl() {
  return useApiMutation(oauthContract.bindUrl);
}

export function useUnbindProfileOAuth() {
  return useApiMutation(oauthContract.unbind, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: profileKeys.oauthAccounts }),
  });
}

export function useBeginTotpSetup() {
  return useApiMutation(authContract.beginTotpSetup);
}

export function useVerifyTotpSetup() {
  return useApiMutation(authContract.verifyTotpSetup, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: profileKeys.mfaFactors }),
  });
}

export function useDisableMfaFactor() {
  return useApiMutation(authContract.disableMfaFactor, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: profileKeys.mfaFactors }),
  });
}

export function useDeleteMfaFactor() {
  return useApiMutation(authContract.deleteMfaFactor, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: profileKeys.mfaFactors }),
  });
}

export function useKickOtherProfileSessions() {
  return useApiMutation(authContract.deleteOtherSessions, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: profileKeys.sessions }),
  });
}

export function useKickProfileSession() {
  return useApiMutation(authContract.deleteSession, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: profileKeys.sessions }),
  });
}

export function useCreateApiToken() {
  return useApiMutation(apiTokenContract.create, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: profileKeys.apiTokens }),
  });
}

export function useDeleteApiToken() {
  return useApiMutation(apiTokenContract.remove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: profileKeys.apiTokens }),
  });
}
