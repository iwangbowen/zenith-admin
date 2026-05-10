import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FloatButton, Spin } from '@douyinfe/semi-ui';
import { MessageCircle, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ChatConversation, WsMessage } from '@zenith/shared';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { request } from '@/utils/request';

const QuickChatPanel = lazy(() => import('@/pages/chat/ChatPage'));

export default function QuickChatButton({ onHide }: Readonly<{ onHide?: () => void }>) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const floatBtnRef = useRef<HTMLDivElement>(null);

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
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (location.pathname.startsWith('/chat')) setOpen(false);
  }, [location.pathname]);

  const handleWsMessage = useCallback((wsMsg: WsMessage) => {
    if (location.pathname.startsWith('/chat')) return;

    if (wsMsg.type === 'chat:message') {
      if (open || wsMsg.payload.senderId === currentUserId) return;
      setUnreadCount((count) => count + 1);
      return;
    }

    if (wsMsg.type === 'chat:read' && wsMsg.payload.userId === currentUserId) {
      void fetchUnreadCount();
    }
  }, [currentUserId, fetchUnreadCount, location.pathname, open]);

  useWebSocket(handleWsMessage);

  const handleOpenFullPage = useCallback(() => {
    setOpen(false);
    navigate('/chat');
  }, [navigate]);

  if (location.pathname.startsWith('/chat')) return null;

  return (
    <>
      <style>{`
        @keyframes qc-slide-in {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes qc-hide-btn-pop {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: scale(1); }
        }
        .qc-float-wrapper { position: relative; }
        .qc-float-wrapper:hover .qc-hide-btn {
          opacity: 1;
          pointer-events: auto;
          animation: qc-hide-btn-pop 0.15s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .qc-hide-btn {
          opacity: 0;
          pointer-events: none;
          position: absolute;
          top: -7px;
          right: -7px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--semi-color-text-1);
          border: 2px solid var(--semi-color-bg-0);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          color: #fff;
          z-index: 1000;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
          transition: background 0.15s ease;
        }
        .qc-hide-btn:hover { background: var(--semi-color-danger); }
      `}</style>
      <div
        ref={floatBtnRef}
        className="qc-float-wrapper"
        style={{ position: 'fixed', insetInlineEnd: 24, bottom: 24, zIndex: 999 }}
      >
        <FloatButton
          style={{ position: 'relative', bottom: 'unset', right: 'unset', insetInlineEnd: 'unset' }}
          icon={<MessageCircle size={20} />}
          badge={unreadCount > 0 ? { count: unreadCount, overflowCount: 99 } : undefined}
          onClick={() => setOpen((prev) => !prev)}
          shape="round"
        />
        <button
          title="隐藏快捷聊天"
          className="qc-hide-btn"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            onHide?.();
          }}
        >
          <X size={12} />
        </button>
      </div>

      {open && (
        <div
          ref={panelRef}
          style={{
            animation: 'qc-slide-in 0.18s ease-out',
            position: 'fixed',
            bottom: 88,
            right: 24,
            width: 'min(420px, calc(100vw - 32px))',
            height: 'min(640px, calc(100vh - 120px))',
            background: 'var(--semi-color-bg-0)',
            border: '1px solid var(--semi-color-border)',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 1001,
            overflow: 'hidden',
          }}
        >
          <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div>}>
            <QuickChatPanel
              variant="quick"
              onClose={() => setOpen(false)}
              onOpenFullPage={handleOpenFullPage}
              onUnreadChange={setUnreadCount}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
