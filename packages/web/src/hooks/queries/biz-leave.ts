import { type QueryClient } from '@tanstack/react-query';
import { bizLeaveContract, type BizLeave } from '@zenith/shared/biz';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

const resource = createResourceQueries(bizLeaveContract);

export const bizLeaveKeys = {
  ...resource.keys,
  /** 审批人视角详情（工作流参与者按 bizId 拉取），与「我的请假详情」是两个操作、两份缓存 */
  approvalDetail: (id: number) => contractKey(bizLeaveContract.approvalDetail, { params: { id } }),
};

export const useBizLeaveList = resource.useList;
export const useSaveBizLeave = resource.useSave;
export const useDeleteBizLeave = resource.useDelete;

/** 审批人视角的请假详情：审批端传入的 bizId 是字符串，转成数值主键后走契约 */
export function useBizLeaveDetail(id: string | null | undefined, enabled = true) {
  const numericId = id ? Number(id) : undefined;
  return useApiQuery(bizLeaveContract.approvalDetail, { params: { id: numericId ?? 0 } }, {
    enabled: enabled && numericId !== undefined,
    requestOptions: { silent: true },
  });
}

/** 状态流转只影响该申请：列表状态列、我的详情与审批人视角详情（两份缓存都指向同一实体），不影响其他记录 */
function invalidateLeaveStatus(qc: QueryClient, saved: BizLeave) {
  void qc.invalidateQueries({ queryKey: bizLeaveKeys.detail(saved.id) });
  void qc.invalidateQueries({ queryKey: bizLeaveKeys.approvalDetail(saved.id) });
  void qc.invalidateQueries({ queryKey: bizLeaveKeys.lists });
}

export function useSubmitBizLeave() {
  return useApiMutation(bizLeaveContract.submit, { invalidate: (qc, saved) => invalidateLeaveStatus(qc, saved) });
}

export function useReopenBizLeave() {
  return useApiMutation(bizLeaveContract.reopen, { invalidate: (qc, saved) => invalidateLeaveStatus(qc, saved) });
}
