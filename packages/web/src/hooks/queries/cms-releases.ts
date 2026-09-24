import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { cmsReleaseContract, cmsWorkbenchContract } from '@zenith/shared/cms';
import type { QueryOf } from '@zenith/shared/core';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateAfterCmsContentChange } from './cms-contents';
import { invalidateCmsPublishingViews } from './cms-stage3';

export const cmsReleaseKeys = { lists: contractKey(cmsReleaseContract.list), details: contractKey(cmsReleaseContract.detail) };
export function invalidateCmsReleases(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsReleaseKeys.lists });
  void qc.invalidateQueries({ queryKey: cmsReleaseKeys.details });
  void qc.invalidateQueries({ queryKey: contractKey(cmsReleaseContract.review) });
  void qc.invalidateQueries({ queryKey: contractKey(cmsWorkbenchContract.configurationDraft) });
  invalidateCmsPublishingViews(qc);
}
export const useCmsReleaseList = (query: QueryOf<typeof cmsReleaseContract.list>, enabled = true) => useApiQuery(cmsReleaseContract.list, { query }, {
  enabled, placeholderData: keepPreviousData,
  refetchInterval: (state) => state.state.data?.list.some((release) => ['building', 'scheduled'].includes(release.status)) ? 5000 : false,
});
export const useCmsReleaseDetail = (id?: number) => useApiQuery(cmsReleaseContract.detail, { params: { id: id ?? 0 } }, {
  enabled: !!id, refetchInterval: (state) => state.state.data && ['building', 'scheduled'].includes(state.state.data.status) ? 5000 : false,
});
export const useCmsReleasePreview = (id: number | undefined, path: string, enabled: boolean) => useApiQuery(cmsReleaseContract.preview, { params: { id: id ?? 0 }, query: { path } }, { enabled: enabled && id !== undefined });
export const useCreateCmsRelease = () => useApiMutation(cmsReleaseContract.create, { invalidate: invalidateCmsReleases });
export const useBuildCmsRelease = () => useApiMutation(cmsReleaseContract.build, { invalidate: invalidateCmsReleases });
export const useCancelCmsRelease = () => useApiMutation(cmsReleaseContract.cancel, { invalidate: invalidateCmsReleases });
function invalidateActivation(qc: QueryClient) { invalidateCmsReleases(qc); invalidateAfterCmsContentChange(qc); }
export const useActivateCmsRelease = () => useApiMutation(cmsReleaseContract.activate, { invalidate: invalidateActivation });
export const useRollbackCmsRelease = () => useApiMutation(cmsReleaseContract.rollback, { invalidate: invalidateActivation });
export const useSuppressCmsContent = () => useApiMutation(cmsReleaseContract.suppress, { invalidate: invalidateActivation });
export const useUnsuppressCmsContent = () => useApiMutation(cmsReleaseContract.unsuppress, { invalidate: invalidateActivation });
