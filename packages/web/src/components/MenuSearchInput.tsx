import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import MenuCommandPalette from './MenuCommandPalette';

export interface FlatMenuItem {
  id: number;
  title: string;
  path: string;
  icon?: string;
  breadcrumb: string[];
}

interface MenuSearchInputProps {
  readonly menus: FlatMenuItem[];
}

export default function MenuSearchInput({ menus }: MenuSearchInputProps) {
  const [open, setOpen] = useState(false);

  // Listen for global Ctrl+K shortcut dispatched from palette
  useEffect(() => {
    const handler = () => setOpen(true);
    globalThis.addEventListener('open-menu-palette', handler);
    return () => globalThis.removeEventListener('open-menu-palette', handler);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="搜索菜单 (Ctrl+K)"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          border: 0,
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--semi-color-text-2)',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--semi-color-fill-0)';
          e.currentTarget.style.color = 'var(--semi-color-text-0)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--semi-color-text-2)';
        }}
      >
        <Search size={16} strokeWidth={1.8} />
      </button>
      <MenuCommandPalette menus={menus} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
