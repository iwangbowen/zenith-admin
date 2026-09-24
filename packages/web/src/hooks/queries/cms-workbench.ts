import { cmsWorkbenchContract, cmsReleaseContract } from '@zenith/shared/cms';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateCmsReleases } from './cms-releases';

export const cmsWorkbenchKeys = { drafts: contractKey(cmsWorkbenchContract.configurationDraft), review: contractKey(cmsReleaseContract.review) };
export const useCmsWorkbenchPreview = () => useApiMutation(cmsWorkbenchContract.preview);
export const useCmsConfigurationDraft = (siteId?: number, enabled = true) => useApiQuery(cmsWorkbenchContract.configurationDraft, { query: { siteId: siteId ?? 0 } }, { enabled: enabled && Boolean(siteId), staleTime: 0 });
export const useCmsReleaseReview = (id?: number) => useApiQuery(cmsReleaseContract.review, { params: { id: id ?? 0 } }, {
  enabled: Boolean(id), refetchInterval: (query) => query.state.data?.tasks.some((task) => task.status === 'pending' || task.status === 'running') ? 3000 : false,
});
export const useRecreateCmsRelease = () => useApiMutation(cmsReleaseContract.recreate, { invalidate: invalidateCmsReleases });
