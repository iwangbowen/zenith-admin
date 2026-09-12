import type { QueryOf } from '@zenith/shared/core';
import { workflowHealthContract } from '@zenith/shared/workflow';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type WorkflowHealthParams = QueryOf<typeof workflowHealthContract.summary>;

export const workflowHealthKeys = {
  /** 健康汇总全部阈值条件的公共前缀（健康页「查询」按钮回源用） */
  all: contractKey(workflowHealthContract.summary),
  summary: (params: WorkflowHealthParams) => contractKey(workflowHealthContract.summary, { query: params }),
};

export function useWorkflowHealthSummary(params: WorkflowHealthParams) {
  return useApiQuery(workflowHealthContract.summary, { query: params });
}
