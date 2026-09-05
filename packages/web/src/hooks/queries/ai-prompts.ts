import { aiPromptTemplateContract } from '@zenith/shared/ai';
import type { QueryOf } from '@zenith/shared/core';
import { api, createResourceQueries } from '@/lib/contract-query';

export type AiPromptListParams = NonNullable<QueryOf<typeof aiPromptTemplateContract.list>>;

/** 可用模板列表（对话角色选择器用）由模板集合派生，保存 / 删除后随 lookup 一并失效 */
export const {
  keys: aiPromptKeys,
  useList: useAiPromptList,
  useDetail: useAiPromptDetail,
  useSave: useSaveAiPrompt,
  useDelete: useDeleteAiPrompts,
  useLookup: useAvailableAiPrompts,
} = createResourceQueries(aiPromptTemplateContract);

/** 记录模板被应用为对话角色一次（使用统计，fire-and-forget 场景静默失败） */
export function recordAiPromptUse(id: number) {
  return api(aiPromptTemplateContract.use, { params: { id } }, { silent: true }).catch(() => {});
}
