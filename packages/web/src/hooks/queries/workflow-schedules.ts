import type { QueryOf } from '@zenith/shared/core';
import { keepPreviousData } from '@tanstack/react-query';
import { workflowScheduleContract } from '@zenith/shared/workflow';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateAfterInstanceChange } from './workflow-instances';

export type WorkflowScheduleListParams = QueryOf<typeof workflowScheduleContract.list>;
export type WorkflowScheduleRunListParams = QueryOf<typeof workflowScheduleContract.runs>;

export const workflowScheduleRunKeys = {
  lists: contractKey(workflowScheduleContract.runs),
  list: (id: number) => contractKey(workflowScheduleContract.runs, { params: { id } }),
  detail: (id: number, jobId: number) => contractKey(workflowScheduleContract.runDetail, { params: { id, jobId } }),
};

export const {
  keys: workflowScheduleKeys,
  useList: useWorkflowScheduleList,
  useSave: useSaveWorkflowSchedule,
  useDelete: useDeleteWorkflowSchedules,
} = createResourceQueries(workflowScheduleContract);

/** Queue a new manual occurrence; actual launch and retries are visible in the run ledger. */
export function useRunWorkflowSchedule() {
  return useApiMutation(workflowScheduleContract.run, {
    invalidate: (qc, _result, input) => {
      void qc.invalidateQueries({ queryKey: workflowScheduleKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowScheduleRunKeys.list(input.params.id) });
      invalidateAfterInstanceChange(qc);
    },
  });
}

export function useWorkflowScheduleRuns(id: number, params: WorkflowScheduleRunListParams, enabled = true) {
  return useApiQuery(workflowScheduleContract.runs, { params: { id }, query: params }, {
    enabled, placeholderData: keepPreviousData,
    refetchInterval: (query) => query.state.data?.list.some((run) => run.status === 'pending' || run.status === 'running') ? 2000 : 10_000,
  });
}

export function useWorkflowScheduleRunDetail(id: number, jobId: number | null) {
  return useApiQuery(workflowScheduleContract.runDetail, { params: { id, jobId: jobId ?? 0 } }, {
    enabled: jobId !== null,
    refetchInterval: (query) => ['pending', 'running'].includes(query.state.data?.status ?? '') ? 2000 : false,
  });
}

export function useRetryWorkflowScheduleRun() {
  return useApiMutation(workflowScheduleContract.retryRun, {
    invalidate: (qc, _result, input) => {
      void qc.invalidateQueries({ queryKey: workflowScheduleKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowScheduleRunKeys.list(input.params.id) });
      void qc.invalidateQueries({ queryKey: workflowScheduleRunKeys.detail(input.params.id, input.params.jobId) });
      invalidateAfterInstanceChange(qc);
    },
  });
}
