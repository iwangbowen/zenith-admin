import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ChatConversation, ChatGroupMember } from '@zenith/shared/chat';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { textMatches } from '@/utils/pinyin';

/** 群聊 @全体成员 的虚拟成员项 */
const ALL_MEMBERS_VIRTUAL: ChatGroupMember = { id: -1, nickname: '全体成员', username: 'all', role: 'member' };

/**
 * 输入框 @提及：光标前的 `@query` 解析、候选成员过滤（含 @全体成员）、键盘高亮索引与手动关闭态
 * （自 ChatPage 原样搬移）
 */
export function useMentionInput({
  activeConv, input, inputRef, activeGroupMembers, currentUserId,
}: {
  activeConv: ChatConversation | null;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  activeGroupMembers: ChatGroupMember[];
  currentUserId: number | null;
}) {
  const [mentionClosed, setMentionClosed] = useState(false);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const mentionListRef = useRef<HTMLDivElement>(null);
  // 拼音词典就绪后重算候选，已输入的 @query 自动补上拼音命中
  const pinyinReady = usePinyinReady();

  const mentionState = useMemo(() => {
    if (activeConv?.type !== 'group') return null;
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const prefix = input.slice(0, cursor);
    const atIndex = prefix.lastIndexOf('@');
    if (atIndex < 0) return null;
    if (atIndex > 0 && !/\s/.test(prefix[atIndex - 1] ?? '')) return null;
    const query = prefix.slice(atIndex + 1);
    if (query.includes(' ') || query.includes('\n')) return null;
    return { start: atIndex, end: cursor, query };
  }, [activeConv, input, inputRef]);

  const mentionCandidates = useMemo(() => {
    if (!mentionState) return [];
    const query = mentionState.query;
    const kw = query.trim();
    const members = activeGroupMembers.filter((member) => {
      if (member.id === currentUserId) return false;
      if (!kw) return true;
      return textMatches(member.nickname, kw) || textMatches(member.username, kw);
    }).slice(0, 7);
    // 在群聊中支持 @全体成员
    if (activeConv?.type === 'group') {
      const allMatches = !kw || textMatches('全体成员', kw) || textMatches('all', kw);
      if (allMatches) return [ALL_MEMBERS_VIRTUAL, ...members];
    }
    return members;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.type, activeGroupMembers, currentUserId, mentionState, pinyinReady]);

  // mentionCandidates 变化时重置高亮到第一项
  useEffect(() => {
    setMentionActiveIndex(0);
  }, [mentionCandidates]);

  return { mentionState, mentionCandidates, mentionActiveIndex, setMentionActiveIndex, mentionClosed, setMentionClosed, mentionListRef };
}

export type MentionInput = ReturnType<typeof useMentionInput>;
