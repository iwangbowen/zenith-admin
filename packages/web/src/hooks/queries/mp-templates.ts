import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { mpTemplateContract } from '@zenith/shared/mp';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type MpTemplateListParams = QueryOf<typeof mpTemplateContract.list>;
export type MpTemplateLogListParams = QueryOf<typeof mpTemplateContract.logs>;

/** 模板清单只读同步 + 删除；发送日志与行业设置是独立查询，见下方 keys */
export const {
  keys: mpTemplateKeys,
  useList: useMpTemplateList,
  useDelete: useDeleteMpTemplates,
} = createResourceQueries(mpTemplateContract);

export const mpTemplateLogKeys = {
  /** 全部发送日志查询的公共前缀 */
  lists: contractKey(mpTemplateContract.logs),
};

export const mpTemplateIndustryKeys = {
  detail: (accountId: number | null | undefined) => contractKey(mpTemplateContract.industry, { query: { accountId: accountId ?? 0 } }),
};

export function useMpTemplateLogList(params: MpTemplateLogListParams, enabled = true) {
  return useApiQuery(mpTemplateContract.logs, { query: params }, { enabled, placeholderData: keepPreviousData });
}

export function useMpTemplateIndustry(accountId: number | null | undefined, enabled = true) {
  return useApiQuery(mpTemplateContract.industry, { query: { accountId: accountId ?? 0 } }, { enabled: enabled && !!accountId });
}

/** 同步只重建模板清单；发送日志与行业设置不受影响 */
export function useSyncMpTemplates() {
  return useApiMutation(mpTemplateContract.sync, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: mpTemplateKeys.lists }),
  });
}

/** 发送只新增发送日志，模板清单本身不变 */
export function useSendMpTemplate() {
  return useApiMutation(mpTemplateContract.send, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: mpTemplateLogKeys.lists }),
  });
}

export function useBatchSendMpTemplate() {
  return useApiMutation(mpTemplateContract.batchSend, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: mpTemplateLogKeys.lists }),
  });
}

export function useSaveMpTemplateIndustry() {
  return useApiMutation(mpTemplateContract.setIndustry, {
    invalidate: (qc, _output, { body }) => void qc.invalidateQueries({ queryKey: mpTemplateIndustryKeys.detail(body.accountId) }),
  });
}
