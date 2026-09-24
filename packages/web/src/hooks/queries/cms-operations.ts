import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { cmsOperationsContract } from '@zenith/shared/cms';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES } from '@zenith/shared/workflow';
import type { QueryOf, BodyOf } from '@zenith/shared/core';
import { contractKey, useApiMutation, useApiQuery, useSaveMutation } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export const cmsOperationsKeys = {
  workspace: contractKey(cmsOperationsContract.workspace), feedback: contractKey(cmsOperationsContract.feedback),
  tasks: contractKey(cmsOperationsContract.tasks), attribution: contractKey(cmsOperationsContract.attribution),
  feedbackDetail: (id: number) => contractKey(cmsOperationsContract.feedbackDetail, { params: { id } }),
  taskDetail: (id: number) => contractKey(cmsOperationsContract.taskDetail, { params: { id } }),
};
const active = (status?: string | null) => WORKFLOW_ACTIVE_INSTANCE_STATUSES.some((value) => value === status);
export function invalidateCmsFeedback(qc: QueryClient, id: number) {
  for (const key of [cmsOperationsKeys.workspace, cmsOperationsKeys.feedback, cmsOperationsKeys.feedbackDetail(id),
    contractKey(cmsOperationsContract.workflowContext, { params: { id } }), contractKey(cmsOperationsContract.workflowPreview, { params: { id } }),
    contractKey(cmsOperationsContract.approvalDetail, { params: { id } })]) void qc.invalidateQueries({ queryKey: key });
}
export function invalidateCmsEditorialTasks(qc: QueryClient, id?: number) {
  void qc.invalidateQueries({ queryKey: cmsOperationsKeys.workspace });
  void qc.invalidateQueries({ queryKey: cmsOperationsKeys.tasks });
  if (id) void qc.invalidateQueries({ queryKey: cmsOperationsKeys.taskDetail(id) });
}
/** 稿件标题、工作稿与发布状态出现在事项列表和详情，内容变更同时刷新这些派生视图。 */
export function invalidateCmsOperationsContentViews(qc: QueryClient) {
  invalidateCmsEditorialTasks(qc);
  void qc.invalidateQueries({ queryKey: contractKey(cmsOperationsContract.taskDetail) });
}
export function useCmsEditorialWorkspace(query: QueryOf<typeof cmsOperationsContract.workspace>, enabled = true) {
  return useApiQuery(cmsOperationsContract.workspace, { query }, { enabled: enabled && query.siteId > 0, placeholderData: keepPreviousData, refetchInterval: 15_000 });
}
export function useCmsFeedbackList(query: QueryOf<typeof cmsOperationsContract.feedback>, enabled = true) {
  return useApiQuery(cmsOperationsContract.feedback, { query }, { enabled: enabled && query.siteId > 0, placeholderData: keepPreviousData });
}
export function useCmsFeedbackDetail(id?: number) {
  return useApiQuery(cmsOperationsContract.feedbackDetail, { params: { id: id ?? 0 } }, { enabled: !!id, refetchInterval: (q) => active(q.state.data?.workflowStatus) ? 8000 : false });
}
export function useCmsFeedbackApprovalDetail(id?: number, instanceId?: number) {
  return useApiQuery(cmsOperationsContract.approvalDetail, { params: { id: id ?? 0 }, query: { instanceId: instanceId ?? 0 } }, { enabled: !!id && !!instanceId });
}
export function useCmsFeedbackWorkflow(id?: number, instanceId?: number) {
  return useApiQuery(cmsOperationsContract.workflowContext, { params: { id: id ?? 0 }, query: { instanceId } }, { enabled: !!id, refetchInterval: (q) => active(q.state.data?.instance?.status) ? 8000 : false });
}
export function useCmsFeedbackWorkflowPreview(id?: number, note?: string, enabled = true) {
  return useApiQuery(cmsOperationsContract.workflowPreview, { params: { id: id ?? 0 }, body: { note } }, { enabled: !!id && enabled });
}
export function useCmsFormHandlingPolicy(id?: number) { return useApiQuery(cmsOperationsContract.handlingPolicy, { params: { id: id ?? 0 } }, { enabled: !!id }); }
export function useSaveCmsFormHandlingPolicy() {
  return useApiMutation(cmsOperationsContract.saveHandlingPolicy, { invalidate: (qc, _, { params }) => void qc.invalidateQueries({ queryKey: contractKey(cmsOperationsContract.handlingPolicy, { params }) }) });
}
export function useCmsOperationsAssignees(enabled = true) { return useApiQuery(cmsOperationsContract.assignees, { enabled, staleTime: LOOKUP_STALE_TIME }); }
export function useCmsHandlingWorkflows(enabled = true) { return useApiQuery(cmsOperationsContract.handlingWorkflows, { enabled, staleTime: LOOKUP_STALE_TIME }); }
export function useCmsEditorialTasks(query: QueryOf<typeof cmsOperationsContract.tasks>, enabled = true) { return useApiQuery(cmsOperationsContract.tasks, { query }, { enabled: enabled && query.siteId > 0, placeholderData: keepPreviousData }); }
export function useCmsEditorialTaskDetail(id?: number, enabled = true) { return useApiQuery(cmsOperationsContract.taskDetail, { params: { id: id ?? 0 } }, { enabled: !!id && enabled }); }
export function useCmsAttribution(query: QueryOf<typeof cmsOperationsContract.attribution>, enabled = true) { return useApiQuery(cmsOperationsContract.attribution, { query }, { enabled: enabled && query.siteId > 0 }); }
export function useHandleCmsFeedback() { return useApiMutation(cmsOperationsContract.handleFeedback, { invalidate: (qc, _, { params }) => invalidateCmsFeedback(qc, params.id) }); }
export function useSubmitCmsFeedbackWorkflow() { return useApiMutation(cmsOperationsContract.submitWorkflow, { invalidate: (qc, _, { params }) => invalidateCmsFeedback(qc, params.id) }); }
export function useCreateCmsEditorialTask() { return useApiMutation(cmsOperationsContract.createTask, { invalidate: (qc, row) => invalidateCmsEditorialTasks(qc, row.id) }); }
export function useUpdateCmsEditorialTask() { return useApiMutation(cmsOperationsContract.updateTask, { invalidate: (qc, row) => invalidateCmsEditorialTasks(qc, row.id) }); }
export function useSaveCmsEditorialTask() { return useSaveMutation(cmsOperationsContract.createTask, cmsOperationsContract.updateTask, { invalidate: (qc, row) => invalidateCmsEditorialTasks(qc, row.id) }); }
export type CmsFeedbackUpdate = BodyOf<typeof cmsOperationsContract.handleFeedback>;
