import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { apiTokenContract, authContract, oauthContract } from '@zenith/shared/identity';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { updateCachedAuthUser } from './auth';

export type ProfileLoginLogParams = NonNullable<QueryOf<typeof authContract.myLoginLogs>>;

export type ProfileOperationLogParams = NonNullable<QueryOf<typeof authContract.myOperationLogs>>;

/** 个人中心各页签的查询散落在 auth / oauth / api-tokens 三个契约里，key 各自由操作派生，写操作只动对应页签 */
export const profileKeys = {
  oauthAccounts: contractKey(oauthContract.accounts),
  mfaFactors: contractKey(authContract.mfaFactors),
  sessions: contractKey(authContract.mySessions),
  loginLogs: contractKey(authContract.myLoginLogs),
  loginLogList: (params: ProfileLoginLogParams) => contractKey(authContract.myLoginLogs, { query: params }),
  operationLogs: contractKey(authContract.myOperationLogs),
  operationLogList: (params: ProfileOperationLogParams) => contractKey(authContract.myOperationLogs, { query: params }),
  apiTokens: contractKey(apiTokenContract.list),
};

export function useProfileOauthAccounts(enabled = true) {
  return useApiQuery(oauthContract.accounts, { enabled });
}

export function useProfileMfaFactors(enabled = true) {
  return useApiQuery(authContract.mfaFactors, { enabled });
}

export function useProfileSessions(enabled = true) {
  return useApiQuery(authContract.mySessions, { enabled });
}

export function useProfileLoginLogs(params: ProfileLoginLogParams, enabled = true) {
  return useApiQuery(authContract.myLoginLogs, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useProfileOperationLogs(params: ProfileOperationLogParams, enabled = true) {
  return useApiQuery(authContract.myOperationLogs, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useProfileApiTokens(enabled = true) {
  return useApiQuery(apiTokenContract.list, { enabled });
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
