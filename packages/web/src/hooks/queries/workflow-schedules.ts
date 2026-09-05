import type { QueryOf } from '@zenith/shared/core';
import { workflowScheduleContract } from '@zenith/shared/workflow';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type WorkflowScheduleListParams = QueryOf<typeof workflowScheduleContract.list>;

export const {
  keys: workflowScheduleKeys,
  useList: useWorkflowScheduleList,
  useSave: useSaveWorkflowSchedule,
  useDelete: useDeleteWorkflowSchedules,
} = createResourceQueries(workflowScheduleContract, {
  // 保留原有嵌套 key：运行时流程用 invalidateQueries({ queryKey: ['workflow'] }) 广播失效
  keyPrefix: ['workflow', 'schedules'],
});

/** 手动触发一次：会发起新实例并回写规则的最近执行状态，广播整个 workflow 子树 */
export function useRunWorkflowSchedule() {
  return useApiMutation(workflowScheduleContract.run, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}
