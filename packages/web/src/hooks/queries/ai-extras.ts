import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  aiArenaContract,
  aiConversationContract,
  aiGenerationContract,
  aiKnowledgeBaseContract,
  aiPromptTemplateContract,
  aiSettingsContract,
} from '@zenith/shared/ai';
import type { AiKnowledgeBase, ArenaVoteInput, CreateAiKnowledgeBaseInput } from '@zenith/shared/ai';
import { resourceKeyOf, type BodyOf } from '@zenith/shared/core';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { aiPromptKeys } from './ai-prompts';

/* ─── 用户级 AI 设置（个人指令 / AI 记忆） ─────────────────────────────────── */

export const aiSettingsKeys = {
  me: contractKey(aiSettingsContract.me),
  memoryProfile: contractKey(aiSettingsContract.memoryProfile),
};

export function useAiSettings(enabled = true) {
  return useApiQuery(aiSettingsContract.me, { enabled, staleTime: LOOKUP_STALE_TIME });
}

export function useSaveAiSettings() {
  return useApiMutation(aiSettingsContract.save, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: aiSettingsKeys.me }),
  });
}

/** AI 记忆画像（working memory）：查看 */
export function useAiMemoryProfile(enabled = true) {
  return useApiQuery(aiSettingsContract.memoryProfile, { enabled });
}

/** AI 记忆画像：编辑保存 */
export function useSaveAiMemoryProfile() {
  return useApiMutation(aiSettingsContract.saveMemoryProfile, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: aiSettingsKeys.memoryProfile }),
  });
}

/** AI 记忆画像：清空 */
export function useClearAiMemoryProfile() {
  return useApiMutation(aiSettingsContract.clearMemoryProfile, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: aiSettingsKeys.memoryProfile }),
  });
}

/* ─── 对话分享 ────────────────────────────────────────────────────────────── */

export const aiShareKeys = {
  share: (convId: number | null) => contractKey(aiConversationContract.shareInfo, { params: { id: convId ?? 0 } }),
};

export function useConversationShare(convId: number | null) {
  return useApiQuery(aiConversationContract.shareInfo, { params: { id: convId ?? 0 } }, { enabled: convId !== null });
}

export function useCreateConversationShare() {
  return useApiMutation(aiConversationContract.share, {
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: aiShareKeys.share(params.id) }),
  });
}

export function useRevokeConversationShare() {
  return useApiMutation(aiConversationContract.revokeShare, {
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: aiShareKeys.share(params.id) }),
  });
}

/* ─── 知识库 ─────────────────────────────────────────────────────────────── */

/** 新增与编辑共用同一表单：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
export type SaveAiKnowledgeBaseValues = Partial<CreateAiKnowledgeBaseInput>;

export const aiKbKeys = {
  all: [resourceKeyOf(aiKnowledgeBaseContract.basePath)] as const,
  lists: contractKey(aiKnowledgeBaseContract.list),
  /** 聊天挂载选择器（/available）由知识库集合派生 */
  available: contractKey(aiKnowledgeBaseContract.all),
  docs: (kbId: number | null) => contractKey(aiKnowledgeBaseContract.documents, { params: { id: kbId ?? 0 } }),
  chunks: (kbId: number | null, docId: number | null) =>
    contractKey(aiKnowledgeBaseContract.chunks, { params: { id: kbId ?? 0, docId: docId ?? 0 } }),
};

export function useAiKnowledgeBases() {
  return useApiQuery(aiKnowledgeBaseContract.list);
}

/** 聊天挂载选择器用（无需 kb:list 权限） */
export function useAvailableKnowledgeBases(enabled = true) {
  return useApiQuery(aiKnowledgeBaseContract.all, { enabled, staleTime: LOOKUP_STALE_TIME });
}

/** 无 id 走创建，有 id 走更新；文档列表不受知识库改名影响，故不失效 */
export function useSaveAiKnowledgeBase() {
  const qc = useQueryClient();
  return useMutation<AiKnowledgeBase, Error, { id?: number; values: SaveAiKnowledgeBaseValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(aiKnowledgeBaseContract.create, { body: values as BodyOf<typeof aiKnowledgeBaseContract.create> })
        : api(aiKnowledgeBaseContract.update, { params: { id }, body: values }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiKbKeys.lists });
      void qc.invalidateQueries({ queryKey: aiKbKeys.available });
    },
  });
}

export function useDeleteAiKnowledgeBase() {
  return useApiMutation(aiKnowledgeBaseContract.remove, {
    invalidate: (qc, _output, { params }) => {
      // 知识库删除后其文档缓存不再有对应资源
      qc.removeQueries({ queryKey: aiKbKeys.docs(params.id) });
      void qc.invalidateQueries({ queryKey: aiKbKeys.lists });
      void qc.invalidateQueries({ queryKey: aiKbKeys.available });
    },
  });
}

export function useAiKbDocuments(kbId: number | null) {
  return useApiQuery(aiKnowledgeBaseContract.documents, { params: { id: kbId ?? 0 } }, { enabled: kbId !== null });
}

/** 文档分块内容（回看原文） */
export function useAiKbChunks(kbId: number | null, docId: number | null) {
  return useApiQuery(aiKnowledgeBaseContract.chunks, { params: { id: kbId ?? 0, docId: docId ?? 0 } }, {
    enabled: kbId !== null && docId !== null,
  });
}

/** 文档增删改变知识库的文档数 / 分块数，列表与选择器一并失效 */
function invalidateKbDocuments(qc: ReturnType<typeof useQueryClient>, kbId: number) {
  void qc.invalidateQueries({ queryKey: aiKbKeys.docs(kbId) });
  void qc.invalidateQueries({ queryKey: aiKbKeys.lists });
  void qc.invalidateQueries({ queryKey: aiKbKeys.available });
}

export function useAddAiKbDocument() {
  return useApiMutation(aiKnowledgeBaseContract.addDocument, {
    invalidate: (qc, _output, { params }) => invalidateKbDocuments(qc, params.id),
  });
}

/** 从 URL 抓取网页正文入库 */
export function useImportAiKbUrl() {
  return useApiMutation(aiKnowledgeBaseContract.importUrl, {
    invalidate: (qc, _output, { params }) => invalidateKbDocuments(qc, params.id),
  });
}

export function useDeleteAiKbDocument() {
  return useApiMutation(aiKnowledgeBaseContract.removeDocument, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: aiKbKeys.docs(params.id) });
      void qc.invalidateQueries({ queryKey: aiKbKeys.lists });
    },
  });
}

/* ─── 对话挂载知识库 ─────────────────────────────────────────────────────── */

export function setConversationKb(convId: number, kbId: number | null) {
  return api(aiConversationContract.setKnowledgeBase, { params: { id: convId }, body: { kbId } });
}

/* ─── Arena 投票 ─────────────────────────────────────────────────────────── */

export function submitArenaVote(values: ArenaVoteInput) {
  return api(aiArenaContract.vote, { body: values });
}

/* ─── 对话标签 / 分支 / 生成续传 ─────────────────────────────────────────── */

export function setConversationTags(convId: number, tags: string[]) {
  return api(aiConversationContract.setTags, { params: { id: convId }, body: { tags } });
}

/** 切换消息分支（返回新的激活叶子） */
export function switchConversationBranch(convId: number, leafMsgId: number) {
  return api(aiConversationContract.switchBranch, { params: { id: convId }, body: { leafMsgId } });
}

/** 查询对话进行中的生成任务（刷新后续传） */
export function getActiveGeneration(convId: number) {
  return api(aiConversationContract.activeGeneration, { params: { id: convId } }, { silent: true });
}

/** 停止生成 */
export function cancelGeneration(genId: string) {
  return api(aiGenerationContract.cancel, { params: { genId } }, { silent: true });
}

/* ─── 提示词模板版本 ─────────────────────────────────────────────────────── */

export const aiPromptVersionKeys = {
  list: (templateId: number | null) => contractKey(aiPromptTemplateContract.versions, { params: { id: templateId ?? 0 } }),
};

export function useAiPromptVersions(templateId: number | null) {
  return useApiQuery(aiPromptTemplateContract.versions, { params: { id: templateId ?? 0 } }, { enabled: templateId !== null });
}

/** 恢复历史版本会改写模板内容并新增一条留档：版本列表与模板本身都要刷新 */
export function useRestoreAiPromptVersion() {
  return useApiMutation(aiPromptTemplateContract.restoreVersion, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: aiPromptVersionKeys.list(params.id) });
      void qc.invalidateQueries({ queryKey: aiPromptKeys.all });
    },
  });
}
