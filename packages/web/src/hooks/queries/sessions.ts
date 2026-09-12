import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { sessionContract } from '@zenith/shared/identity';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type SessionListParams = NonNullable<QueryOf<typeof sessionContract.list>>;

export const sessionKeys = {
  lists: contractKey(sessionContract.list),
  list: (params: SessionListParams) => contractKey(sessionContract.list, { query: params }),
};

export function useSessionList(params: SessionListParams) {
  return useApiQuery(sessionContract.list, { query: params }, { placeholderData: keepPreviousData });
}

/** 强制下线：single 只踢指定会话，all 踢该用户全部会话；在线列表是本域唯一查询 */
export function useForceLogoutSession() {
  return useApiMutation(sessionContract.forceLogout, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: sessionKeys.lists }),
  });
}

export function useForceLogoutUserSessions() {
  return useApiMutation(sessionContract.forceLogoutUser, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: sessionKeys.lists }),
  });
}
