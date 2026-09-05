import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { mpFanContract } from '@zenith/shared/mp';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type MpFanListParams = QueryOf<typeof mpFanContract.list>;

/** 粉丝只有列表与本地备注 / 标签更新走标准资源形态（无新增 / 删除） */
export const {
  keys: mpFanKeys,
  useList: useMpFanList,
  useSave: useSaveMpFan,
} = createResourceQueries(mpFanContract);

/** 以下操作都会改变粉丝列表行（关注状态 / 黑名单 / 会员绑定），统一失效列表 */
const invalidateLists = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: mpFanKeys.lists });
};

export function useSyncMpFans() {
  return useApiMutation(mpFanContract.sync, { invalidate: invalidateLists });
}

export function useSyncMpBlacklist() {
  return useApiMutation(mpFanContract.syncBlacklist, { invalidate: invalidateLists });
}

export function useBlacklistMpFans() {
  return useApiMutation(mpFanContract.blacklist, { invalidate: invalidateLists });
}

export function useUnblacklistMpFans() {
  return useApiMutation(mpFanContract.unblacklist, { invalidate: invalidateLists });
}

export function useCreateMpFanMember() {
  return useApiMutation(mpFanContract.createMember, { invalidate: invalidateLists });
}

export function useUnbindMpFanMember() {
  return useApiMutation(mpFanContract.unbindMember, { invalidate: invalidateLists });
}
