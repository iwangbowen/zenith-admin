import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf } from '@zenith/shared/core';
import { reportMaterializationContract } from '@zenith/shared/report';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

/** 快照历史与当前快照互相派生，任何写操作整域失效 */
export const reportMaterializationKeys = {
  all: [resourceKeyOf(reportMaterializationContract.basePath)] as const,
  list: (params: { datasetId: number; page: number; pageSize: number }) => {
    const { datasetId, ...query } = params;
    return contractKey(reportMaterializationContract.snapshots, { params: { id: datasetId }, query });
  },
  current: (datasetId: number | undefined) => contractKey(reportMaterializationContract.current, { params: { id: datasetId ?? 0 } }),
};

const invalidateAll = {
  requestOptions: { silent: true },
  invalidate: (qc: QueryClient) => void qc.invalidateQueries({ queryKey: reportMaterializationKeys.all }),
} as const;

export function useReportMaterializationList(params: { datasetId: number; page: number; pageSize: number }, enabled = true) {
  const { datasetId, ...query } = params;
  return useApiQuery(reportMaterializationContract.snapshots, { params: { id: datasetId }, query }, {
    placeholderData: keepPreviousData,
    enabled: enabled && datasetId > 0,
  });
}

export function useCurrentReportMaterialization(datasetId: number | undefined, enabled = true) {
  return useApiQuery(reportMaterializationContract.current, { params: { id: datasetId ?? 0 } }, { enabled: enabled && !!datasetId });
}

export function useRefreshReportMaterialization() {
  return useApiMutation(reportMaterializationContract.refresh, invalidateAll);
}

export function usePurgeReportMaterialization() {
  return useApiMutation(reportMaterializationContract.purge, invalidateAll);
}

export function usePurgeDatasetMaterializations() {
  return useApiMutation(reportMaterializationContract.purgeDataset, invalidateAll);
}
