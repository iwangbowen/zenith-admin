import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { useOptionalPreferences } from '@/hooks/usePreferences';
import './MenuSearchInput.css';

const MenuCommandPalette = lazy(() => import('./MenuCommandPalette'));

export interface FlatMenuItem {
  id: number;
  title: string;
  path: string;
  icon?: string;
  breadcrumb: string[];
}

interface MenuSearchInputProps {
  readonly menus: FlatMenuItem[];
  readonly recentMenus: FlatMenuItem[];
  readonly onClearRecents: () => void;
  readonly onRemoveRecent: (menuId: number) => void;
}

export default function MenuSearchInput({ menus, recentMenus, onClearRecents, onRemoveRecent }: MenuSearchInputProps) {
  const [open, setOpen] = useState(false);
  const [openedOnce, setOpenedOnce] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const shortcutsEnabled = useOptionalPreferences()?.preferences.enableShortcuts ?? true;

  // The trigger owns shortcuts so the search runtime can stay unloaded until first use.
  useEffect(() => {
    const handler = () => { setOpenedOnce(true); setOpen(true); };
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k' && shortcutsEnabled) {
        event.preventDefault();
        setOpenedOnce(true);
        setOpen((current) => !current);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    globalThis.addEventListener('open-menu-palette', handler);
    globalThis.addEventListener('keydown', keyboard);
    return () => {
      globalThis.removeEventListener('open-menu-palette', handler);
      globalThis.removeEventListener('keydown', keyboard);
    };
  }, [shortcutsEnabled]);

  const handleClose = () => {
    setOpen(false);
    // 关闭弹窗后清理当前焦点，避免触发器在跳转后仍显示 focus-visible 状态。
    setTimeout(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
      buttonRef.current?.blur();
    }, 0);
  };

  useEffect(() => {
    if (open) return;
    // 处理路由跳转或 Modal 外部关闭导致未经过 handleClose 的情况。
    const timer = setTimeout(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
      buttonRef.current?.blur();
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="menu-search-trigger"
        onClick={() => { setOpenedOnce(true); setOpen(true); }}
        title="全局搜索 (Ctrl+K)"
        aria-label="全局搜索"
        aria-expanded={open}
      >
        <span className="menu-search-trigger__icon">
          <Search size={16} strokeWidth={1.8} />
        </span>
        <span className="menu-search-trigger__label">全局搜索</span>
        <kbd className="menu-search-trigger__kbd">Ctrl K</kbd>
      </button>
      {openedOnce && <Suspense fallback={null}><MenuCommandPalette menus={menus} recentMenus={recentMenus} onClearRecents={onClearRecents} onRemoveRecent={onRemoveRecent} open={open} onClose={handleClose} /></Suspense>}
    </>
  );
}
