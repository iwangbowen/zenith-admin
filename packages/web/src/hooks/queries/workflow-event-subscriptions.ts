import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowEventSubscriptionContract } from '@zenith/shared/workflow';
import { api, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type WorkflowEventSubscriptionListParams = QueryOf<typeof workflowEventSubscriptionContract.list>;

export type WorkflowEventDeliveryListParams = QueryOf<typeof workflowEventSubscriptionContract.deliveries>;

/** 投递记录随订阅增删一并失效（删除订阅级联清理投递） */
const DELIVERIES_KEY = ['workflow', 'event-subscriptions', 'deliveries'] as const;

const resource = createResourceQueries(workflowEventSubscriptionContract, {
  // 保留原有嵌套 key：运行时流程用 invalidateQueries({ queryKey: ['workflow'] }) 广播失效
  keyPrefix: ['workflow', 'event-subscriptions'],
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: DELIVERIES_KEY }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: DELIVERIES_KEY }),
});

export const workflowEventSubscriptionKeys = {
  ...resource.keys,
  deliveries: DELIVERIES_KEY,
  deliveryList: (params: WorkflowEventDeliveryListParams) => [...DELIVERIES_KEY, params] as const,
};

export const useWorkflowEventSubscriptionList = resource.useList;
export const useWorkflowEventSubscriptionDetail = resource.useDetail;
export const useSaveWorkflowEventSubscription = resource.useSave;
export const useDeleteWorkflowEventSubscriptions = resource.useDelete;

export function useWorkflowEventDeliveries(params: WorkflowEventDeliveryListParams, enabled = true) {
  return useQuery({
    queryKey: workflowEventSubscriptionKeys.deliveryList(params),
    queryFn: () => api(workflowEventSubscriptionContract.deliveries, { query: params }),
    enabled: enabled && params.subscriptionId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useToggleWorkflowEventSubscription() {
  return useApiMutation(workflowEventSubscriptionContract.toggle, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.all }),
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
