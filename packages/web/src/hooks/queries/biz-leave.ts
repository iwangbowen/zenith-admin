import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { bizLeaveContract, type BizLeave } from '@zenith/shared/biz';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateAfterInstanceChange } from './workflow-instances';
import { invalidateEntityRelations } from '@/lib/entity-relation-cache';

const resource = createResourceQueries(bizLeaveContract, {
  onSaved: (qc, saved) => invalidateLeaveWorkflowViews(qc, saved.id),
  onDeleted: (qc) => { void invalidateEntityRelations(qc); },
});

export const bizLeaveKeys = {
  ...resource.keys,
  /** 审批人视角详情（工作流参与者按 bizId 拉取），与「我的请假详情」是两个操作、两份缓存 */
  approvalDetail: (id: number, instanceId?: number) => instanceId === undefined
    ? [...contractKey(bizLeaveContract.approvalDetail), { params: { id } }]
    : contractKey(bizLeaveContract.approvalDetail, { params: { id }, query: { instanceId } }),
  workflowContext: (id: number, instanceId?: number) => contractKey(bizLeaveContract.workflowContext, { params: { id }, query: instanceId === undefined ? {} : { instanceId } }),
};

/** 完成通知可能先于业务订阅回写到达，只在当前页仍有审批中单据时轮询校准。 */
export function useBizLeaveList(query: QueryOf<typeof bizLeaveContract.list>, enabled = true) {
  return useApiQuery(bizLeaveContract.list, { query }, {
    enabled, placeholderData: keepPreviousData,
    refetchInterval: (state) => state.state.data?.list.some((item) => item.status === 'pending') ? 10_000 : false,
  });
}
export const useSaveBizLeave = resource.useSave;
export const useDeleteBizLeave = resource.useDelete;

/** 审批人视角的请假详情：审批端传入的 bizId 是字符串，转成数值主键后走契约 */
export function useBizLeaveDetail(id: string | null | undefined, instanceId: number | undefined, enabled = true) {
  const numericId = id ? Number(id) : undefined;
  return useApiQuery(bizLeaveContract.approvalDetail, { params: { id: numericId ?? 0 }, query: { instanceId: instanceId ?? 0 } }, {
    enabled: enabled && numericId !== undefined && instanceId !== undefined,
    requestOptions: { silent: true },
  });
}

/** 本人视角详情与审批参与者接口分离；运行中定期校准异步回写。 */
export function useBizLeaveRecord(id: number | undefined, enabled = true) {
  return useApiQuery(bizLeaveContract.detail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    refetchInterval: (query) => query.state.data?.status === 'pending' ? 10_000 : false,
  });
}

export function useBizLeaveWorkflowPreview(body: BodyOf<typeof bizLeaveContract.workflowPreview>, enabled = true) {
  return useApiQuery(bizLeaveContract.workflowPreview, { body }, { enabled, requestOptions: { silent: true }, retry: false });
}

export function useBizLeaveWorkflowContext(id: number | undefined, instanceId?: number, enabled = true) {
  return useApiQuery(bizLeaveContract.workflowContext, { params: { id: id ?? 0 }, query: { instanceId } }, {
    enabled: enabled && id !== undefined, requestOptions: { silent: true },
    refetchInterval: instanceId === undefined ? 10_000 : false,
  });
}

/** 状态流转只影响该申请：列表状态列、我的详情与审批人视角详情（两份缓存都指向同一实体），不影响其他记录 */
function invalidateLeaveStatus(qc: QueryClient, saved: BizLeave) {
  void qc.invalidateQueries({ queryKey: bizLeaveKeys.detail(saved.id) });
  void qc.invalidateQueries({ queryKey: bizLeaveKeys.lists });
  invalidateLeaveWorkflowViews(qc, saved.id);
}

function invalidateLeaveWorkflowViews(qc: QueryClient, id: number) {
  void invalidateEntityRelations(qc);
  void qc.invalidateQueries({ queryKey: bizLeaveKeys.approvalDetail(id) });
  void qc.invalidateQueries({ queryKey: bizLeaveKeys.workflowContext(id) });
}

export function useSubmitBizLeave() {
  return useApiMutation(bizLeaveContract.submit, { invalidate: (qc, saved) => {
    invalidateLeaveStatus(qc, saved);
    if (saved.workflowInstanceId) invalidateAfterInstanceChange(qc, saved.workflowInstanceId);
  } });
}

export function useReopenBizLeave() {
  return useApiMutation(bizLeaveContract.reopen, { invalidate: (qc, saved) => invalidateLeaveStatus(qc, saved) });
}
