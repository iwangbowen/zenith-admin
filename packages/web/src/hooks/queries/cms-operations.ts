import { cmsOperationsContract } from '@zenith/shared/cms';
import type { QueryOf, BodyOf } from '@zenith/shared/core';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
const q = (siteId?: number) => ({ query: { siteId: siteId ?? 0, page: 1, pageSize: 50 } });
export const cmsOperationsKeys = { workspace: contractKey(cmsOperationsContract.workspace), feedback: contractKey(cmsOperationsContract.feedback), tasks: contractKey(cmsOperationsContract.tasks), attribution: contractKey(cmsOperationsContract.attribution) };
export function useCmsEditorialWorkspace(siteId?: number, queue?: QueryOf<typeof cmsOperationsContract.workspace>['queue']) { return useApiQuery(cmsOperationsContract.workspace, { query: { ...q(siteId).query, queue } }, { enabled: !!siteId, refetchInterval: 8000 }); }
export function useCmsFeedbackList(siteId?: number) { return useApiQuery(cmsOperationsContract.feedback, q(siteId), { enabled: !!siteId }); }
export function useCmsEditorialTasks(siteId?: number) { return useApiQuery(cmsOperationsContract.tasks, q(siteId), { enabled: !!siteId }); }
export function useCmsAttribution(siteId?: number) { return useApiQuery(cmsOperationsContract.attribution, { query: { siteId: siteId ?? 0 } }, { enabled: !!siteId }); }
export function useHandleCmsFeedback() { return useApiMutation(cmsOperationsContract.handleFeedback, { invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsOperationsKeys.workspace }) }); }
export function useCreateCmsEditorialTask() { return useApiMutation(cmsOperationsContract.createTask, { invalidate: (qc) => { void qc.invalidateQueries({ queryKey: cmsOperationsKeys.workspace }); void qc.invalidateQueries({ queryKey: cmsOperationsKeys.tasks }); } }); }
export function useUpdateCmsEditorialTask() { return useApiMutation(cmsOperationsContract.updateTask, { invalidate: (qc) => { void qc.invalidateQueries({ queryKey: cmsOperationsKeys.workspace }); void qc.invalidateQueries({ queryKey: cmsOperationsKeys.tasks }); } }); }
export type CmsFeedbackUpdate = BodyOf<typeof cmsOperationsContract.handleFeedback>;
