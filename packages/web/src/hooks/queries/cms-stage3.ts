import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsPublishingContract } from '@zenith/shared/cms';
import { invalidateAsyncTaskState } from './async-tasks';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type CmsPublishingListParams = NonNullable<QueryOf<typeof cmsPublishingContract.list>>;

export type CmsPublishArtifactListParams = NonNullable<QueryOf<typeof cmsPublishingContract.artifacts>>;

export const cmsPublishingKeys = {
  lists: contractKey(cmsPublishingContract.list),
  list: (params: CmsPublishingListParams) => contractKey(cmsPublishingContract.list, { query: params }),
  /** 全部任务详情的公共前缀（批量操作不知道哪些详情正被查看时使用） */
  details: contractKey(cmsPublishingContract.detail),
  detail: (id: number | undefined) => contractKey(cmsPublishingContract.detail, { params: { id: id ?? 0 } }),
  artifacts: contractKey(cmsPublishingContract.artifacts),
  artifactList: (params: CmsPublishArtifactListParams) => contractKey(cmsPublishingContract.artifacts, { query: params }),
};

/**
 * 发布中心三张视图同源于发布任务表：任务列表（各 Tab 按状态筛选）、任务详情（明细 + 产物）与产物列表。
 * 任何一次任务提交 / 状态流转 / 重建都会同时改变它们，故作为一个整体失效；
 * 发布中心页面上的任务进度事件也用它刷新。这里不含任务中心（async-tasks）的视图，由 mutation 侧另行处理。
 */
export function invalidateCmsPublishingViews(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsPublishingKeys.lists });
  void qc.invalidateQueries({ queryKey: cmsPublishingKeys.details });
  void qc.invalidateQueries({ queryKey: cmsPublishingKeys.artifacts });
}

/**
 * 后台提交 / 操作发布任务后的失效面：发布中心视图 + 任务中心（发布任务就是一条 async task，
 * 「我的任务」列表、统计与明细随之变化）。内容 / 栏目 / 站点等域的写操作也会在服务端排队发布任务，
 * 这些域的失效 helper 复用本函数，不各自拼发布中心的 key。
 */
export function invalidateAfterCmsPublishingChange(qc: QueryClient) {
  invalidateCmsPublishingViews(qc);
  invalidateAsyncTaskState(qc);
}

const ACTIVE_TASK_STATUSES = ['pending', 'running'];

export function useCmsPublishingList(params: CmsPublishingListParams, enabled = true) {
  return useApiQuery(cmsPublishingContract.list, { query: params }, {
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => query.state.data?.list.some((item) => ACTIVE_TASK_STATUSES.includes(item.status)) ? 4000 : false,
  });
}

export function useCmsPublishingDetail(id: number | undefined, enabled = true) {
  return useApiQuery(cmsPublishingContract.detail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    refetchInterval: (query) => query.state.data && ACTIVE_TASK_STATUSES.includes(query.state.data.task.status) ? 3000 : false,
  });
}

export function useCmsPublishArtifactList(params: CmsPublishArtifactListParams, enabled = true) {
  return useApiQuery(cmsPublishingContract.artifacts, { query: params }, {
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSubmitCmsPublish() {
  return useApiMutation(cmsPublishingContract.submit, { invalidate: invalidateAfterCmsPublishingChange });
}

export function useCmsPublishingAction() {
  return useApiMutation(cmsPublishingContract.action, { invalidate: invalidateAfterCmsPublishingChange });
}

export function useBatchCmsPublishingAction() {
  return useApiMutation(cmsPublishingContract.batchAction, { invalidate: invalidateAfterCmsPublishingChange });
}

/** 站群整组重建会为每个受影响站点提交发布任务 */
export function useSubmitCmsSiteGroupPublish() {
  return useApiMutation(cmsPublishingContract.groupSubmit, { invalidate: invalidateAfterCmsPublishingChange });
}