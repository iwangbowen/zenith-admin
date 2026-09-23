import { useCallback, useContext, useEffect, useRef, useState, type RefObject } from 'react';
import { UNSAFE_NavigationContext, useLocation, type To } from 'react-router-dom';
import { Modal } from '@douyinfe/semi-ui';
import { useDebouncer } from '@tanstack/react-pacer';
import { useAuth } from '@/hooks/useAuth';
import type { CmsAlbumImage, CmsContentAttachment } from '@zenith/shared/cms';

export interface CmsEditorDraft {
  values: Record<string, unknown>;
  body: string;
  albumImages: CmsAlbumImage[];
  attachments: CmsContentAttachment[];
  version?: number;
  savedAt: number;
}

/** BrowserRouter 无 data-router blocker；仅在编辑页生命期代理导航并在离开前保存恢复副本。 */
export function useCmsEditorRecovery({ key, dirty, getDraft }: Readonly<{
  key: string;
  dirty: RefObject<boolean>;
  getDraft: () => Omit<CmsEditorDraft, 'savedAt'>;
}>) {
  const { user } = useAuth();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const storageKey = `cms-editor-recovery:${user?.id ?? 0}:${key}`;
  const getter = useRef(getDraft);
  getter.current = getDraft;
  const allowed = useRef(false);
  const [pending, setPending] = useState<CmsEditorDraft | null>(null);
  const [storageError, setStorageError] = useState(false);
  const persist = useCallback(() => {
    if (!dirty.current) return true;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...getter.current(), savedAt: Date.now() }));
      setStorageError(false);
      return true;
    } catch { setStorageError(true); return false; }
  }, [dirty, storageKey]);
  const persistDebouncer = useDebouncer(persist, { wait: 300 });
  const checkpoint = useCallback(() => persistDebouncer.maybeExecute(), [persistDebouncer]);
  const clear = useCallback(() => {
    persistDebouncer.cancel();
    try { localStorage.removeItem(storageKey); } catch { /* 无存储环境仍有离开提醒 */ }
    setPending(null);
  }, [persistDebouncer, storageKey]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) as CmsEditorDraft : null;
      if (parsed && typeof parsed.savedAt === 'number' && parsed.values && typeof parsed.body === 'string' && Date.now() - parsed.savedAt < 7 * 86400_000) setPending(parsed);
      else { localStorage.removeItem(storageKey); setPending(null); }
    } catch { setPending(null); }
  }, [storageKey]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      persist();
      event.preventDefault();
    };
    const pageHide = () => persist();
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    const originalPush = navigator.push;
    const originalReplace = navigator.replace;
    const originalGo = navigator.go;
    const staysInDraft = (to: To) => {
      const current = locationRef.current;
      const base = new URL(`${current.pathname}${current.search}`, window.location.href);
      const target = typeof to === 'string'
        ? new URL(to, base)
        : new URL(`${to.pathname ?? current.pathname}${to.search ?? ''}`, base);
      if (target.origin !== base.origin || target.pathname !== current.pathname) return false;
      const before = new URLSearchParams(current.search);
      if (before.get('id') !== target.searchParams.get('id')) return false;
      return before.has('id') || ['siteId', 'channelId', 'contentType'].every((name) => before.get(name) === target.searchParams.get(name));
    };
    let confirming = false;
    const confirm = (run: () => void) => {
      if (allowed.current || !dirty.current) { run(); return; }
      const retained = persist();
      if (confirming) return;
      confirming = true;
      Modal.confirm({
        title: '离开当前稿件？', content: retained ? '还有未保存到服务器的修改。可以继续编辑并保存；离开后可从本浏览器的恢复副本找回。' : '恢复副本保存失败。请返回编辑页保存到服务器，否则离开将丢失当前修改。',
        okText: retained ? '保留副本并离开' : '放弃修改并离开', cancelText: '继续编辑',
        onOk: () => { confirming = false; run(); }, onCancel: () => { confirming = false; },
      });
    };
    const push: typeof originalPush = (...args) => staysInDraft(args[0]) ? originalPush.apply(navigator, args) : confirm(() => originalPush.apply(navigator, args));
    const replace: typeof originalReplace = (...args) => staysInDraft(args[0]) ? originalReplace.apply(navigator, args) : confirm(() => originalReplace.apply(navigator, args));
    const go: typeof originalGo = (...args) => confirm(() => originalGo.apply(navigator, args));
    navigator.push = push;
    navigator.replace = replace;
    navigator.go = go;
    return () => {
      persistDebouncer.cancel();
      persist();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
      if (navigator.push === push) navigator.push = originalPush;
      if (navigator.replace === replace) navigator.replace = originalReplace;
      if (navigator.go === go) navigator.go = originalGo;
    };
  }, [dirty, navigator, persist, persistDebouncer]);
  const navigateSaved = (action: () => void) => {
    allowed.current = true;
    try { action(); } finally { allowed.current = false; }
  };
  return { pending, storageError, checkpoint, persist, clear, dismiss: () => setPending(null), navigateSaved };
}
