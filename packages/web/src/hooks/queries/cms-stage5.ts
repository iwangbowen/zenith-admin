import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsDistributionContract } from '@zenith/shared/cms';
import { asyncTaskKeys } from './async-tasks';
import { apiQueryOptions, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type CmsDistributionRuleListParams = NonNullable<QueryOf<typeof cmsDistributionContract.list>>;

export type CmsDistributionRunListParams = NonNullable<QueryOf<typeof cmsDistributionContract.runs>>;

const ACTIVE_TASK_STATUSES = ['pending', 'running'];

const resource = createResourceQueries(cmsDistributionContract);

export const cmsDistributionKeys = {
  ...resource.keys,
  runs: contractKey(cmsDistributionContract.runs),
  runList: (params: CmsDistributionRunListParams) => contractKey(cmsDistributionContract.runs, { query: params }),
  runDetail: (id: number | undefined) => contractKey(cmsDistributionContract.runDetail, { params: { id: id ?? 0 } }),
};

export const useCmsDistributionRuleList = resource.useList;
export const useCmsDistributionRule = resource.useDetail;
export const useSaveCmsDistributionRule = resource.useSave;
export const useDeleteCmsDistributionRules = resource.useDelete;

/** 手动执行会写入规则的 lastRunAt 并新增同步记录 */
export function useRunCmsDistributionRule() {
  return useApiMutation(cmsDistributionContract.run, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsDistributionKeys.all });
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.all });
    },
  });
}

export function useCmsDistributionRunList(params: CmsDistributionRunListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsDistributionContract.runs, { query: params }),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.list.some((run) => ACTIVE_TASK_STATUSES.includes(run.status)) ? 3000 : false,
  });
}

export function useCmsDistributionRunDetail(id: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsDistributionContract.runDetail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
    refetchInterval: (query) =>
      query.state.data && ACTIVE_TASK_STATUSES.includes(query.state.data.run.status) ? 3000 : false,
  });
}
