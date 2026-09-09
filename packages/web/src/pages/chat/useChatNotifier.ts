import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { chatContract } from '@zenith/shared/chat';
import type { WsMessage } from '@zenith/shared/platform';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useOptionalPreferences } from '@/hooks/usePreferences';
import { api } from '@/lib/contract-query';
import { playNotificationSound } from '@/utils/notification-sound';
import { getChatNotifyPrefs } from '@/pages/chat/notifyPrefs';
import { getMessageSummary } from '@/pages/chat/utils';

function isAbsoluteUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * 全局聊天通知器：标签页失焦时收到新消息，弹出桌面通知 + 提示音。
 * 尊重会话免打扰与用户偏好（localStorage）；提示音音色跟随「通知设置」里的偏好。挂载于 AdminLayout 一次即可。
 */
export function useChatNotifier(currentUserId: number | null) {
  const navigate = useNavigate();
  const location = useLocation();
  const soundStyle = useOptionalPreferences()?.preferences.notificationSoundStyle;
  const mutedRef = useRef<Set<number>>(new Set());
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  const refreshMuted = useCallback(async () => {
    const list = await api(chatContract.conversations, { silent: true }).catch(() => null);
    if (list) {
      mutedRef.current = new Set(list.filter((c) => c.isMuted).map((c) => c.id));
    }
  }, []);

  useEffect(() => {
    if (currentUserId == null) return;
    void refreshMuted();
    const onFocus = () => { void refreshMuted(); };
    globalThis.addEventListener('focus', onFocus);
    const timer = globalThis.setInterval(() => { void refreshMuted(); }, 60_000);
    return () => {
      globalThis.removeEventListener('focus', onFocus);
      globalThis.clearInterval(timer);
    };
  }, [currentUserId, refreshMuted]);

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
