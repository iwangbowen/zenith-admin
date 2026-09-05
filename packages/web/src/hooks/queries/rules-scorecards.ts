import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import {
  ruleScorecardContract,
  type CreateRuleScorecardInput,
  type RuleScorecard,
  type UpdateRuleScorecardInput,
} from '@zenith/shared/rules';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type RuleScorecardListParams = NonNullable<QueryOf<typeof ruleScorecardContract.list>>;

/** 评分卡：独立命名空间（与决策表/名单同级），互不失效 */
export const ruleScorecardKeys = {
  all: [resourceKeyOf(ruleScorecardContract.basePath)] as const,
  lists: contractKey(ruleScorecardContract.list),
  list: (params: RuleScorecardListParams) => contractKey(ruleScorecardContract.list, { query: params }),
  versions: (id: number | undefined) => contractKey(ruleScorecardContract.versions, { params: { id: id ?? 0 } }),
};

const invalidateScorecards = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: ruleScorecardKeys.all });

export function useRuleScorecardList(params: RuleScorecardListParams) {
  return useApiQuery(ruleScorecardContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export type RuleScorecardSaveValues = Partial<CreateRuleScorecardInput & UpdateRuleScorecardInput>;

/** 无 id 走 create，有 id 走 update（key 仅创建时提交） */
export function useSaveRuleScorecard() {
  const qc = useQueryClient();
  return useMutation<RuleScorecard, Error, { id?: number; values: RuleScorecardSaveValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(ruleScorecardContract.create, { body: values as CreateRuleScorecardInput })
      : api(ruleScorecardContract.update, { params: { id }, body: values as UpdateRuleScorecardInput })),
    onSuccess: () => invalidateScorecards(qc),
  });
}

export function useDeleteRuleScorecard() {
  return useApiMutation(ruleScorecardContract.remove, { invalidate: invalidateScorecards });
}

export function usePublishRuleScorecard() {
  return useApiMutation(ruleScorecardContract.publish, { invalidate: invalidateScorecards });
}

export function useToggleRuleScorecard() {
  return useApiMutation(ruleScorecardContract.toggle, { invalidate: invalidateScorecards });
}

/** 测试求值：纯读操作，不触发失效 */
export function useEvaluateRuleScorecard() {
  return useApiMutation(ruleScorecardContract.evaluate);
}

export function useRuleScorecardVersions(id: number | undefined, enabled = true) {
  return useApiQuery(ruleScorecardContract.versions, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useRollbackRuleScorecard() {
  return useApiMutation(ruleScorecardContract.rollback, { invalidate: invalidateScorecards });
}
