import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import MenuCommandPalette from './MenuCommandPalette';
import './MenuSearchInput.css';

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
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Listen for global Ctrl+K shortcut dispatched from palette
  useEffect(() => {
    const handler = () => setOpen(true);
    globalThis.addEventListener('open-menu-palette', handler);
    return () => globalThis.removeEventListener('open-menu-palette', handler);
  }, []);

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
        onClick={() => setOpen(true)}
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
      <MenuCommandPalette menus={menus} recentMenus={recentMenus} onClearRecents={onClearRecents} onRemoveRecent={onRemoveRecent} open={open} onClose={handleClose} />
    </>
  );
}
