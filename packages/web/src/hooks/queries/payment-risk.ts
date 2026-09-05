import type { QueryClient } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentRiskOpsContract, paymentRiskRuleContract } from '@zenith/shared/payment';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentRiskRuleListParams = NonNullable<QueryOf<typeof paymentRiskRuleContract.list>>;
export type PaymentRiskHitListParams = NonNullable<QueryOf<typeof paymentRiskOpsContract.hits>>;
export type PaymentRiskReviewListParams = NonNullable<QueryOf<typeof paymentRiskOpsContract.reviews>>;

/** 命中记录与人工复核清单随规则增删改一并失效 */
const HIT_LISTS_KEY = contractKey(paymentRiskOpsContract.hits);
const REVIEW_LISTS_KEY = contractKey(paymentRiskOpsContract.reviews);

function invalidateRiskOps(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: HIT_LISTS_KEY });
  void qc.invalidateQueries({ queryKey: REVIEW_LISTS_KEY });
}

const rules = createResourceQueries(paymentRiskRuleContract, {
  onSaved: invalidateRiskOps,
  onDeleted: invalidateRiskOps,
});

export const paymentRiskKeys = {
  ...rules.keys,
  hitLists: HIT_LISTS_KEY,
  hitList: (params: PaymentRiskHitListParams) => contractKey(paymentRiskOpsContract.hits, { query: params }),
  reviewLists: REVIEW_LISTS_KEY,
  reviewList: (params: PaymentRiskReviewListParams) => contractKey(paymentRiskOpsContract.reviews, { query: params }),
};

export const usePaymentRiskRuleList = rules.useList;
export const useSavePaymentRiskRule = rules.useSave;
/** 服务端未提供 DELETE /batch，多选删除按单条并发执行 */
export const useDeletePaymentRiskRules = rules.useDelete;

export function usePaymentRiskHitList(params: PaymentRiskHitListParams) {
  return useApiQuery(paymentRiskOpsContract.hits, { query: params }, { placeholderData: keepPreviousData });
}

export function usePaymentRiskReviewList(params: PaymentRiskReviewListParams) {
  return useApiQuery(paymentRiskOpsContract.reviews, { query: params }, { placeholderData: keepPreviousData });
}

/** 审核结论只改变审核队列；命中记录是历史留痕，不随审核变化 */
export function useApprovePaymentRiskReview() {
  return useApiMutation(paymentRiskOpsContract.approveReview, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: REVIEW_LISTS_KEY }),
  });
}

export function useRejectPaymentRiskReview() {
  return useApiMutation(paymentRiskOpsContract.rejectReview, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: REVIEW_LISTS_KEY }),
  });
}
