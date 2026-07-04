import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@douyinfe/semi-ui';
import { pinyinMatch } from '@/utils/pinyin';
import { Search, Clock, Hash } from 'lucide-react';
import { renderLucideIcon } from '@/utils/icons';
import type { FlatMenuItem } from './MenuSearchInput';

const RECENT_KEY = 'zenith_menu_search_recent';
const MAX_RECENT = 8;

function getRecentItems(menus: FlatMenuItem[]): FlatMenuItem[] {
  try {
    const ids: number[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as number[];
    return ids.flatMap((id) => {
      const found = menus.find((m) => m.id === id);
      return found ? [found] : [];
    });
  } catch {
    return [];
  }
}

function saveRecent(item: FlatMenuItem): void {
  try {
    const ids: number[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    const next = [item.id, ...ids.filter((id) => id !== item.id)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function clearRecent(): void {
  localStorage.removeItem(RECENT_KEY);
}

interface Props {
  readonly menus: FlatMenuItem[];
  readonly open: boolean;
  readonly onClose: () => void;
}

function getItemIcon(item: FlatMenuItem, isRecent: boolean) {
  if (isRecent) return <Clock size={13} />;
  if (item.icon) {
    const icon = renderLucideIcon(item.icon, 13);
    if (icon) return icon;
  }
  return <Hash size={13} />;
}

export default function MenuCommandPalette({ menus, open, onClose }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentItems, setRecentItems] = useState<FlatMenuItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useCallback(
    (q: string): FlatMenuItem[] => {
      if (!q.trim()) return [];
      const lower = q.toLowerCase();
      return menus
        .filter((m) => {
          const textMatch =
            m.title.toLowerCase().includes(lower) ||
            m.breadcrumb.some((b) => b.toLowerCase().includes(lower));
          if (textMatch) return true;
          return (
            pinyinMatch(m.title, q, { precision: 'start' }) !== null ||
            m.breadcrumb.some((b) => pinyinMatch(b, q, { precision: 'start' }) !== null)
          );
        })
        .slice(0, 10);
    },
    [menus]
  )(query);

  const displayItems = query.trim() ? results : recentItems;
  const isShowingRecent = !query.trim();

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setRecentItems(getRecentItems(menus));
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, menus]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);


  const handleClearRecent = useCallback(() => {
    clearRecent();
    setRecentItems([]);
  }, []);

  const handleSelect = useCallback(
    (item: FlatMenuItem) => {
      saveRecent(item);
      onClose();
      navigate(item.path);
    },
    [navigate, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, displayItems.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        const item = displayItems[selectedIndex];
        if (item) handleSelect(item);
      }
    },
    [displayItems, selectedIndex, handleSelect, onClose]
  );

  // Global keyboard shortcut: Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (open) {
        onClose();
      } else {
        // trigger open via custom event
        globalThis.dispatchEvent(new CustomEvent('open-menu-palette'));
      }
      }
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    globalThis.addEventListener('keydown', handler);
    return () => globalThis.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <Modal
      visible={open}
      centered
      header={null}
      footer={null}
      closable={false}
      onCancel={onClose}
      closeOnEsc={false}
      maskClosable
      width={600}
      className="cmd-palette-modal"
      style={{ overflow: 'hidden', borderRadius: 10, padding: 0 }}
      bodyStyle={{ padding: 0, overflow: 'hidden' }}
      zIndex={9999}
      keepDOM={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '60vh' }}>
        {/* Search Input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--semi-color-border)',
          }}
        >
          <Search size={17} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索菜单..."
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 15,
              color: 'var(--semi-color-text-0)',
              lineHeight: '22px',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                border: 'none',
                borderRadius: 4,
                background: 'var(--semi-color-fill-1)',
                color: 'var(--semi-color-text-2)',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 12, lineHeight: 1 }}>✕</span>
            </button>
          )}
          <kbd
            style={{
              fontSize: 11,
              color: 'var(--semi-color-text-2)',
              background: 'var(--semi-color-fill-0)',
              border: '1px solid var(--semi-color-border)',
              borderRadius: 4,
              padding: '1px 5px',
              fontFamily: 'monospace',
              flexShrink: 0,
            }}
          >
            ESC
          </kbd>
        </div>

        {/* List Area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px 0',
            minHeight: 0,
          }}
        >
          {/* Section header */}
          {isShowingRecent && recentItems.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '2px 16px 6px',
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--semi-color-text-2)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                最近访问
              </span>
              <button
                type="button"
                onClick={handleClearRecent}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 11,
                  color: 'var(--semi-color-text-2)',
                  padding: '0 2px',
                }}
              >
                清除
              </button>
            </div>
          )}

          {isShowingRecent && recentItems.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: 'var(--semi-color-text-2)',
                fontSize: 13,
              }}
            >
              <Hash size={28} style={{ margin: '0 auto 10px', opacity: 0.35, display: 'block' }} />
              输入关键词搜索菜单
            </div>
          )}

          {!isShowingRecent && displayItems.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: 'var(--semi-color-text-2)',
                fontSize: 13,
              }}
            >
              未找到匹配的菜单
            </div>
          )}

          {/* Items */}
          <div ref={listRef}>
            {displayItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 16px',
                    border: 'none',
                    background: isSelected ? 'var(--semi-color-primary-light-default)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      borderRadius: 6,
                      background: isSelected ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)',
                      color: isSelected ? '#fff' : 'var(--semi-color-primary)',
                    }}
                  >
                    {getItemIcon(item, isShowingRecent)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: isSelected ? 'var(--semi-color-primary)' : 'var(--semi-color-text-0)',
                        lineHeight: 1.4,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.title}
                    </div>
                    {item.breadcrumb.length > 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--semi-color-text-2)',
                          lineHeight: 1.3,
                          marginTop: 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.breadcrumb.join(' › ')}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <kbd
                      style={{
                        fontSize: 10,
                        color: 'var(--semi-color-primary)',
                        background: 'var(--semi-color-primary-light-default)',
                        border: '1px solid var(--semi-color-primary-light-hover)',
                        borderRadius: 4,
                        padding: '1px 5px',
                        fontFamily: 'monospace',
                        flexShrink: 0,
                      }}
                    >
                      ↵
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '7px 16px',
            borderTop: '1px solid var(--semi-color-border)',
            fontSize: 11,
            color: 'var(--semi-color-text-2)',
          }}
        >
          <span><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 3 }}>↑↓</kbd> 导航</span>
          <span><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 3 }}>↵</kbd> 跳转</span>
          <span><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 3 }}>ESC</kbd> 关闭</span>
          <span style={{ marginLeft: 'auto' }}>
            <kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 3 }}>Ctrl K</kbd> 快速打开
          </span>
        </div>
      </div>
    </Modal>
  );
}
