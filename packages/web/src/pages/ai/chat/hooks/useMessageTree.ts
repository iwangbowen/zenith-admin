import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { AiConversation, AiMessage } from '@zenith/shared/ai';
import { switchConversationBranch } from '@/hooks/queries/ai-extras';
import { convertApiMessage, type ChatMessage as Message } from '../message-adapters';
import { computeBranchInfo, resolveActivePath } from '../branch-tree';
import type { AIChatDialogueInstance } from '../chat-utils';

interface UseMessageTreeOptions {
  activeConvId: number | null;
  /** 会话消息查询结果（全量消息树） */
  apiMessages: AiMessage[] | undefined;
  generating: boolean;
  conversations: AiConversation[];
  dialogueRef: RefObject<AIChatDialogueInstance | null>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setConversations: Dispatch<SetStateAction<AiConversation[]>>;
}

/**
 * 消息分支树的本地镜像：全量 API 消息 + 激活叶子 → 展示路径；
 * 切入会话时初始化叶子与滚底，生成中冻结同步以免打断流式气泡；分支切换即时生效。
 */
export function useMessageTree({ activeConvId, apiMessages, generating, conversations, dialogueRef, setMessages, setConversations }: UseMessageTreeOptions) {
  /** 已完成叶子/滚动初始化的会话(同一会话的后续数据刷新不再重置) */
  const syncedConvRef = useRef<number | null>(null);
  /** 分支树：全量 API 消息与激活叶子（本地镜像，切换分支即时生效） */
  const [allApiMessages, setAllApiMessages] = useState<AiMessage[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<number | null>(null);

  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      setAllApiMessages([]);
      setActiveLeafId(null);
      syncedConvRef.current = null;
      return;
    }
    if (!apiMessages) return;
    // 生成中跳过同步:流式气泡即时态为准,saved 事件触发的 refetch 会在
    // generating 归位后经本效应重放——否则中途重置叶子/滚动会造成聊天区闪动
    if (generating) return;
    setAllApiMessages(apiMessages);
    // 激活叶子与滚底仅在切入该会话首次加载时初始化(以会话记录为准);
    // 同一会话的后续数据刷新不得重置叶子(列表可能滞后)或跳动滚动条
    if (syncedConvRef.current !== activeConvId) {
      syncedConvRef.current = activeConvId;
      const conv = conversations.find((c) => c.id === activeConvId);
      setActiveLeafId(conv?.activeLeafMsgId ?? null);
      const scrollTimer = setTimeout(() => dialogueRef.current?.scrollToBottom(false), 120);
      return () => clearTimeout(scrollTimer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- conversations 仅作初始叶子来源，避免列表刷新反复重置
  }, [activeConvId, apiMessages, generating]);

  /** 分支信息（同父同角色兄弟 > 1 时展示切换器） */
  const branchInfo = useMemo(() => computeBranchInfo(allApiMessages), [allApiMessages]);

  // 激活路径变化 → 重算展示消息（生成中不重置，避免打断流式气泡）
  useEffect(() => {
    if (generating) return;
    const path = resolveActivePath(allApiMessages, activeLeafId);
    setMessages(path.map(convertApiMessage));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generating 变为 false 时由 done 流程主动 invalidate
  }, [allApiMessages, activeLeafId]);

  /** 分支切换：以目标兄弟消息为起点下探最新叶子并激活 */
  const handleSwitchBranch = useCallback(async (siblingDbId: number) => {
    if (!activeConvId || generating) return;
    try {
      const res = await switchConversationBranch(activeConvId, siblingDbId);
      setActiveLeafId(res.activeLeafMsgId);
      setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, activeLeafMsgId: res.activeLeafMsgId } : c)));
    } catch { /* 请求层已提示 */ }
  }, [activeConvId, generating, setConversations]);

  return { allApiMessages, setAllApiMessages, activeLeafId, setActiveLeafId, branchInfo, handleSwitchBranch };
}
