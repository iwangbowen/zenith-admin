import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InAppMessage, Announcement } from '@zenith/shared/messaging';
import {
  announcementKeys,
  useMarkMyAnnouncementRead,
  useMyAnnouncementUnreadCount,
  usePublishedAnnouncements,
} from '@/hooks/queries/announcements';
import {
  inAppMessageKeys,
  useMyInAppMessageUnreadCount,
  useMyInAppMessages,
} from '@/hooks/queries/in-app-messages';
import { chatKeys, useChatUnreadCount } from '@/hooks/queries/chat';

/**
 * 顶栏公告 / 站内信。
 *
 * 数据全部由 TanStack Query 持有；对外仍暴露 setInAppMessages / setUnreadCount
 * 这类 setter 形状，但底层改写为 setQueryData——WebSocket 推送（useLayoutWs）
 * 因此无需改动，同时消息列表与未读数不再出现「本地 state 与缓存各存一份」。
 */
export function useInAppNotifications() {
  const queryClient = useQueryClient();
  const [announcementPopVisible, setAnnouncementPopVisible] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [messagePopVisible, setMessagePopVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<InAppMessage | null>(null);
  const recentInAppMessageRef = useRef(new Map<string, number>());

  const { data: inAppMessages = [] } = useMyInAppMessages();
  const { data: unreadCount = 0 } = useMyInAppMessageUnreadCount();
  const { data: announcementUnreadCount = 0 } = useMyAnnouncementUnreadCount();
  const { data: recentAnnouncements = [] } = usePublishedAnnouncements();
  const markAnnouncementReadMutation = useMarkMyAnnouncementRead();

  // WebSocket 推送直接写缓存，保持与既有 setState 调用形状一致
  const setInAppMessages: Dispatch<SetStateAction<InAppMessage[]>> = useCallback((update) => {
    queryClient.setQueryData<{ list: InAppMessage[]; total: number }>(inAppMessageKeys.mine, (prev) => {
      const list = prev?.list ?? [];
      const next = typeof update === 'function' ? (update as (p: InAppMessage[]) => InAppMessage[])(list) : update;
      return { list: next, total: prev?.total ?? next.length };
    });
  }, [queryClient]);

  const setUnreadCount: Dispatch<SetStateAction<number>> = useCallback((update) => {
    queryClient.setQueryData<{ count: number }>(inAppMessageKeys.myUnreadCount, (prev) => {
      const count = prev?.count ?? 0;
      return { count: typeof update === 'function' ? (update as (p: number) => number)(count) : update };
    });
  }, [queryClient]);

  const fetchInAppMessages = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: inAppMessageKeys.mine });
    void queryClient.invalidateQueries({ queryKey: inAppMessageKeys.myUnreadCount });
  }, [queryClient]);

  const fetchRecentAnnouncements = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: announcementKeys.published });
    void queryClient.invalidateQueries({ queryKey: announcementKeys.myUnreadCount });
  }, [queryClient]);

  const markAnnouncementAsRead = useCallback((id: number) => {
    markAnnouncementReadMutation.mutate({ params: { id } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: announcementKeys.published });
        void queryClient.invalidateQueries({ queryKey: announcementKeys.myUnreadCount });
      },
    });
  }, [markAnnouncementReadMutation, queryClient]);

  return {
    inAppMessages, setInAppMessages,
    unreadCount, setUnreadCount,
    announcementUnreadCount,
    announcementPopVisible, setAnnouncementPopVisible,
    recentAnnouncements,
    selectedAnnouncement, setSelectedAnnouncement,
    messagePopVisible, setMessagePopVisible,
    selectedMessage, setSelectedMessage,
    recentInAppMessageRef,
    fetchRecentAnnouncements, markAnnouncementAsRead, fetchInAppMessages,
  };
}

// ─── 聊天未读数 ────────────────────────────────────────────────────────────
export function useChatUnread() {
  const queryClient = useQueryClient();
  const { data: chatUnreadCount = 0 } = useChatUnreadCount();

  const setChatUnreadCount: Dispatch<SetStateAction<number>> = useCallback((update) => {
    queryClient.setQueryData<number>(chatKeys.unreadCount, (prev) => {
      const count = prev ?? 0;
      return typeof update === 'function' ? (update as (p: number) => number)(count) : update;
    });
  }, [queryClient]);

  return { chatUnreadCount, setChatUnreadCount };
}
