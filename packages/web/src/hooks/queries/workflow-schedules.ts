import type { QueryOf } from '@zenith/shared/core';
import { workflowScheduleContract } from '@zenith/shared/workflow';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { invalidateAfterInstanceChange } from './workflow-instances';

export type WorkflowScheduleListParams = QueryOf<typeof workflowScheduleContract.list>;

export const {
  keys: workflowScheduleKeys,
  useList: useWorkflowScheduleList,
  useSave: useSaveWorkflowSchedule,
  useDelete: useDeleteWorkflowSchedules,
} = createResourceQueries(workflowScheduleContract);

/** 手动触发一次：回写规则的最近执行状态（列表列），并以规则配置的发起人发起一个新实例 */
export function useRunWorkflowSchedule() {
  return useApiMutation(workflowScheduleContract.run, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: workflowScheduleKeys.lists });
      invalidateAfterInstanceChange(qc);
    },
  });
}
