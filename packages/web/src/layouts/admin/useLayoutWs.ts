import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createEntityRelationEventHandler } from '@/lib/entity-relation-cache';
import { Notification } from '@douyinfe/semi-ui';
import type { NavigateFunction } from 'react-router-dom';
import { TOKEN_KEY } from '@zenith/shared/core';
import type { InAppMessage } from '@zenith/shared/messaging';
import type { WsMessage } from '@zenith/shared/platform';
import { subscribeWsStatus, useWebSocket } from '@/hooks/useWebSocket';
import { useOptionalPreferences } from '@/hooks/usePreferences';
import { usernameFromAccessToken, writeAuthInvalidatedReason } from '@/utils/http-client';
import { reloadTrackerConfig } from '@/utils/tracker';
import { playNotificationSound } from '@/utils/notification-sound';
import { showDesktopNotification } from '@/utils/desktop-notification';
import { updateMessageReadIfUnread, markAllMessagesRead, removeMessageById } from './utils';

// ─── WebSocket ──────────────────────────────────────────────────────────────
type AnnouncementWsMessage = Extract<WsMessage, { type: `announcement:${string}` }>;

export function useLayoutWs({
  onLogout,
  clearLockPassword,
  fetchInAppMessages,
  prependInAppMessage,
  refreshInboxLists,
  applyAnnouncementEvent,
  refetchAfterReconnect,
  setInAppMessages,
  setUnreadCount,
  setChatUnreadCount,
  recentInAppMessageRef,
  userTenantId,
  viewingTenantId,
  navigate,
}: {
  onLogout: () => void;
  clearLockPassword: () => void;
  /** 兜底回源：仅用于不带真实 id 的旧载荷 */
  fetchInAppMessages: () => void;
  /** 推送的新消息直接写入铃铛缓存；返回 false 表示重复投递 */
  prependInAppMessage: (message: InAppMessage) => boolean;
  refreshInboxLists: () => void;
  applyAnnouncementEvent: (msg: AnnouncementWsMessage) => void;
  refetchAfterReconnect: () => void;
  setInAppMessages: Dispatch<SetStateAction<InAppMessage[]>>;
  setUnreadCount: Dispatch<SetStateAction<number>>;
  setChatUnreadCount: Dispatch<SetStateAction<number>>;
  recentInAppMessageRef: MutableRefObject<Map<string, number>>;
  userTenantId: number | null | undefined;
  viewingTenantId: number | null;
  navigate: NavigateFunction;
}) {
  const queryClient = useQueryClient();
  const relationEvents = useMemo(() => createEntityRelationEventHandler(queryClient), [queryClient]);
  useEffect(() => () => relationEvents.dispose(), [relationEvents]);
  // 提示音 / 桌面通知偏好：useWebSocket 以 ref 持有 handler，偏好变化只更新闭包，不会重连
  const prefs = useOptionalPreferences();
  const soundEnabled = prefs?.preferences.notificationSound ?? false;
  const soundStyle = prefs?.preferences.notificationSoundStyle;
  const desktopEnabled = prefs?.preferences.desktopNotification ?? false;
  const desktopContent = prefs?.preferences.desktopNotificationContent ?? 'summary';

  // 页签隐藏时站内 Toast 看不到，改弹系统通知；可见时维持站内 Toast
  const notifyArrival = useCallback((title: string, body: string, tag: string, path: string) => {
    if (soundEnabled) playNotificationSound(soundStyle);
    if (desktopEnabled && document.hidden) {
      const shown = showDesktopNotification({ title, body: desktopContent === 'summary' ? body : undefined, tag, onClick: () => navigate(path) });
      if (shown) return;
    }
    Notification.info({ title, content: body, duration: 5, position: 'topRight' });
  }, [soundEnabled, soundStyle, desktopEnabled, desktopContent, navigate]);

  // 断线重连后补拉：期间的推送不会重放；首次连接不算（挂载时的查询刚拉过）
  const hadDisconnectRef = useRef(false);
  useEffect(() => subscribeWsStatus((connected) => {
    if (!connected) {
      hadDisconnectRef.current = true;
      return;
    }
    if (!hadDisconnectRef.current) return;
    hadDisconnectRef.current = false;
    refetchAfterReconnect();
    relationEvents.reconnect();
  }), [refetchAfterReconnect, relationEvents]);

  const handleWsMessage = useCallback((msg: WsMessage) => {
    relationEvents.onMessage(msg);
    if (msg.type === 'in-app-message:new') {
      if (msg.payload.id > 0) {
        // 服务端载荷即真实行：直接写缓存，按 id 去重（多标签页 / 多进程重复投递不重复提示）
        if (!prependInAppMessage(msg.payload)) return;
        refreshInboxLists();
      } else {
        // 旧载荷不带 id：按 标题:时间 去重后回源
        const messageKey = `${msg.payload.title}:${msg.payload.createdAt}`;
        const now = Date.now();
        for (const [key, timestamp] of recentInAppMessageRef.current) {
          if (now - timestamp > 60_000) recentInAppMessageRef.current.delete(key);
        }
        if (recentInAppMessageRef.current.has(messageKey)) return;
        recentInAppMessageRef.current.set(messageKey, now);
        fetchInAppMessages();
      }

      notifyArrival('新站内信', msg.payload.title, 'in-app-message', '/inbox');
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
      // 壳层缓存直接写入（不回源）；收件箱 / 管理页仍靠事件按需重拉自己的列表
      applyAnnouncementEvent(msg);
      globalThis.dispatchEvent(new CustomEvent('announcement:refresh', { detail: msg }));
      if (msg.type === 'announcement:new') {
        notifyArrival('新公告', msg.payload.title, 'announcement', '/announcements');
      }
    } else if (msg.type === 'chat:message') {
      // 只在当前不在 /chat 页面时增加未读
      if (!globalThis.location.pathname.startsWith('/chat')) {
        setChatUnreadCount((v) => v + 1);
      }
    } else if (msg.type === 'deploy:run-updated' || msg.type === 'deploy:log') {
      globalThis.dispatchEvent(new CustomEvent(msg.type, { detail: msg.payload }));
    } else if (msg.type === 'session:force-logout') {
      const kicked = msg.payload.code === 'concurrent-login';
      Notification.warning({
        title: kicked ? '已在其他设备登录' : '强制下线',
        content: msg.payload.reason,
        duration: kicked ? 10 : 0,
        position: 'topRight',
      });
      // 落到登录页后仍能看到原因（常驻横幅 + 预填账号）：与 401 路径写同一份标记
      writeAuthInvalidatedReason({
        message: msg.payload.reason,
        reason: msg.payload.code ?? 'force-logout',
        username: usernameFromAccessToken(localStorage.getItem(TOKEN_KEY)),
      });
      // Auto-logout after a brief delay so the user can see the notification
      setTimeout(() => { clearLockPassword(); onLogout(); }, 2000);
    } else if (msg.type === 'analytics:config-updated') {
      // 仅当前租户（或当前平台视角）重拉，避免其它租户保存设置引发全平台无效请求。
      const effectiveTenantId = viewingTenantId !== null ? viewingTenantId : userTenantId;
      if (msg.payload.tenantId === effectiveTenantId) reloadTrackerConfig();
    }
  }, [onLogout, fetchInAppMessages, prependInAppMessage, refreshInboxLists, applyAnnouncementEvent, clearLockPassword, userTenantId, viewingTenantId, setInAppMessages, setUnreadCount, setChatUnreadCount, recentInAppMessageRef, notifyArrival, relationEvents]);

  const { disconnect: disconnectWs } = useWebSocket(handleWsMessage);

  return { disconnectWs };
}
