import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { paymentDeductPlanContract, paymentSigningContract, type PaymentDeductPlan } from '@zenith/shared/payment';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { paymentOrderKeys } from './payment-orders';

export type PaymentContractListParams = NonNullable<QueryOf<typeof paymentSigningContract.contracts>>;
export type DeductPlanListParams = NonNullable<QueryOf<typeof paymentDeductPlanContract.deductPlans>>;
export type DeductPlanSaveValues = Partial<BodyOf<typeof paymentDeductPlanContract.createDeductPlan>>;

/** 签约协议与扣款计划共用 `/api/payment` 根，key 按操作名区分：协议状态变化不会连坐扣款计划下拉源 */
export const paymentContractKeys = {
  lists: contractKey(paymentSigningContract.contracts),
  list: (params: PaymentContractListParams) => contractKey(paymentSigningContract.contracts, { query: params }),
  details: contractKey(paymentSigningContract.contractDetail),
  detail: (id: number | undefined, applicationId?: number) =>
    contractKey(paymentSigningContract.contractDetail, { params: { id: id ?? 0 }, query: { applicationId: applicationId ?? 0 } }),
  planLists: contractKey(paymentDeductPlanContract.deductPlans),
  planList: (params: DeductPlanListParams) => contractKey(paymentDeductPlanContract.deductPlans, { query: params }),
  planOptions: contractKey(paymentDeductPlanContract.deductPlansAll),
};

// ─── 签约协议 ─────────────────────────────────────────────────────────────────

/**
 * 协议状态变更（签约 / 解约 / 暂停 / 恢复 / 扣款）的公共失效面。
 *
 * 只触及协议自身：列表与详情。扣款计划（`planLists` / `planOptions`，后者是
 * 新建协议弹窗的下拉源）不随协议状态变化，不应被打回源。
 */
function invalidateContract(qc: QueryClient, id?: number, applicationId?: number) {
  if (id !== undefined) void qc.invalidateQueries({ queryKey: paymentContractKeys.detail(id, applicationId) });
  void qc.invalidateQueries({ queryKey: paymentContractKeys.lists });
}

export function usePaymentContractList(params: PaymentContractListParams, enabled = true) {
  return useApiQuery(paymentSigningContract.contracts, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useCreatePaymentContract() {
  return useApiMutation(paymentSigningContract.createContract, {
    invalidate: (qc, result) => {
      invalidateContract(qc, result.contract.id, result.contract.appId);
      // firstDeductNow 会立即产生一笔支付单
      if (result.firstDeduct) void qc.invalidateQueries({ queryKey: paymentOrderKeys.lists });
    },
  });
}

export function useTerminatePaymentContract() {
  return useApiMutation(paymentSigningContract.terminateContract, {
    invalidate: (qc, _output, { params, query }) => invalidateContract(qc, params.id, query.applicationId),
  });
}

export function usePausePaymentContract() {
  return useApiMutation(paymentSigningContract.pauseContract, {
    invalidate: (qc, _output, { params, query }) => invalidateContract(qc, params.id, query.applicationId),
  });
}

export function useResumePaymentContract() {
  return useApiMutation(paymentSigningContract.resumeContract, {
    invalidate: (qc, _output, { params, query }) => invalidateContract(qc, params.id, query.applicationId),
  });
}

export function useDeductPaymentContract() {
  return useApiMutation(paymentSigningContract.deductContract, {
    invalidate: (qc, _output, { params, query }) => {
      // 扣款会改写 lastDeductAt / nextDeductAt / failCount 并生成一笔支付单
      invalidateContract(qc, params.id, query.applicationId);
      void qc.invalidateQueries({ queryKey: paymentOrderKeys.lists });
    },
  });
}

export function useRecoverPaymentContract() {
  return useApiMutation(paymentSigningContract.recoverContract, {
    invalidate: (qc, _output, { params, query }) => invalidateContract(qc, params.id, query.applicationId),
  });
}

// ─── 扣款计划 ─────────────────────────────────────────────────────────────────

/**
 * 扣款计划变更的公共失效面。
 *
 * 除计划列表与下拉源外，还必须失效协议列表：协议列表渲染 `planName` 派生列
 * （PaymentContractsPage「扣款计划」列），改名后不失效会显示旧名称。
 */
function invalidatePlan(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentContractKeys.planLists });
  void qc.invalidateQueries({ queryKey: paymentContractKeys.planOptions });
  void qc.invalidateQueries({ queryKey: paymentContractKeys.lists });
}

export function useDeductPlanList(params: DeductPlanListParams) {
  return useApiQuery(paymentDeductPlanContract.deductPlans, { query: params }, { placeholderData: keepPreviousData });
}

export function useAllDeductPlans() {
  return useQuery({
    queryKey: paymentContractKeys.planOptions,
    queryFn: () => api(paymentDeductPlanContract.deductPlansAll),
    staleTime: LOOKUP_STALE_TIME,
  });
}

/** 无 id 走新增，有 id 走更新 */
export function useSaveDeductPlan() {
  const qc = useQueryClient();
  return useMutation<PaymentDeductPlan, Error, { id?: number; values: DeductPlanSaveValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(paymentDeductPlanContract.createDeductPlan, { body: values as BodyOf<typeof paymentDeductPlanContract.createDeductPlan> })
        : api(paymentDeductPlanContract.updateDeductPlan, { params: { id }, body: values }),
    onSuccess: () => invalidatePlan(qc),
  });
}

export function useDeleteDeductPlan() {
  return useApiMutation(paymentDeductPlanContract.removeDeductPlan, { invalidate: invalidatePlan });
}
