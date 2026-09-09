import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Notification } from '@douyinfe/semi-ui';
import type { InAppMessage } from '@zenith/shared/messaging';
import type { WsMessage } from '@zenith/shared/platform';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useOptionalPreferences } from '@/hooks/usePreferences';
import { reloadTrackerConfig } from '@/utils/tracker';
import { playNotificationSound } from '@/utils/notification-sound';
import { updateMessageReadIfUnread, markAllMessagesRead, removeMessageById } from './utils';

// ─── WebSocket ──────────────────────────────────────────────────────────────
export function useLayoutWs({
  onLogout,
  clearLockPassword,
  fetchInAppMessages,
  setInAppMessages,
  setUnreadCount,
  setChatUnreadCount,
  recentInAppMessageRef,
  userTenantId,
  viewingTenantId,
}: {
  onLogout: () => void;
  clearLockPassword: () => void;
  fetchInAppMessages: () => void;
  setInAppMessages: Dispatch<SetStateAction<InAppMessage[]>>;
  setUnreadCount: Dispatch<SetStateAction<number>>;
  setChatUnreadCount: Dispatch<SetStateAction<number>>;
  recentInAppMessageRef: MutableRefObject<Map<string, number>>;
  userTenantId: number | null | undefined;
  viewingTenantId: number | null;
}) {
  // 提示音偏好：useWebSocket 以 ref 持有 handler，偏好变化只更新闭包，不会重连
  const prefs = useOptionalPreferences();
  const soundEnabled = prefs?.preferences.notificationSound ?? false;
  const soundStyle = prefs?.preferences.notificationSoundStyle;

  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'in-app-message:new') {
      const messageKey = `${msg.payload.title}:${msg.payload.createdAt}`;
      const now = Date.now();

      for (const [key, timestamp] of recentInAppMessageRef.current) {
        if (now - timestamp > 60_000) {
          recentInAppMessageRef.current.delete(key);
        }
      }

      if (recentInAppMessageRef.current.has(messageKey)) {
        return;
      }

      recentInAppMessageRef.current.set(messageKey, now);

      // 重新拉一次以获取带有实际 id 的记录
      fetchInAppMessages();

      if (soundEnabled) playNotificationSound(soundStyle);
      Notification.info({
        title: '新消息',
        content: msg.payload.title,
        duration: 5,
        position: 'topRight',
      });
    } else if (msg.type === 'in-app-message:read') {
      setInAppMessages(updateMessageReadIfUnread(msg.payload.id));
      setUnreadCount((c) => Math.max(0, c - 1));
    } else if (msg.type === 'in-app-message:read-all') {
      setInAppMessages(markAllMessagesRead);
      setUnreadCount(0);
    } else if (msg.type === 'in-app-message:deleted') {
      setInAppMessages((prev) => {
        const target = prev.find((m) => m.id === msg.payload.id);
        if (target && !target.isRead) setUnreadCount((c) => Math.max(0, c - 1));
        return removeMessageById(msg.payload.id)(prev);
      });
    } else if (
      msg.type === 'announcement:new' ||
      msg.type === 'announcement:updated' ||
      msg.type === 'announcement:deleted' ||
      msg.type === 'announcement:read' ||
      msg.type === 'announcement:read-all'
    ) {
      globalThis.dispatchEvent(new CustomEvent('announcement:refresh', { detail: msg }));
      if (msg.type === 'announcement:new') {
        if (soundEnabled) playNotificationSound(soundStyle);
        Notification.info({
          title: '新公告',
          content: msg.payload.title,
          duration: 5,
          position: 'topRight',
        });
      }
    } else if (msg.type === 'chat:message') {
      // 只在当前不在 /chat 页面时增加未读
      if (!globalThis.location.pathname.startsWith('/chat')) {
        setChatUnreadCount((v) => v + 1);
      }
    } else if (msg.type === 'session:force-logout') {
      Notification.warning({
        title: '强制下线',
        content: msg.payload.reason,
        duration: 0,
        position: 'topRight',
      });
      // Auto-logout after a brief delay so the user can see the notification
      setTimeout(() => { clearLockPassword(); onLogout(); }, 2000);
    } else if (msg.type === 'analytics:config-updated') {
      // 仅当前租户（或当前平台视角）重拉，避免其它租户保存设置引发全平台无效请求。
      const effectiveTenantId = viewingTenantId !== null ? viewingTenantId : userTenantId;
      if (msg.payload.tenantId === effectiveTenantId) reloadTrackerConfig();
    }
  }, [onLogout, fetchInAppMessages, clearLockPassword, userTenantId, viewingTenantId, setInAppMessages, setUnreadCount, setChatUnreadCount, recentInAppMessageRef, soundEnabled, soundStyle]);

  const { disconnect: disconnectWs } = useWebSocket(handleWsMessage);

  return { disconnectWs };
}
