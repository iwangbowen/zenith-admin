import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { WsMessage } from '@zenith/shared/platform';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useOptionalPreferences } from '@/hooks/usePreferences';
import { useConversations } from '@/hooks/queries/chat';
import { playNotificationSound } from '@/utils/notification-sound';
import { getChatNotifyPrefs } from '@/pages/chat/notifyPrefs';
import { getMessageSummary } from '@/pages/chat/utils';

function isAbsoluteUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * 全局聊天通知器：标签页失焦时收到新消息，弹出桌面通知 + 提示音。
 * 尊重会话免打扰与用户偏好（localStorage）；提示音音色跟随「通知设置」里的偏好。挂载于 AdminLayout 一次即可。
 *
 * 免打扰集合来自壳层共享的会话列表缓存（与未读徽标、快捷聊天入口合并为一次请求），
 * 免打扰切换由聊天页写回同一缓存，因此这里不需要任何定时或 focus 触发的重拉。
 */
export function useChatNotifier(currentUserId: number | null) {
  const navigate = useNavigate();
  const location = useLocation();
  const soundStyle = useOptionalPreferences()?.preferences.notificationSoundStyle;
  const mutedRef = useRef<Set<number>>(new Set());
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  const { data: conversations } = useConversations(currentUserId != null);
  useEffect(() => {
    if (conversations) mutedRef.current = new Set(conversations.filter((c) => c.isMuted).map((c) => c.id));
  }, [conversations]);

  const handler = useCallback((wsMsg: WsMessage) => {
    if (wsMsg.type !== 'chat:message') return;
    const msg = wsMsg.payload;
    if (!msg.senderId || msg.senderId === currentUserId) return;
    // 仅在标签页失焦时提醒，避免打扰正在使用的用户
    if (!document.hidden) return;
    if (mutedRef.current.has(msg.conversationId)) return;

    const prefs = getChatNotifyPrefs();
    if (prefs.sound) playNotificationSound(soundStyle);

    if (prefs.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const notification = new Notification(msg.senderName ?? '新消息', {
          body: getMessageSummary(msg),
          tag: `chat-${msg.conversationId}`,
          icon: isAbsoluteUrl(msg.senderAvatar) ? msg.senderAvatar : undefined,
        });
        notification.onclick = () => {
          globalThis.focus();
          navigate(`/chat?conv=${msg.conversationId}`);
          notification.close();
        };
      } catch { /* ignore */ }
    }
  }, [currentUserId, navigate, soundStyle]);

  useWebSocket(handler);
}
