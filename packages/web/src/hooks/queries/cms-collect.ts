import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsCollectContract } from '@zenith/shared/cms';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateAsyncTaskState } from './async-tasks';

export type CmsCollectRuleListParams = NonNullable<QueryOf<typeof cmsCollectContract.list>>;

export type CmsCollectItemListParams = NonNullable<QueryOf<typeof cmsCollectContract.items>>;

const resource = createResourceQueries(cmsCollectContract);

export const cmsCollectKeys = {
  ...resource.keys,
  /** 全部规则采集明细的公共前缀 */
  itemsAll: contractKey(cmsCollectContract.items),
  /** 某条规则全部分页明细的前缀（按 params 段匹配） */
  itemsOf: (ruleId: number) => [...contractKey(cmsCollectContract.items), { params: { id: ruleId } }] as const,
  items: (ruleId: number, params: CmsCollectItemListParams) => contractKey(cmsCollectContract.items, { params: { id: ruleId }, query: params }),
};

export function useCmsCollectRules(params: Omit<CmsCollectRuleListParams, 'siteId'> & { siteId: number | undefined }) {
  return useApiQuery(cmsCollectContract.list, { query: { ...params, siteId: params.siteId ?? 0 } }, {
    enabled: !!params.siteId,
    placeholderData: keepPreviousData,
  });
}

export const useSaveCmsCollectRule = resource.useSave;
export const useDeleteCmsCollectRules = resource.useDelete;

/**
 * 执行采集是一条异步任务：规则列表的 lastRunAt 与该规则的采集明细随任务推进变化，
 * 任务中心（我的任务 / 统计）也新增一条记录。其它规则的明细不受影响。
 */
export function useRunCmsCollectRule() {
  return useApiMutation(cmsCollectContract.run, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsCollectKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsCollectKeys.itemsOf(params.id) });
      invalidateAsyncTaskState(qc);
    },
  });
}

export function useCmsCollectItems(ruleId: number | undefined, params: CmsCollectItemListParams) {
  return useApiQuery(cmsCollectContract.items, { params: { id: ruleId ?? 0 }, query: params }, {
    enabled: !!ruleId,
    placeholderData: keepPreviousData,
  });
}