import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import type { QueryClient } from '@tanstack/react-query';
import type { AiConversation, AiMessage, AiReasoningLevel, SendAiChatMessageInput } from '@zenith/shared/ai';
import { aiConversationContract, aiGenerationContract } from '@zenith/shared/ai';
import { request } from '@/utils/request';
import { readSseStream } from '@/utils/streaming';
import { urlOf } from '@/lib/contract-query';
import { getActiveGeneration, cancelGeneration } from '@/hooks/queries/ai-extras';
import { aiConversationKeys, type useCreateAiConversation } from '@/hooks/queries/ai-conversations';
import { healStreamingMarkdown } from '@/utils/streaming-markdown';
import {
  buildAssistantContent,
  buildUserContent,
  type ChatMessage as Message,
  type ToolCallDisplay,
  type KbRefDisplay,
} from '../message-adapters';
import { dbIdOf, nextMsgId, type AIChatDialogueInstance } from '../chat-utils';

interface UseChatGenerationOptions {
  queryClient: QueryClient;
  activeConvId: number | null;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setConversations: Dispatch<SetStateAction<AiConversation[]>>;
  /** 全量消息树（编辑重发时定位被编辑消息的父节点） */
  allApiMessages: AiMessage[];
  setActiveLeafId: Dispatch<SetStateAction<number | null>>;
  generating: boolean;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  /** 待发送图片（vision，data URL） */
  pendingImages: string[];
  setPendingImages: Dispatch<SetStateAction<string[]>>;
  /** AIChatInput Configure 区当前取值（model / reasoning） */
  configureValuesRef: RefObject<Record<string, unknown>>;
  dialogueRef: RefObject<AIChatDialogueInstance | null>;
  createConversationMutation: ReturnType<typeof useCreateAiConversation>;
  /** 新会话入列并激活（清空消息树） */
  activateNewConversation: (conv: AiConversation) => void;
}

/**
 * 消息生成链路：SSE 事件消费、发送（含自动建会话）、断线续传、停止、重新生成与编辑重发。
 * 流式期间以本地气泡为准，落库（saved）后把本地 ID 映射为数据库 ID 并同步分支叶子。
 */
export function useChatGeneration({
  queryClient, activeConvId, messages, setMessages, setConversations, allApiMessages, setActiveLeafId,
  generating, setGenerating, pendingImages, setPendingImages, configureValuesRef, dialogueRef,
  createConversationMutation, activateNewConversation,
}: UseChatGenerationOptions) {
  const abortRef = useRef<AbortController | null>(null);
  /** 当前生成任务 ID（停止 / 断线续传用） */
  const currentGenIdRef = useRef<string | null>(null);

  /** SSE 事件消费（发送与断线续传共用）。skipUserEvent：发起端已本地渲染 user 气泡时跳过缓冲中的 user 事件 */
  const consumeSSEStream = useCallback(async (
    response: Response,
    ctx: { convId: number; assistantMsgId: string; localUserMsgId: string | null; skipUserEvent: boolean },
  ) => {
    const { convId, assistantMsgId, localUserMsgId, skipUserEvent } = ctx;
    if (!response.body) throw new Error('No response body');
    let accContent = '';
    let accReasoning = '';
    const accToolCalls: ToolCallDisplay[] = [];
    let accReferences: KbRefDisplay[] = [];

    const refreshAssistant = () => {
      // 流式自愈:补全未闭合 markdown(粗体/行内代码/链接),消除原始符号闪现
      const nextContent = buildAssistantContent(healStreamingMarkdown(accContent), healStreamingMarkdown(accReasoning), accContent.length > 0, accToolCalls, accReferences);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, content: nextContent } : m))
      );
    };

    await readSseStream(response, (events) => {
      for (const { event: eventType, data: dataStr } of events) {
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr) as Record<string, unknown>;
          if (eventType === 'gen') {
            // 生成任务 ID：停止 / 断线续传凭据
            currentGenIdRef.current = (parsed.genId as string) ?? null;
          } else if (eventType === 'user') {
            // 续传场景：缓冲中回放的用户消息（发起端已本地渲染，跳过）
            if (!skipUserEvent && parsed.content) {
              const userMsg: Message = { id: nextMsgId(), role: 'user', content: parsed.content as string, createdAt: Date.now() - 1, status: 'completed' };
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === assistantMsgId);
                if (idx === -1) return [...prev, userMsg];
                return [...prev.slice(0, idx), userMsg, ...prev.slice(idx)];
              });
            }
          } else if (eventType === 'delta' && parsed.content) {
            accContent += (parsed.content as string | undefined) ?? '';
            refreshAssistant();
          } else if (eventType === 'reasoning' && parsed.content) {
            accReasoning += (parsed.content as string | undefined) ?? '';
            refreshAssistant();
          } else if (eventType === 'tool_call') {
            // function calling 执行过程
            accToolCalls.push({
              name: (parsed.name as string) ?? '',
              arguments: (parsed.arguments as string) ?? '',
              result: (parsed.result as string) ?? '',
            });
            refreshAssistant();
          } else if (eventType === 'references') {
            // 知识库检索引用
            accReferences = (parsed.references as KbRefDisplay[]) ?? [];
            refreshAssistant();
          } else if (eventType === 'failover') {
            Toast.info(`当前模型响应异常，已自动切换到备用模型（${(parsed.to as string) ?? ''}）`);
          } else if (eventType === 'saved') {
            // 服务端保存完成：本地气泡映射数据库 ID，并同步分支叶子与消息树
            const dbId = (parsed.assistantMsgId as number | undefined);
            const userDbId = (parsed.userMsgId as number | null | undefined);
            const usedModel = (parsed.model as string | null | undefined);
            setMessages((prev) =>
              prev.map((m) => {
                if (dbId && m.id === assistantMsgId) return { ...m, id: `api-${dbId}`, ...(usedModel && { model: usedModel }) };
                if (userDbId && localUserMsgId && m.id === localUserMsgId) return { ...m, id: `api-${userDbId}` };
                return m;
              })
            );
            if (dbId) setActiveLeafId(dbId);
            void queryClient.invalidateQueries({ queryKey: aiConversationKeys.messages(convId) });
          } else if (eventType === 'title') {
            // 服务端 LLM 自动命名完成，同步会话标题
            const title = parsed.title as string | undefined;
            if (title) {
              setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title } : c)));
            }
          } else if (eventType === 'done') {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, status: 'completed' } : m))
            );
            void queryClient.invalidateQueries({ queryKey: aiConversationKeys.lists });
          } else if (eventType === 'error') {
            Toast.error((parsed.message as string | undefined) ?? 'AI 服务出错');
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, status: 'failed' } : m))
            );
          }
        } catch {
          // ignore JSON parse errors
        }
      }
    });
  }, [queryClient, setMessages, setActiveLeafId, setConversations]);

  const handleMessageSend = useCallback(
    async (
      content: { inputContents?: { type: string; text?: string }[]; text?: string },
      opts?: { regenerate?: boolean; parentMsgId?: number | null },
    ) => {
      const regenerate = opts?.regenerate ?? false;
      const text = content.text ?? content.inputContents?.find((c) => c.type === 'text')?.text;
      if (!regenerate && !text?.trim()) return;

      // 若当前没有会话，先自动创建一个（重新生成必然已有会话）
      let convId = activeConvId;
      if (!convId) {
        if (regenerate) return;
        try {
          const newConv = await createConversationMutation.mutateAsync({ body: { title: '新对话' } });
          convId = newConv.id;
          activateNewConversation(newConv);
        } catch {
          Toast.error('创建对话失败');
          return;
        }
      }

      const assistantMsgId = nextMsgId();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        createdAt: Date.now() + 1,
        status: 'in_progress',
      };

      // user 气泡本地 ID：saved 事件到达后映射为数据库 ID（编辑/删除依赖真实 ID）
      const localUserMsgId = regenerate ? null : nextMsgId();
      if (regenerate) {
        // 重新生成：不追加 user 气泡，仅追加新的 assistant 占位（旧回复保留为兄弟分支）
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const userMsg: Message = {
          id: localUserMsgId!,
          role: 'user',
          // 发送即回显图片(本地 data URL);刷新后由 convertApiMessage 换稳定文件 URL
          content: buildUserContent(text!, pendingImages),
          createdAt: Date.now(),
          status: 'completed',
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }
      setGenerating(true);

      const abortController = new AbortController();
      abortRef.current = abortController;
      currentGenIdRef.current = null;

      try {
        const selectedModel = configureValuesRef.current.model as string | undefined ?? '';
        const reasoning = configureValuesRef.current.reasoning as AiReasoningLevel | '' | undefined;
        // `user-${configId}:${model}` / `${configId}:${model}` 复合值（多模型配置，用户配置以 user- 前缀区分来源）
        const [idStr, ...modelParts] = selectedModel.replace(/^user-/, '').split(':');
        const model = modelParts.join(':');
        const body = {
          ...(regenerate ? { regenerate: true } : { message: text }),
          ...(opts?.parentMsgId !== undefined ? { parentMsgId: opts.parentMsgId } : {}),
          ...(!regenerate && pendingImages.length > 0 ? { images: pendingImages } : {}),
          // 会话级推理力度(输入框配置区选择;空 = 跟随智能体/服务商配置)
          ...(reasoning ? { reasoning } : {}),
          configSource: selectedModel.startsWith('user-') ? 'user' : 'system',
          configId: Number.parseInt(idStr, 10) || undefined,
          ...(model ? { model } : {}),
        } satisfies SendAiChatMessageInput;
        const response = await request.fetchRaw(
          urlOf(aiConversationContract.chat, { params: { id: convId } }),
          {
            method: 'POST',
            body: JSON.stringify(body),
            signal: abortController.signal,
            silent: true,
          }
        );

        if (!response) throw new Error('消息发送失败');
        if (!response.ok) {
          // 非流式错误（配额超限 / 校验失败等）：透出服务端 message
          const errBody = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(errBody?.message || `HTTP ${response.status}`);
        }

        // 发送成功后清空待发图片
        if (!regenerate && pendingImages.length > 0) setPendingImages([]);

        await consumeSSEStream(response, { convId, assistantMsgId, localUserMsgId, skipUserEvent: true });
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          Toast.error((err as Error)?.message || '消息发送失败');
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, status: 'failed' } : m))
          );
        }
      } finally {
        setGenerating(false);
        abortRef.current = null;
        setTimeout(() => dialogueRef.current?.scrollToBottom(true), 100);
      }
    },
    [activeConvId, createConversationMutation, pendingImages, consumeSSEStream, activateNewConversation, setMessages, setGenerating, setPendingImages, configureValuesRef, dialogueRef]
  );

  /** 断线续传：进入会话时发现有进行中的生成任务 → 挂载恢复流 */
  const attachToGeneration = useCallback(async (convId: number, genId: string) => {
    if (generating) return;
    currentGenIdRef.current = genId;
    const assistantMsgId = nextMsgId();
    setMessages((prev) => [...prev, {
      id: assistantMsgId,
      role: 'assistant' as const,
      content: '',
      createdAt: Date.now(),
      status: 'in_progress' as const,
    }]);
    setGenerating(true);
    const abortController = new AbortController();
    abortRef.current = abortController;
    try {
      const response = await request.fetchRaw(
        urlOf(aiGenerationContract.stream, { params: { genId }, query: { offset: 0 } }),
        { signal: abortController.signal, silent: true },
      );
      if (!response?.ok) throw new Error('恢复生成流失败');
      Toast.info('检测到进行中的回复，已恢复实时输出');
      await consumeSSEStream(response, { convId, assistantMsgId, localUserMsgId: null, skipUserEvent: false });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        // 恢复失败：移除占位气泡，改为静默刷新消息
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
        void queryClient.invalidateQueries({ queryKey: aiConversationKeys.messages(convId) });
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [generating, consumeSSEStream, queryClient, setMessages, setGenerating]);

  // 会话切换时探测未完成的生成任务（刷新 / 断网恢复场景）
  useEffect(() => {
    if (!activeConvId) return;
    let cancelled = false;
    void getActiveGeneration(activeConvId)
      .then((res) => {
        if (!cancelled && res.genId) void attachToGeneration(activeConvId, res.genId);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在切换会话时探测一次
  }, [activeConvId]);

  const handleStopGenerate = useCallback(() => {
    // 生成与连接解耦：优先通知服务端停止（保存已生成部分），再断开本地流
    const genId = currentGenIdRef.current;
    if (genId) {
      void cancelGeneration(genId).catch(() => {});
    }
    abortRef.current?.abort();
    setGenerating(false);
    setMessages((prev) =>
      prev.map((m) => (m.status === 'in_progress' ? { ...m, status: 'completed' } : m))
    );
    // 服务端保存部分内容后同步一次消息树
    const convId = activeConvId;
    if (convId) {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: aiConversationKeys.messages(convId) });
      }, 1200);
    }
  }, [activeConvId, queryClient, setGenerating, setMessages]);

  /** 重新生成：保留旧回复为兄弟分支，基于同一条 user 消息重答（可用分支切换器来回对比） */
  const handleRegenerate = useCallback(async (msg: Message) => {
    if (generating || !activeConvId) return;
    if (msg.role !== 'assistant') return;

    // 确认这条 assistant 前面有 user 消息，否则无从重新生成
    const curMessages = messages;
    const idx = curMessages.findIndex((m) => m.id === msg.id);
    const prevUserMsg = idx > 0 ? curMessages.slice(0, idx).reverse().find((m) => m.role === 'user') : null;
    if (!prevUserMsg) { Toast.warning('找不到对应的用户消息，无法重新生成'); return; }

    // 仅从展示中移除旧回复（数据保留为兄弟分支），以 regenerate 模式重发
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    void handleMessageSend({ text: '' }, { regenerate: true });
  }, [generating, activeConvId, messages, handleMessageSend, setMessages]);

  /** 编辑并重发：以被编辑消息的父节点为分支点创建新的兄弟分支（旧分支保留，可切换回看） */
  const handleEditAndResend = useCallback(async (msgId: string, newText: string) => {
    if (!newText.trim() || !activeConvId) return;
    const curMessages = messages;
    const idx = curMessages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;

    const dbId = dbIdOf(msgId);
    // 分支点 = 被编辑消息的父节点（null = 根）；未落库的本地消息按普通发送兜底
    let parentMsgId: number | null | undefined;
    if (dbId) {
      const apiMsg = allApiMessages.find((m) => m.id === dbId);
      parentMsgId = apiMsg ? apiMsg.parentId : undefined;
    }
    // 截断 UI 中该消息及其后所有（旧分支数据保留）
    setMessages((prev) => prev.slice(0, idx));
    void handleMessageSend({ text: newText }, parentMsgId !== undefined ? { parentMsgId } : undefined);
  }, [activeConvId, messages, allApiMessages, handleMessageSend, setMessages]);

  const handleEditCancel = useCallback((msgId: string) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, editing: false } : m));
  }, [setMessages]);

  return { handleMessageSend, handleStopGenerate, handleRegenerate, handleEditAndResend, handleEditCancel };
}
