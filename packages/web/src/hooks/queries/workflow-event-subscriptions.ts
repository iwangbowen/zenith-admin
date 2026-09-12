import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowEventSubscriptionContract } from '@zenith/shared/workflow';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type WorkflowEventSubscriptionListParams = QueryOf<typeof workflowEventSubscriptionContract.list>;

export type WorkflowEventDeliveryListParams = QueryOf<typeof workflowEventSubscriptionContract.deliveries>;

/** 投递记录随订阅增删一并失效（删除订阅级联清理投递） */
const DELIVERIES_KEY = contractKey(workflowEventSubscriptionContract.deliveries);

const resource = createResourceQueries(workflowEventSubscriptionContract, {
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: DELIVERIES_KEY }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: DELIVERIES_KEY }),
});

export const workflowEventSubscriptionKeys = {
  ...resource.keys,
  deliveries: DELIVERIES_KEY,
  deliveryList: (params: WorkflowEventDeliveryListParams) => contractKey(workflowEventSubscriptionContract.deliveries, { query: params }),
};

export const useWorkflowEventSubscriptionList = resource.useList;
export const useWorkflowEventSubscriptionDetail = resource.useDetail;
export const useSaveWorkflowEventSubscription = resource.useSave;
export const useDeleteWorkflowEventSubscriptions = resource.useDelete;

export function useWorkflowEventDeliveries(params: WorkflowEventDeliveryListParams, enabled = true) {
  return useApiQuery(workflowEventSubscriptionContract.deliveries, { query: params }, {
    enabled: enabled && params.subscriptionId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useToggleWorkflowEventSubscription() {
  return useApiMutation(workflowEventSubscriptionContract.toggle, {
    // 启停只改订阅自身的 enabled：列表状态列与该订阅详情回源，投递记录不变
    invalidate: (qc, _saved, { params }) => {
      void qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.detail(params.id) });
    },
  });
}

/** secret 明文按需读取，不进入任何缓存 */
export function useWorkflowEventSubscriptionSecret() {
  return useApiMutation(workflowEventSubscriptionContract.secret);
}

export function useRetryWorkflowEventDelivery() {
  return useApiMutation(workflowEventSubscriptionContract.retryDelivery, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.deliveries }),
  });
}

export function useReplayWorkflowEventDeliveries() {
  return useApiMutation(workflowEventSubscriptionContract.replayDeliveries, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.deliveries }),
  });
}

/** 测试投递：同步发送样例事件并返回 HTTP 结果（不产生投递记录） */
export function useTestWorkflowEventSubscription() {
  return useApiMutation(workflowEventSubscriptionContract.test);
}
