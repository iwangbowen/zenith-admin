import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsDistributionContract } from '@zenith/shared/cms';
import { invalidateAsyncTaskState } from './async-tasks';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

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

/**
 * 手动执行会写入规则的 lastRunAt（列表列 + 详情）并新增一条同步记录；同步记录详情是新记录，缓存里还没有。
 * 执行本身是一条异步任务，任务中心视图随之变化。其它规则不受影响。
 */
export function useRunCmsDistributionRule() {
  return useApiMutation(cmsDistributionContract.run, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsDistributionKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsDistributionKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: cmsDistributionKeys.runs });
      invalidateAsyncTaskState(qc);
    },
  });
}

export function useCmsDistributionRunList(params: CmsDistributionRunListParams, enabled = true) {
  return useApiQuery(cmsDistributionContract.runs, { query: params }, {
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.list.some((run) => ACTIVE_TASK_STATUSES.includes(run.status)) ? 3000 : false,
  });
}

export function useCmsDistributionRunDetail(id: number | undefined, enabled = true) {
  return useApiQuery(cmsDistributionContract.runDetail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    refetchInterval: (query) =>
      query.state.data && ACTIVE_TASK_STATUSES.includes(query.state.data.run.status) ? 3000 : false,
  });
}