import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FloatButton, Spin } from '@douyinfe/semi-ui';
import { MessageCircle, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ChatConversation, WsMessage } from '@zenith/shared';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket, useWsConnected } from '@/hooks/useWebSocket';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import './QuickChatButton.css';

const QuickChatPanel = lazy(() => import('@/pages/chat/ChatPage'));

export default function QuickChatButton({ onHide }: Readonly<{ onHide?: () => void }>) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const openRef = useRef(false);
  const lastActiveConvIdRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const floatBtnRef = useRef<HTMLDivElement>(null);
  const wsHasConnectedRef = useRef(false);
  const wsDisconnectedSinceReadyRef = useRef(false);
  const { data: unreadConversations, refetch: refetchUnreadCount } = useQuery({
    queryKey: ['chat', 'quick-unread-conversations'],
    queryFn: () => request.get<ChatConversation[]>('/api/chat/conversations', { silent: true }).then(unwrap),
    enabled: !location.pathname.startsWith('/chat'),
  });

  const closePanel = useCallback(() => {
    openRef.current = false;
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 160);
  }, []);

  const handleToggle = useCallback(() => {
    if (openRef.current) {
      closePanel();
      return;
    }
    openRef.current = true;
    setEverOpened(true);
    setUnreadCount(0);  // 乐观清空未读数
    setOpen(true);
  }, [closePanel]);

  useEffect(() => {
    if (unreadConversations) {
      setUnreadCount(unreadConversations.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0));
    }
  }, [unreadConversations]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, closePanel]);

  useEffect(() => {
    if (location.pathname.startsWith('/chat')) {
      openRef.current = false;
      setOpen(false);
      setClosing(false);
    } else if (open && lastActiveConvIdRef.current) {
      // 用户通过菜单导航到 /chat，不在此分支处理（已在下方 useEffect 处理）
    }
  }, [location.pathname, open]);

  // 通过菜单导航到 /chat 时，自动附带当前活跃会话
  useEffect(() => {
    if (!location.pathname.startsWith('/chat')) return;
    if (!lastActiveConvIdRef.current) return;
    if (location.search.includes('conv=')) return; // 已有 conv 参数（由 handleOpenFullPage 传入）
    navigate(`/chat?conv=${lastActiveConvIdRef.current}`, { replace: true });
    lastActiveConvIdRef.current = null;
  }, [location.pathname, location.search, navigate]);

  const handleWsMessage = useCallback((wsMsg: WsMessage) => {
    if (location.pathname.startsWith('/chat')) return;

    if (wsMsg.type === 'chat:message') {
      if (openRef.current || wsMsg.payload.senderId === currentUserId) return;
      setUnreadCount((count) => count + 1);
      return;
    }

    if (wsMsg.type === 'chat:read' && wsMsg.payload.userId === currentUserId) {
      void refetchUnreadCount();
    }
  }, [currentUserId, location.pathname, refetchUnreadCount]);

  useWebSocket(handleWsMessage);
  const wsConnected = useWsConnected();

  // WebSocket 重连成功后刷新未读数，修正断线期间漏掉的推送。
  useEffect(() => {
    if (!wsConnected) {
      if (wsHasConnectedRef.current) wsDisconnectedSinceReadyRef.current = true;
      return;
    }

    if (!wsHasConnectedRef.current) {
      wsHasConnectedRef.current = true;
      return;
    }

    if (!wsDisconnectedSinceReadyRef.current) return;
    wsDisconnectedSinceReadyRef.current = false;
    void refetchUnreadCount();
  }, [refetchUnreadCount, wsConnected]);

  const handleOpenFullPage = useCallback((convId?: number | null) => {
    openRef.current = false;
    lastActiveConvIdRef.current = null; // handleOpenFullPage 自带 convId，无需再读 ref
    setOpen(false);
    setClosing(false);
    navigate(convId ? `/chat?conv=${convId}` : '/chat');
  }, [navigate]);

  if (location.pathname.startsWith('/chat')) return null;

  return (
    <>
      <div
        ref={floatBtnRef}
        className="qc-float-wrapper"
        style={{ position: 'fixed', insetInlineEnd: 24, bottom: 24, zIndex: 999 }}
      >
        <FloatButton
          style={{ position: 'relative', bottom: 'unset', right: 'unset', insetInlineEnd: 'unset' }}
          icon={<MessageCircle size={20} />}
          badge={unreadCount > 0 ? { count: unreadCount, overflowCount: 99 } : undefined}
          onClick={handleToggle}
          shape="round"
        />
        <button
          title="隐藏快捷聊天"
          className="qc-hide-btn"
          onClick={(e) => {
            e.stopPropagation();
            openRef.current = false;
            setOpen(false);
            setClosing(false);
            onHide?.();
          }}
        >
          <X size={12} />
        </button>
      </div>

      {everOpened && (
        <div
          ref={panelRef}
          className={`qc-panel${!open && !closing ? ' qc-panel--hidden' : ''}${closing ? ' qc-panel--closing' : ''}`}
        >
          <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div>}>
            <QuickChatPanel
              variant="quick"
              onClose={closePanel}
              onOpenFullPage={handleOpenFullPage}
              onUnreadChange={setUnreadCount}
              onConvChange={(id) => { lastActiveConvIdRef.current = id; }}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
