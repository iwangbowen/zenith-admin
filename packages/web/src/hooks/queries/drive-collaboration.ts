import type { QueryOf } from '@zenith/shared/core';
import { driveAdminContract, driveCollaborationContract, driveTagContract, driveNodeContract } from '@zenith/shared/drive';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { driveKeys } from './drive';

export function useDriveProfile(nodeId: number) {
  return useApiQuery(driveCollaborationContract.profile, { params: { id: nodeId } });
}

export function useHandoffDriveSpace() {
  return useApiMutation(driveAdminContract.handoff, {
    invalidate: (qc, _saved, { params }) => {
      qc.removeQueries({ queryKey: driveKeys.spaceDetail(params.id) });
      // A handoff moves every descendant and invalidates the source space as a whole.
      for (const queryKey of [driveKeys.mySpaces, driveKeys.spaceLists, driveKeys.spaceDetails,
        driveKeys.adminSpacesPrefix, driveKeys.adminStats, driveKeys.dirs,
        contractKey(driveNodeContract.detail), contractKey(driveNodeContract.permissions),
        contractKey(driveCollaborationContract.profile)]) void qc.invalidateQueries({ queryKey });
    },
  });
}
export function useSaveDriveProfile(spaceId: number) {
  return useApiMutation(driveCollaborationContract.saveProfile, {
    invalidate: (qc, saved) => {
      void qc.invalidateQueries({ queryKey: contractKey(driveCollaborationContract.profile, { params: { id: saved.nodeId } }) });
      void qc.invalidateQueries({ queryKey: driveKeys.activitiesOf(saved.nodeId) });
      void qc.invalidateQueries({ queryKey: contractKey(driveCollaborationContract.spaceActivities, { params: { id: spaceId }, query: {} }) });
    },
  });
}
export function useDriveSubscription(nodeId: number) {
  return useApiQuery(driveCollaborationContract.subscription, { params: { id: nodeId } });
}
export function useSubscribeDriveNode() {
  return useApiMutation(driveCollaborationContract.subscribe, {
    invalidate: (qc, _saved, { params }) => void qc.invalidateQueries({ queryKey: contractKey(driveCollaborationContract.subscription, { params }) }),
  });
}
export function useEditDriveComment(spaceId: number) {
  return useApiMutation(driveCollaborationContract.editComment, {
    invalidate: (qc, _saved, { params }) => {
      void qc.invalidateQueries({ queryKey: driveKeys.comments(params.id) });
      void qc.invalidateQueries({ queryKey: driveKeys.activitiesOf(params.id) });
      void qc.invalidateQueries({ queryKey: contractKey(driveCollaborationContract.spaceActivities, { params: { id: spaceId }, query: {} }) });
    },
  });
}
export function useDriveSpaceActivities(spaceId: number | undefined, query: NonNullable<QueryOf<typeof driveCollaborationContract.spaceActivities>>) {
  return useApiQuery(driveCollaborationContract.spaceActivities, { params: { id: spaceId ?? 0 }, query }, { enabled: spaceId !== undefined });
}
export function useMergeDriveTags(spaceId: number) {
  return useApiMutation(driveTagContract.merge, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: driveKeys.tags(spaceId) });
      void qc.invalidateQueries({ queryKey: [...driveKeys.dirs, spaceId] });
      void qc.invalidateQueries({ queryKey: contractKey(driveNodeContract.detail), predicate: (query) => {
        const data = query.state.data;
        return !!data && typeof data === 'object' && 'spaceId' in data && data.spaceId === spaceId;
      } });
      void qc.invalidateQueries({ queryKey: driveKeys.viewOf('search') });
    },
  });
}
