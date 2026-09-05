import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';
import { aiEvalContract } from '@zenith/shared/ai';
import type { AiEvalDataset, AiEvalExperiment, CreateAiEvalDatasetInput, UpdateAiEvalDatasetInput } from '@zenith/shared/ai';
import { resourceKeyOf } from '@zenith/shared/core';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const aiEvalKeys = {
  all: [resourceKeyOf(aiEvalContract.basePath)] as const,
  datasets: contractKey(aiEvalContract.list),
  items: (datasetId: string | null) => contractKey(aiEvalContract.items, { params: { id: datasetId ?? '' } }),
  experiments: (datasetId: string | null) => contractKey(aiEvalContract.experiments, { params: { id: datasetId ?? '' } }),
  experimentDetail: (datasetId: string | null, experimentId: string | null) =>
    contractKey(aiEvalContract.experimentDetail, { params: { id: datasetId ?? '', experimentId: experimentId ?? '' } }),
};

/** 评测集、条目与实验互相派生（条目数 / 版本号 / 实验计数），任何写操作后整体失效本域 */
function invalidateAiEval(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: aiEvalKeys.all });
}

export function useAiEvalDatasets() {
  return useApiQuery(aiEvalContract.list);
}

export function useAiEvalItems(datasetId: string | null) {
  return useApiQuery(aiEvalContract.items, { params: { id: datasetId ?? '' } }, { enabled: datasetId !== null });
}

/** 无 id 走创建，有 id 走更新（Mastra dataset ID 为字符串，不走 useEditModal） */
export function useSaveAiEvalDataset() {
  const qc = useQueryClient();
  return useMutation<AiEvalDataset, Error, { id?: string; values: CreateAiEvalDatasetInput | UpdateAiEvalDatasetInput }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(aiEvalContract.create, { body: values as CreateAiEvalDatasetInput })
        : api(aiEvalContract.update, { params: { id }, body: values }),
    onSuccess: () => invalidateAiEval(qc),
  });
}

export function useDeleteAiEvalDataset() {
  return useApiMutation(aiEvalContract.remove, { invalidate: invalidateAiEval });
}

export function useAddAiEvalItems() {
  return useApiMutation(aiEvalContract.addItems, { invalidate: invalidateAiEval });
}

export function useDeleteAiEvalItem() {
  return useApiMutation(aiEvalContract.removeItem, { invalidate: invalidateAiEval });
}

export function useRunAiExperiment() {
  return useApiMutation(aiEvalContract.runExperiment, { invalidate: invalidateAiEval });
}

type ExperimentsRefetchInterval = UseQueryOptions<AiEvalExperiment[], Error, AiEvalExperiment[], readonly unknown[]>['refetchInterval'];

export function useAiEvalExperiments(datasetId: string | null, refetchInterval?: ExperimentsRefetchInterval) {
  return useApiQuery(aiEvalContract.experiments, { params: { id: datasetId ?? '' } }, {
    enabled: datasetId !== null,
    refetchInterval,
  });
}

export function useAiEvalExperimentDetail(datasetId: string | null, experimentId: string | null) {
  return useApiQuery(aiEvalContract.experimentDetail, { params: { id: datasetId ?? '', experimentId: experimentId ?? '' } }, {
    enabled: datasetId !== null && experimentId !== null,
  });
}
