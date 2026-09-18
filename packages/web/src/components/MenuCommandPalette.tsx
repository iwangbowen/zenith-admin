import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Spin } from '@douyinfe/semi-ui';
import { textMatches } from '@/utils/pinyin';
import { Search, Clock, Hash, X } from 'lucide-react';
import { renderLucideIcon } from '@/utils/icons';
import { useOptionalPreferences } from '@/hooks/usePreferences';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { useGlobalSearch } from '@/hooks/queries/global-search';
import type { GlobalSearchResult, GlobalSearchType } from '@zenith/shared/platform';
import { GLOBAL_SEARCH_TYPE_LABELS, GLOBAL_SEARCH_TYPE_OPTIONS, isSafeInternalSearchRoute } from '@/utils/global-search';
import { trackEvent } from '@/utils/tracker';
import type { FlatMenuItem } from './MenuSearchInput';

interface Props {
  readonly menus: FlatMenuItem[];
  readonly recentMenus: FlatMenuItem[];
  readonly onClearRecents: () => void;
  readonly onRemoveRecent: (menuId: number) => void;
  readonly open: boolean;
  readonly onClose: () => void;
}

type PaletteItem = { kind: 'menu'; value: FlatMenuItem } | { kind: 'business'; value: GlobalSearchResult };

const SEARCH_FILTERS: Array<{ value: 'all' | GlobalSearchType; label: string }> = [
  { value: 'all', label: '全部' },
  ...GLOBAL_SEARCH_TYPE_OPTIONS,
];
function getMenuIcon(item: FlatMenuItem, isRecent: boolean) {
  if (item.icon) {
    const icon = renderLucideIcon(item.icon, 13);
    if (icon) return icon;
  }
  return isRecent ? <Clock size={13} /> : <Hash size={13} />;
}

function getBusinessIcon(item: GlobalSearchResult) {
  const icon = item.icon ? renderLucideIcon(item.icon, 13) : null;
  return icon ?? <Hash size={13} />;
}

export default function MenuCommandPalette({ menus, recentMenus, onClearRecents, onRemoveRecent, open, onClose }: Props) {
  const navigate = useNavigate();
  const shortcutsEnabled = useOptionalPreferences()?.preferences.enableShortcuts ?? true;
  const isMobile = useIsMobile();
  const pinyinReady = usePinyinReady();
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | GlobalSearchType>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const remoteSearch = useGlobalSearch(query, open, selectedType === 'all' ? undefined : [selectedType]);

  const menuResults = useMemo(() => {
    if (!query.trim()) return [];
    const normalized = query.trim().toLowerCase();
    return menus
      .map((menu, index) => {
        const title = menu.title.toLowerCase();
        const breadcrumb = menu.breadcrumb.some((item) => textMatches(item, query));
        const score = title === normalized ? 0 : title.startsWith(normalized) ? 1 : title.includes(normalized) ? 2 : breadcrumb ? 3 : pinyinReady ? 4 : 5;
        return { menu, score, index };
      })
      .filter(({ menu }) => textMatches(menu.title, query) || menu.breadcrumb.some((item) => textMatches(item, query)))
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .slice(0, 8)
      .map(({ menu }) => menu);
  }, [menus, pinyinReady, query]);

  const remoteResults = useMemo(
    () => (query.trim().length >= 2 ? (remoteSearch.data?.results ?? []) : []),
    [query, remoteSearch.data?.results],
  );
  const paletteItems = useMemo<PaletteItem[]>(() => [
    ...menuResults.map((value) => ({ kind: 'menu' as const, value })),
    ...remoteResults.map((value) => ({ kind: 'business' as const, value })),
  ], [menuResults, remoteResults]);
  const isShowingRecent = !query.trim();
  const displayItems = isShowingRecent ? recentMenus.map((value) => ({ kind: 'menu' as const, value })) : paletteItems;

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedType('all');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-search-index="${selectedIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback((item: PaletteItem) => {
    const route = item.kind === 'menu' ? item.value.path : item.value.route;
    if (item.kind === 'business') {
      if (!isSafeInternalSearchRoute(item.value.route)) return;
      trackEvent('global_search_result_click', { source: 'palette', type: item.value.type });
      onClose();
      navigate(item.value.route);
      return;
    }
    onClose();
    navigate(route);
  }, [navigate, onClose]);

  const openSearchCenter = useCallback(() => {
    const value = query.trim();
    const typeParam = selectedType === 'all' ? '' : `&type=${encodeURIComponent(selectedType)}`;
    onClose();
    navigate(value ? `/search?q=${encodeURIComponent(value)}${typeParam}` : '/search');
  }, [navigate, onClose, query, selectedType]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, Math.max(displayItems.length - 1, 0)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        openSearchCenter();
        return;
      }
      const item = displayItems[selectedIndex];
      if (item) handleSelect(item);
    }
  }, [displayItems, handleSelect, onClose, openSearchCenter, selectedIndex]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        if (!shortcutsEnabled) return;
        e.preventDefault();
        if (open) onClose();
        else globalThis.dispatchEvent(new CustomEvent('open-menu-palette'));
      }
      if (e.key === 'Escape' && open) onClose();
    };
    globalThis.addEventListener('keydown', handler);
    return () => globalThis.removeEventListener('keydown', handler);
  }, [open, onClose, shortcutsEnabled]);

  const renderItem = (item: PaletteItem, index: number, isRecent: boolean) => {
    const isSelected = index === selectedIndex;
    const isMenu = item.kind === 'menu';
    const subtitle = isMenu
      ? item.value.breadcrumb.join(' › ')
      : [GLOBAL_SEARCH_TYPE_LABELS[item.value.type], item.value.subtitle, item.value.description].filter(Boolean).join(' · ');
    const highlight = !isMenu ? item.value.highlights[0]?.text : undefined;
    const row = (
      <button
        key={isMenu ? `menu-${item.value.id}` : `${item.value.type}-${item.value.id}`}
        type="button"
        id={`global-search-result-${index}`}
        role="option"
        aria-selected={isSelected}
        data-search-index={index}
        onClick={() => handleSelect(item)}
        onMouseEnter={() => setSelectedIndex(index)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: isRecent ? '8px 44px 8px 16px' : '8px 16px', border: 'none', background: isSelected ? 'var(--semi-color-primary-light-default)' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
      >
        <span style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 'var(--semi-border-radius-medium)', background: isSelected ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)', color: isSelected ? '#fff' : 'var(--semi-color-primary)' }}>
          {isMenu ? getMenuIcon(item.value, isRecent) : getBusinessIcon(item.value)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: isSelected ? 'var(--semi-color-primary)' : 'var(--semi-color-text-0)', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.value.title}</div>
          {subtitle && <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)', lineHeight: 1.3, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>}
          {highlight && highlight !== item.value.title && <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)', lineHeight: 1.3, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>命中：{highlight}</div>}
        </div>
        {isSelected && <kbd style={{ fontSize: 10, color: 'var(--semi-color-primary)', background: 'var(--semi-color-primary-light-default)', border: '1px solid var(--semi-color-primary-light-hover)', borderRadius: 'var(--semi-border-radius-small)', padding: '1px 5px', fontFamily: 'monospace', flexShrink: 0 }}>↵</kbd>}
      </button>
    );
    if (!isRecent || !isMenu) return row;
    return (
      <div key={`recent-${item.value.id}`} style={{ position: 'relative' }}>
        {row}
        <button
          type="button"
          aria-label={`移除${item.value.title}`}
          title="移除最近访问"
          onClick={(event) => {
            event.stopPropagation();
            onRemoveRecent(item.value.id);
          }}
          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, border: 'none', borderRadius: 'var(--semi-border-radius-small)', background: 'transparent', color: 'var(--semi-color-text-2)', cursor: 'pointer' }}
        >
          <X size={14} />
        </button>
      </div>
    );
  };

  return (
    <Modal visible={open} header={null} footer={null} closable={false} onCancel={onClose} closeOnEsc={false} maskClosable width={600} className="cmd-palette-modal" style={{ margin: '12vh auto', overflow: 'hidden', borderRadius: 'var(--semi-border-radius-large)', padding: 0 }} bodyStyle={{ padding: 0, overflow: 'hidden' }} zIndex={9999} keepDOM={false}>
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '60vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--semi-color-border)' }}>
          <Search size={17} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} placeholder="全局搜索" aria-label="全局搜索" aria-controls="global-search-results" aria-activedescendant={displayItems[selectedIndex] ? `global-search-result-${selectedIndex}` : undefined} style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: 'var(--semi-color-text-0)', lineHeight: '22px' }} />
          {remoteSearch.isFetching && query.trim().length >= 2 && <Spin size="small" />}
          {query && <button type="button" onClick={() => setQuery('')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, border: 'none', borderRadius: 'var(--semi-border-radius-small)', background: 'var(--semi-color-fill-1)', color: 'var(--semi-color-text-2)', cursor: 'pointer', padding: 0, flexShrink: 0 }}><span style={{ fontSize: 12, lineHeight: 1 }}>✕</span></button>}
          <button type="button" onClick={openSearchCenter} style={{ border: 'none', background: 'transparent', color: 'var(--semi-color-primary)', cursor: 'pointer', padding: '2px 4px', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>搜索中心</button>
          {!isMobile && <kbd className="cmd-palette-esc" style={{ fontSize: 11, color: 'var(--semi-color-text-2)', background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)', padding: '1px 5px', fontFamily: 'monospace', flexShrink: 0 }}>ESC</kbd>}
        </div>

        {query.trim().length >= 2 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 16px 2px', borderBottom: '1px solid var(--semi-color-border)' }}>
          {SEARCH_FILTERS.map((filter) => {
            const active = selectedType === filter.value;
            return <button key={filter.value} type="button" onClick={() => setSelectedType(filter.value)} style={{ border: `1px solid ${active ? 'var(--semi-color-primary)' : 'var(--semi-color-border)'}`, borderRadius: 'var(--semi-border-radius-large)', padding: '2px 9px', background: active ? 'var(--semi-color-primary-light-default)' : 'transparent', color: active ? 'var(--semi-color-primary)' : 'var(--semi-color-text-2)', cursor: 'pointer', fontSize: 11 }}>{filter.label}</button>;
          })}
        </div>}

        <div ref={listRef} id="global-search-results" role="listbox" aria-label="搜索结果" style={{ flex: 1, overflowY: 'auto', padding: '6px 0', minHeight: 0 }}>
          {isShowingRecent && recentMenus.length > 0 && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 16px 6px', marginBottom: 2 }}><span style={{ fontSize: 11, fontWeight: 600, color: 'var(--semi-color-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>最近访问</span><button type="button" onClick={onClearRecents} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--semi-color-text-2)', padding: '0 2px' }}>清除</button></div>}
          {isShowingRecent && recentMenus.length === 0 && <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--semi-color-text-2)', fontSize: 13 }}><Hash size={28} style={{ margin: '0 auto 10px', opacity: 0.35, display: 'block' }} />输入关键词搜索菜单或业务数据</div>}
          {!isShowingRecent && menuResults.length > 0 && <div style={{ padding: '4px 16px 3px', fontSize: 11, fontWeight: 600, color: 'var(--semi-color-text-2)' }}>菜单</div>}
          {isShowingRecent ? recentMenus.map((item, index) => renderItem({ kind: 'menu', value: item }, index, true)) : menuResults.map((item, index) => renderItem({ kind: 'menu', value: item }, index, false))}
          {!isShowingRecent && remoteResults.length > 0 && <div style={{ padding: '8px 16px 3px', fontSize: 11, fontWeight: 600, color: 'var(--semi-color-text-2)' }}>业务数据</div>}
          {!isShowingRecent && remoteResults.map((item, index) => renderItem({ kind: 'business', value: item }, menuResults.length + index, false))}
          {!isShowingRecent && displayItems.length === 0 && !remoteSearch.isFetching && <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--semi-color-text-2)', fontSize: 13 }}>未找到匹配的菜单或业务数据</div>}
          {!isShowingRecent && remoteSearch.error && <div style={{ padding: '12px 16px', color: 'var(--semi-color-danger)' }}>搜索暂时不可用，请稍后重试 <button type="button" onClick={() => { void remoteSearch.refetch(); }} style={{ border: 'none', background: 'transparent', color: 'var(--semi-color-primary)', cursor: 'pointer', padding: 0 }}>重试</button></div>}
          {!isShowingRecent && remoteSearch.data?.partial && displayItems.length > 0 && <div style={{ padding: '8px 16px', color: 'var(--semi-color-text-2)', fontSize: 11 }}>部分业务数据暂时不可用：{remoteSearch.data.failedTypes.map((type) => GLOBAL_SEARCH_TYPE_LABELS[type]).join('、')}</div>}
        </div>

        {!isMobile && <div className="cmd-palette-footer" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 16px', borderTop: '1px solid var(--semi-color-border)', fontSize: 11, color: 'var(--semi-color-text-2)' }}><span><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>↑↓</kbd> 导航</span><span><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>↵</kbd> 跳转</span><span><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>ESC</kbd> 关闭</span><span style={{ marginLeft: 'auto' }}><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>Ctrl K</kbd> 快速打开</span></div>}
      </div>
    </Modal>
  );
}
