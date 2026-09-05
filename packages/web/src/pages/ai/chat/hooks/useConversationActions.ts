import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { QueryClient } from '@tanstack/react-query';
import type { AiConversation, AiPromptTemplate } from '@zenith/shared/ai';
import { aiConversationContract } from '@zenith/shared/ai';
import { request } from '@/utils/request';
import { api, urlOf } from '@/lib/contract-query';
import { recordAiPromptUse } from '@/hooks/queries/ai-prompts';
import { setConversationKb, setConversationTags } from '@/hooks/queries/ai-extras';
import { aiConversationKeys, type useCreateAiConversation } from '@/hooks/queries/ai-conversations';
import { abortSubmit } from '@/lib/abort-submit';
import type { ChatMessage as Message } from '../message-adapters';
import { extractPromptVariables } from '../chat-utils';

interface UseConversationActionsOptions {
  queryClient: QueryClient;
  activeConvId: number | null;
  setActiveConvId: Dispatch<SetStateAction<number | null>>;
  setConversations: Dispatch<SetStateAction<AiConversation[]>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setShowArchived: Dispatch<SetStateAction<boolean>>;
  createConversationMutation: ReturnType<typeof useCreateAiConversation>;
  /** 新会话入列并激活（清空消息树） */
  activateNewConversation: (conv: AiConversation) => void;
}

/**
 * 会话级操作：新建 / 删除 / 重命名 / 置顶 / 归档 / 角色模板 / 知识库 / 标签 / 导出 / 点踩反馈，
 * 以及各操作弹窗的开关状态；`?agentId=` 入口自动以该智能体开启新对话。
 * 列表本地镜像先行更新，再由 query 失效兜底一致性。
 */
export function useConversationActions({
  queryClient, activeConvId, setActiveConvId, setConversations, setMessages, setShowArchived,
  createConversationMutation, activateNewConversation,
}: UseConversationActionsOptions) {
  const [renameConvId, setRenameConvId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');
  const [dislikeMsgId, setDislikeMsgId] = useState<number | null>(null);
  const [varFillTemplate, setVarFillTemplate] = useState<AiPromptTemplate | null>(null);
  const varFormApi = useRef<FormApi | null>(null);
  const [shareConvId, setShareConvId] = useState<number | null>(null);
  /** 标签编辑 */
  const [tagsConvId, setTagsConvId] = useState<number | null>(null);
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  const handleNewConversation = async () => {
    try {
      setShowArchived(false);
      const newConv = await createConversationMutation.mutateAsync({ body: { title: '新对话' } });
      activateNewConversation(newConv);
    } catch {
      Toast.error('创建对话失败');
    }
  };

  // ?agentId= 入口：从智能体页跳转，自动以该智能体开启新对话
  const agentParamHandled = useRef(false);
  useEffect(() => {
    const agentIdStr = searchParams.get('agentId');
    if (!agentIdStr || agentParamHandled.current) return;
    agentParamHandled.current = true;
    const agentId = Number(agentIdStr);
    setSearchParams({}, { replace: true });
    if (!Number.isFinite(agentId)) return;
    void (async () => {
      try {
        setShowArchived(false);
        const newConv = await createConversationMutation.mutateAsync({ body: { title: '新对话', agentId } });
        activateNewConversation(newConv);
      } catch { /* 请求层已提示 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅处理一次入口参数
  }, [searchParams]);

  const handleDeleteConversation = async (id: number) => {
    try {
      await api(aiConversationContract.remove, { params: { id } });
      void queryClient.invalidateQueries({ queryKey: aiConversationKeys.all });
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (activeConvId === id) {
          setActiveConvId(remaining[0]?.id ?? null);
          setMessages([]);
        }
        return remaining;
      });
    } catch {
      Toast.error('删除对话失败');
    }
  };

  const openRename = (conv: AiConversation) => {
    setRenameText(conv.title);
    setRenameConvId(conv.id);
  };

  const handleRenameConv = async () => {
    if (!renameConvId || !renameText.trim()) return;
    try {
      await api(aiConversationContract.rename, { params: { id: renameConvId }, body: { title: renameText.trim() } });
      void queryClient.invalidateQueries({ queryKey: aiConversationKeys.all });
      setConversations((prev) => prev.map((c) => c.id === renameConvId ? { ...c, title: renameText.trim() } : c));
      setRenameConvId(null);
    } catch {
      Toast.error('重命名失败');
    }
  };

  const handleTogglePin = async (id: number) => {
    try {
      const { isPinned: pinned } = await api(aiConversationContract.pin, { params: { id } });
      void queryClient.invalidateQueries({ queryKey: aiConversationKeys.all });
      setConversations((prev) => {
        const updated = prev.map((c) => c.id === id ? { ...c, isPinned: pinned } : c);
        // 重新排序：置顶在前
        return [...updated.filter((c) => c.isPinned), ...updated.filter((c) => !c.isPinned)];
      });
      Toast.success(pinned ? '已置顶' : '已取消置顶');
    } catch {
      Toast.error('操作失败');
    }
  };

  const handleToggleArchive = async (id: number) => {
    try {
      const { isArchived: archived } = await api(aiConversationContract.archive, { params: { id } });
      void queryClient.invalidateQueries({ queryKey: aiConversationKeys.all });
      // 归档状态改变后，会话从当前视图（与归档状态相反）移除
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConvId === id) { setActiveConvId(null); setMessages([]); }
      Toast.success(archived ? '已归档' : '已取消归档');
    } catch {
      Toast.error('操作失败');
    }
  };

  const handleApplyTemplate = async (content: string | null, templateId?: number) => {
    if (!activeConvId) { Toast.warning('请先选择或创建对话'); return; }
    try {
      await api(aiConversationContract.setSystemPrompt, { params: { id: activeConvId }, body: { systemPrompt: content } });
      setConversations((prev) => prev.map((c) => c.id === activeConvId ? { ...c, systemPromptOverride: content } : c));
      Toast.success(content ? '已应用角色' : '已清除角色');
      // 使用统计（fire-and-forget）
      if (content && templateId) void recordAiPromptUse(templateId);
    } catch {
      Toast.error('操作失败');
    }
  };

  /** 选择模板：含 {{变量}} 时先弹出填充表单，否则直接应用 */
  const handleSelectTemplate = (t: AiPromptTemplate) => {
    if (!activeConvId) { Toast.warning('请先选择或创建对话'); return; }
    const vars = extractPromptVariables(t.content);
    if (vars.length === 0) {
      void handleApplyTemplate(t.content, t.id);
      return;
    }
    setVarFillTemplate(t);
  };

  const handleVarFillOk = async () => {
    const t = varFillTemplate;
    if (!t) return;
    let values: Record<string, string>;
    try {
      values = (await varFormApi.current?.validate()) as Record<string, string>;
    } catch {
      abortSubmit('validation');
    }
    const filled = t.content.replaceAll(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => values[name]?.trim() ?? '');
    await handleApplyTemplate(filled, t.id);
    setVarFillTemplate(null);
  };

  /** 挂载 / 取消挂载知识库 */
  const handleSetKb = async (kbId: number | null) => {
    if (!activeConvId) { Toast.warning('请先选择或创建对话'); return; }
    try {
      await setConversationKb(activeConvId, kbId);
      setConversations((prev) => prev.map((c) => c.id === activeConvId ? { ...c, knowledgeBaseId: kbId } : c));
      Toast.success(kbId ? '已挂载知识库' : '已取消挂载');
    } catch {
      Toast.error('操作失败');
    }
  };

  const openTags = (conv: AiConversation) => {
    setTagsDraft(conv.tags ?? []);
    setTagsConvId(conv.id);
  };

  /** 标签编辑保存 */
  const handleSaveTags = async () => {
    if (!tagsConvId) return;
    try {
      const cleaned = await setConversationTags(tagsConvId, tagsDraft);
      setConversations((prev) => prev.map((c) => (c.id === tagsConvId ? { ...c, tags: cleaned.tags } : c)));
      Toast.success('标签已更新');
      setTagsConvId(null);
    } catch { /* 请求层已提示 */ }
  };

  const handleExportConversation = (id: number, title: string, format: 'md' | 'json') => {
    void request.download(urlOf(aiConversationContract.exportFile, { params: { id }, query: { format } }), `${title || '对话'}.${format}`);
  };

  const submitDislikeReason = useCallback((reason: string | null) => {
    const dbId = dislikeMsgId;
    setDislikeMsgId(null);
    if (!dbId || !activeConvId || !reason) return;
    void api(aiConversationContract.submitFeedback, { params: { id: activeConvId, msgId: dbId }, body: { feedback: -1, reason } })
      .then(() => Toast.success('感谢反馈，已记录'))
      .catch(() => {});
  }, [dislikeMsgId, activeConvId]);

  return {
    handleNewConversation,
    handleDeleteConversation,
    handleTogglePin,
    handleToggleArchive,
    handleApplyTemplate,
    handleSelectTemplate,
    handleSetKb,
    handleExportConversation,
    rename: { convId: renameConvId, text: renameText, setText: setRenameText, open: openRename, close: () => setRenameConvId(null), submit: handleRenameConv },
    dislike: { msgId: dislikeMsgId, open: setDislikeMsgId, close: () => setDislikeMsgId(null), submit: submitDislikeReason },
    varFill: { template: varFillTemplate, formApiRef: varFormApi, close: () => setVarFillTemplate(null), submit: handleVarFillOk },
    share: { convId: shareConvId, open: setShareConvId, close: () => setShareConvId(null) },
    tags: { convId: tagsConvId, draft: tagsDraft, setDraft: setTagsDraft, open: openTags, close: () => setTagsConvId(null), submit: handleSaveTags },
  };
}
