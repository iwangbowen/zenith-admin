import type { QueryOf } from '@zenith/shared/core';
import { workflowDelegationContract } from '@zenith/shared/workflow';
import { createResourceQueries } from '@/lib/contract-query';

export type WorkflowDelegationListParams = QueryOf<typeof workflowDelegationContract.list>;

export const {
  keys: workflowDelegationKeys,
  useList: useWorkflowDelegationList,
  useSave: useSaveWorkflowDelegation,
  useDelete: useDeleteWorkflowDelegations,
} = createResourceQueries(workflowDelegationContract);
