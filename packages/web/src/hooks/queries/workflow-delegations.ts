import type { QueryOf } from '@zenith/shared/core';
import { workflowDelegationContract } from '@zenith/shared/workflow';
import { createResourceQueries } from '@/lib/contract-query';

export type WorkflowDelegationListParams = QueryOf<typeof workflowDelegationContract.list>;

export const {
  keys: workflowDelegationKeys,
  useList: useWorkflowDelegationList,
  useSave: useSaveWorkflowDelegation,
  useDelete: useDeleteWorkflowDelegations,
} = createResourceQueries(workflowDelegationContract, {
  // 保留原有嵌套 key：运行时流程用 invalidateQueries({ queryKey: ['workflow'] }) 广播失效
  keyPrefix: ['workflow', 'delegations'],
});
