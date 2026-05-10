import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FloatButton, Spin } from '@douyinfe/semi-ui';
import { MessageCircle, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ChatConversation, WsMessage } from '@zenith/shared';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { request } from '@/utils/request';
import './QuickChatButton.css';

const QuickChatPanel = lazy(() => import('@/pages/chat/ChatPage'));

export default function QuickChatButton({ onHide }: Readonly<{ onHide?: () => void }>) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const openRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const floatBtnRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      openRef.current = !prev;
      if (!prev) setEverOpened(true);
      return !prev;
    });
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    const res = await request.get<ChatConversation[]>('/api/chat/conversations', { silent: true });
    if (res.code === 0 && res.data) {
      setUnreadCount(res.data.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0));
    }
  }, []);

  useEffect(() => {
    void fetchUnreadCount();
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || floatBtnRef.current?.contains(target)) return;
      openRef.current = false;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (location.pathname.startsWith('/chat')) {
      openRef.current = false;
      setOpen(false);
    }
  }, [location.pathname]);

  const handleWsMessage = useCallback((wsMsg: WsMessage) => {
    if (location.pathname.startsWith('/chat')) return;

    if (wsMsg.type === 'chat:message') {
      if (openRef.current || wsMsg.payload.senderId === currentUserId) return;
      setUnreadCount((count) => count + 1);
      return;
    }

    if (wsMsg.type === 'chat:read' && wsMsg.payload.userId === currentUserId) {
      void fetchUnreadCount();
    }
  }, [currentUserId, fetchUnreadCount, location.pathname]);

  useWebSocket(handleWsMessage);

  const handleOpenFullPage = useCallback(() => {
    setOpen(false);
    navigate('/chat');
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
            onHide?.();
          }}
        >
          <X size={12} />
        </button>
      </div>

      {everOpened && (
        <div
          ref={panelRef}
          className={open ? 'qc-panel' : 'qc-panel qc-panel--hidden'}
        >
          <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div>}>
            <QuickChatPanel
              variant="quick"
              onClose={() => { openRef.current = false; setOpen(false); }}
              onOpenFullPage={handleOpenFullPage}
              onUnreadChange={setUnreadCount}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
