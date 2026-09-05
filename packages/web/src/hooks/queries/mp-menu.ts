import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { mpConditionalMenuContract, mpMenuContract, type MpMenuButton } from '@zenith/shared/mp';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const mpMenuKeys = {
  /** 全部自定义菜单查询的公共前缀 */
  all: contractKey(mpMenuContract.get),
  detail: (accountId: number | null | undefined) => contractKey(mpMenuContract.get, { query: { accountId: accountId ?? 0 } }),
  /** 全部个性化菜单列表查询的公共前缀 */
  conditionalAll: contractKey(mpConditionalMenuContract.list),
  conditionalList: (accountId: number | null | undefined) =>
    contractKey(mpConditionalMenuContract.list, { query: { accountId: accountId ?? 0 } }),
};

export function useMpMenu(accountId: number | null | undefined) {
  return useApiQuery(mpMenuContract.get, { query: { accountId: accountId ?? 0 } }, { enabled: !!accountId });
}

/** 菜单每个公众号一份：写操作只影响该账号的菜单 */
const invalidateMenu = (qc: QueryClient, accountId: number) => {
  void qc.invalidateQueries({ queryKey: mpMenuKeys.detail(accountId) });
};

export function useSaveMpMenu() {
  return useApiMutation(mpMenuContract.save, {
    invalidate: (qc, _output, { body }) => invalidateMenu(qc, body.accountId),
  });
}

/** 发布 = 先保存当前草稿再推送到微信，两步串联为一次变更 */
export function usePublishMpMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, buttons }: { accountId: number; buttons: MpMenuButton[] }) => {
      await api(mpMenuContract.save, { body: { accountId, buttons } });
      return api(mpMenuContract.publish, { body: { accountId } });
    },
    onSuccess: (_menu, { accountId }) => invalidateMenu(qc, accountId),
  });
}

export function usePullMpMenu() {
  return useApiMutation(mpMenuContract.pull, {
    invalidate: (qc, _output, { body }) => invalidateMenu(qc, body.accountId),
  });
}

export function useDeleteMpMenu() {
  return useApiMutation(mpMenuContract.remove, {
    invalidate: (qc, _output, { body }) => invalidateMenu(qc, body.accountId),
  });
}

// ─── 个性化菜单 ──────────────────────────────────────────────────────────────

export function useMpConditionalMenus(accountId: number | null | undefined) {
  return useApiQuery(mpConditionalMenuContract.list, { query: { accountId: accountId ?? 0 } }, { enabled: !!accountId });
}

export type MpConditionalMenuSaveValues = BodyOf<typeof mpConditionalMenuContract.create>;

/** 无 id 走新增、有 id 走编辑；列表不分页，故不走 createResourceQueries */
export function useSaveMpConditionalMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: MpConditionalMenuSaveValues }) =>
      id === undefined
        ? api(mpConditionalMenuContract.create, { body: values })
        : api(mpConditionalMenuContract.update, { params: { id }, body: values }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMenuKeys.conditionalAll }),
  });
}

export function usePublishMpConditionalMenu() {
  return useApiMutation(mpConditionalMenuContract.publish, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: mpMenuKeys.conditionalAll }),
  });
}

export function useDeleteMpConditionalMenu() {
  return useApiMutation(mpConditionalMenuContract.remove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: mpMenuKeys.conditionalAll }),
  });
}

/** 匹配测试是只读探测，不改变任何缓存 */
export function useTryMatchMpConditionalMenu() {
  return useApiMutation(mpConditionalMenuContract.tryMatch);
}
