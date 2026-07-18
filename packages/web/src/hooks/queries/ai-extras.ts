import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiUserPreference, AiConversationShare, AiKnowledgeBase, AiKbDocument, SaveAiPreferenceInput, CreateAiKnowledgeBaseInput, AddAiKbDocumentInput, ImportAiKbUrlInput, AiPromptTemplateVersion } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, unwrap } from '@/lib/query';

/* ─── 个人指令（Custom Instructions） ─────────────────────────────────────── */

export const aiPreferenceKeys = {
  me: ['ai-preferences', 'me'] as const,
};

export function useAiPreference(enabled = true) {
  return useQuery({
    queryKey: aiPreferenceKeys.me,
    queryFn: () => request.get<AiUserPreference>('/api/ai/preferences').then(unwrap),
    enabled,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveAiPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: SaveAiPreferenceInput) =>
      request.put<AiUserPreference>('/api/ai/preferences', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiPreferenceKeys.me }),
  });
}

/* ─── 对话分享 ────────────────────────────────────────────────────────────── */

export const aiShareKeys = {
  share: (convId: number | null) => ['ai-share', convId] as const,
};

export function useConversationShare(convId: number | null) {
  return useQuery({
    queryKey: aiShareKeys.share(convId),
    queryFn: () => request.get<AiConversationShare | null>(`/api/ai/conversations/${convId}/share`).then(unwrap),
    enabled: convId !== null,
  });
}

export function useCreateConversationShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ convId, expiresDays }: { convId: number; expiresDays: number }) =>
      request.post<AiConversationShare>(`/api/ai/conversations/${convId}/share`, { expiresDays }).then(unwrap),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: aiShareKeys.share(v.convId) }),
  });
}

export function useRevokeConversationShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (convId: number) => request.delete<null>(`/api/ai/conversations/${convId}/share`).then(unwrap),
    onSuccess: (_d, convId) => qc.invalidateQueries({ queryKey: aiShareKeys.share(convId) }),
  });
}

/* ─── 知识库 ─────────────────────────────────────────────────────────────── */

export const aiKbKeys = {
  all: ['ai-kb'] as const,
  lists: ['ai-kb', 'list'] as const,
  available: ['ai-kb', 'available'] as const,
  docs: (kbId: number | null) => ['ai-kb', 'docs', kbId] as const,
};

export function useAiKnowledgeBases() {
  return useQuery({
    queryKey: aiKbKeys.lists,
    queryFn: () => request.get<AiKnowledgeBase[]>('/api/ai/knowledge-bases').then(unwrap),
  });
}

/** 聊天挂载选择器用（无需 kb:list 权限） */
export function useAvailableKnowledgeBases(enabled = true) {
  return useQuery({
    queryKey: aiKbKeys.available,
    queryFn: () => request.get<AiKnowledgeBase[]>('/api/ai/knowledge-bases/available').then(unwrap),
    enabled,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveAiKnowledgeBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CreateAiKnowledgeBaseInput }) =>
      (id === undefined
        ? request.post<AiKnowledgeBase>('/api/ai/knowledge-bases', values)
        : request.put<AiKnowledgeBase>(`/api/ai/knowledge-bases/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKbKeys.all }),
  });
}

export function useDeleteAiKnowledgeBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/ai/knowledge-bases/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKbKeys.all }),
  });
}

export function useAiKbDocuments(kbId: number | null) {
  return useQuery({
    queryKey: aiKbKeys.docs(kbId),
    queryFn: () => request.get<AiKbDocument[]>(`/api/ai/knowledge-bases/${kbId}/documents`).then(unwrap),
    enabled: kbId !== null,
  });
}

export function useAddAiKbDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, values }: { kbId: number; values: AddAiKbDocumentInput }) =>
      request.post<AiKbDocument>(`/api/ai/knowledge-bases/${kbId}/documents`, values).then(unwrap),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: aiKbKeys.docs(v.kbId) });
      void qc.invalidateQueries({ queryKey: aiKbKeys.lists });
      void qc.invalidateQueries({ queryKey: aiKbKeys.available });
    },
  });
}

/** 从 URL 抓取网页正文入库 */
export function useImportAiKbUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, values }: { kbId: number; values: ImportAiKbUrlInput }) =>
      request.post<AiKbDocument>(`/api/ai/knowledge-bases/${kbId}/documents/import-url`, values).then(unwrap),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: aiKbKeys.docs(v.kbId) });
      void qc.invalidateQueries({ queryKey: aiKbKeys.lists });
      void qc.invalidateQueries({ queryKey: aiKbKeys.available });
    },
  });
}

export function useDeleteAiKbDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, docId }: { kbId: number; docId: number }) =>
      request.delete<null>(`/api/ai/knowledge-bases/${kbId}/documents/${docId}`).then(unwrap),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: aiKbKeys.docs(v.kbId) });
      void qc.invalidateQueries({ queryKey: aiKbKeys.lists });
    },
  });
}

/* ─── 对话挂载知识库 ─────────────────────────────────────────────────────── */

export function setConversationKb(convId: number, kbId: number | null) {
  return request.put<null>(`/api/ai/conversations/${convId}/knowledge-base`, { kbId }).then(unwrap);
}

/* ─── Arena 投票 ─────────────────────────────────────────────────────────── */

export function submitArenaVote(values: { question: string; modelA: string; modelB: string; winner: 'a' | 'b' | 'tie' }) {
  return request.post<null>('/api/ai/arena/vote', values).then(unwrap);
}

/* ─── 对话标签 / 分支 / 生成续传 ─────────────────────────────────────────── */

export function setConversationTags(convId: number, tags: string[]) {
  return request.put<{ tags: string[] }>(`/api/ai/conversations/${convId}/tags`, { tags }).then(unwrap);
}

/** 切换消息分支（返回新的激活叶子） */
export function switchConversationBranch(convId: number, leafMsgId: number) {
  return request.put<{ activeLeafMsgId: number }>(`/api/ai/conversations/${convId}/active-branch`, { leafMsgId }).then(unwrap);
}

/** 查询对话进行中的生成任务（刷新后续传） */
export function getActiveGeneration(convId: number) {
  return request.get<{ genId: string | null }>(`/api/ai/conversations/${convId}/active-generation`, { silent: true }).then(unwrap);
}

/** 停止生成 */
export function cancelGeneration(genId: string) {
  return request.post<null>(`/api/ai/generations/${genId}/cancel`, undefined, { silent: true }).then(unwrap);
}

/* ─── 提示词模板版本 ─────────────────────────────────────────────────────── */

export const aiPromptVersionKeys = {
  list: (templateId: number | null) => ['ai-prompt-versions', templateId] as const,
};

export function useAiPromptVersions(templateId: number | null) {
  return useQuery({
    queryKey: aiPromptVersionKeys.list(templateId),
    queryFn: () => request.get<AiPromptTemplateVersion[]>(`/api/ai/prompt-templates/${templateId}/versions`).then(unwrap),
    enabled: templateId !== null,
  });
}

export function useRestoreAiPromptVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, versionId }: { templateId: number; versionId: number }) =>
      request.post(`/api/ai/prompt-templates/${templateId}/versions/${versionId}/restore`).then(unwrap),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: aiPromptVersionKeys.list(v.templateId) });
      void qc.invalidateQueries({ queryKey: ['ai-prompts'] });
    },
  });
}
