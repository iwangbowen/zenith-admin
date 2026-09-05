import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import type { ChatConversation } from '@zenith/shared/chat';

/** 禁言状态：个人禁言优先；全员禁言豁免群主/管理员；限时禁言到期后自动恢复输入框（自 ChatPage 原样搬移） */
export function useMuteState(activeConv: ChatConversation | null) {
  const [muteTick, setMuteTick] = useState(0);
  const muteState = useMemo(() => {
    void muteTick; // 禁言到期时触发重算
    if (!activeConv || activeConv.type !== 'group') return null;
    const until = activeConv.myMutedUntil ? dayjs(activeConv.myMutedUntil) : null;
    if (until?.isAfter(dayjs())) {
      return {
        placeholder: until.year() >= 9000 ? '你已被禁言' : `你已被禁言，${until.format('MM-DD HH:mm')} 解除`,
        until,
      };
    }
    if (activeConv.muteAll && (activeConv.myRole ?? 'member') === 'member') {
      return { placeholder: '全员禁言中，仅群主和管理员可发言', until: null };
    }
    return null;
  }, [activeConv, muteTick]);

  // 限时禁言到期后自动恢复输入框
  useEffect(() => {
    if (!muteState?.until || muteState.until.year() >= 9000) return;
    const ms = muteState.until.diff(dayjs()) + 1000;
    if (ms <= 0 || ms > 24 * 3600 * 1000) return;
    const timer = setTimeout(() => setMuteTick((v) => v + 1), ms);
    return () => clearTimeout(timer);
  }, [muteState]);

  return muteState;
}

export type MuteState = ReturnType<typeof useMuteState>;
