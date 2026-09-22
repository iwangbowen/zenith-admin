// Watch state belongs to the authenticated user, including the selected tenant view.
// eslint-disable-next-line no-restricted-imports
import { useQuery } from '@tanstack/react-query';
import { entityWatchContract, isWatchableEntityType, type CanonicalEntityRef } from '@zenith/shared/platform';
import { apiQueryOptions, contractKey, useApiMutation } from '@/lib/contract-query';
import { useEntityAccessKey } from './entity-relations';

export function useEntityWatch(ref: CanonicalEntityRef) {
  const access = useEntityAccessKey();
  const options = apiQueryOptions(entityWatchContract.state, { params: ref }, { enabled: isWatchableEntityType(ref.type) && access[0] !== null,
    staleTime: 15_000, refetchOnWindowFocus: true, retry: false, requestOptions: { silent: true } });
  return useQuery({ ...options, queryKey: [...options.queryKey, access] });
}
export function useFollowEntity() {
  return useApiMutation(entityWatchContract.follow, { invalidate: (qc) => { void qc.invalidateQueries({ queryKey: contractKey(entityWatchContract.state) }); } });
}
export function useUnfollowEntity() {
  return useApiMutation(entityWatchContract.unfollow, { invalidate: (qc) => { void qc.invalidateQueries({ queryKey: contractKey(entityWatchContract.state) }); } });
}
