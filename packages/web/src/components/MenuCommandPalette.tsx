import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Spin } from '@douyinfe/semi-ui';
import { textMatches } from '@/utils/pinyin';
import { Search, Clock, Hash } from 'lucide-react';
import { renderLucideIcon } from '@/utils/icons';
import { useOptionalPreferences } from '@/hooks/usePreferences';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { useGlobalSearch } from '@/hooks/queries/global-search';
import { globalSearchRoutePrefixes, type GlobalSearchResult } from '@zenith/shared/platform';
import type { FlatMenuItem } from './MenuSearchInput';

interface Props {
  readonly menus: FlatMenuItem[];
  readonly recentMenus: FlatMenuItem[];
  readonly onClearRecents: () => void;
  readonly open: boolean;
  readonly onClose: () => void;
}

type PaletteItem = { kind: 'menu'; value: FlatMenuItem } | { kind: 'business'; value: GlobalSearchResult };

const BUSINESS_TYPE_LABELS: Record<GlobalSearchResult['type'], string> = {
  user: '用户',
  member: '会员',
  order: '订单',
  workflow: '流程',
  file: '文件',
  'iot-device': '设备',
  'iot-alarm': '告警',
  'cms-content': 'CMS 内容',
  'wiki-document': 'Wiki 文档',
  announcement: '公告',
  'chat-message': '聊天消息',
  'biz-leave': '请假单',
  'report-dashboard': '仪表盘',
  'report-dataset': '数据集',
  'ai-knowledge-base': 'AI 知识库',
  'async-task': '异步任务',
};

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

function isSafeInternalRoute(route: string) {
  return route.startsWith('/') && !route.startsWith('//') && globalSearchRoutePrefixes.some((prefix) => {
    const root = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return route === root || route.startsWith(`${root}?`) || route.startsWith(prefix);
  });
}

export default function MenuCommandPalette({ menus, recentMenus, onClearRecents, open, onClose }: Props) {
  const navigate = useNavigate();
  const shortcutsEnabled = useOptionalPreferences()?.preferences.enableShortcuts ?? true;
  const isMobile = useIsMobile();
  const pinyinReady = usePinyinReady();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const remoteSearch = useGlobalSearch(query, open);

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
      if (!isSafeInternalRoute(item.value.route)) return;
      onClose();
      navigate(item.value.route);
      return;
    }
    onClose();
    navigate(route);
  }, [navigate, onClose]);

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
      const item = displayItems[selectedIndex];
      if (item) handleSelect(item);
    }
  }, [displayItems, handleSelect, onClose, selectedIndex]);

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
      : [BUSINESS_TYPE_LABELS[item.value.type], item.value.subtitle, item.value.description].filter(Boolean).join(' · ');
    return (
      <button
        key={isMenu ? `menu-${item.value.id}` : `${item.value.type}-${item.value.id}`}
        type="button"
        data-search-index={index}
        onClick={() => handleSelect(item)}
        onMouseEnter={() => setSelectedIndex(index)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 16px', border: 'none', background: isSelected ? 'var(--semi-color-primary-light-default)' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
      >
        <span style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 'var(--semi-border-radius-medium)', background: isSelected ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)', color: isSelected ? '#fff' : 'var(--semi-color-primary)' }}>
          {isMenu ? getMenuIcon(item.value, isRecent) : getBusinessIcon(item.value)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: isSelected ? 'var(--semi-color-primary)' : 'var(--semi-color-text-0)', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.value.title}</div>
          {subtitle && <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)', lineHeight: 1.3, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>}
        </div>
        {isSelected && <kbd style={{ fontSize: 10, color: 'var(--semi-color-primary)', background: 'var(--semi-color-primary-light-default)', border: '1px solid var(--semi-color-primary-light-hover)', borderRadius: 'var(--semi-border-radius-small)', padding: '1px 5px', fontFamily: 'monospace', flexShrink: 0 }}>↵</kbd>}
      </button>
    );
  };

  return (
    <Modal visible={open} header={null} footer={null} closable={false} onCancel={onClose} closeOnEsc={false} maskClosable width={600} className="cmd-palette-modal" style={{ margin: '12vh auto', overflow: 'hidden', borderRadius: 'var(--semi-border-radius-large)', padding: 0 }} bodyStyle={{ padding: 0, overflow: 'hidden' }} zIndex={9999} keepDOM={false}>
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '60vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--semi-color-border)' }}>
          <Search size={17} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} placeholder="搜索菜单、用户、订单、流程..." style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: 'var(--semi-color-text-0)', lineHeight: '22px' }} />
          {remoteSearch.isFetching && query.trim().length >= 2 && <Spin size="small" />}
          {query && <button type="button" onClick={() => setQuery('')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, border: 'none', borderRadius: 'var(--semi-border-radius-small)', background: 'var(--semi-color-fill-1)', color: 'var(--semi-color-text-2)', cursor: 'pointer', padding: 0, flexShrink: 0 }}><span style={{ fontSize: 12, lineHeight: 1 }}>✕</span></button>}
          {!isMobile && <kbd className="cmd-palette-esc" style={{ fontSize: 11, color: 'var(--semi-color-text-2)', background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)', padding: '1px 5px', fontFamily: 'monospace', flexShrink: 0 }}>ESC</kbd>}
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '6px 0', minHeight: 0 }}>
          {isShowingRecent && recentMenus.length > 0 && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 16px 6px', marginBottom: 2 }}><span style={{ fontSize: 11, fontWeight: 600, color: 'var(--semi-color-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>最近访问</span><button type="button" onClick={onClearRecents} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--semi-color-text-2)', padding: '0 2px' }}>清除</button></div>}
          {isShowingRecent && recentMenus.length === 0 && <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--semi-color-text-2)', fontSize: 13 }}><Hash size={28} style={{ margin: '0 auto 10px', opacity: 0.35, display: 'block' }} />输入关键词搜索菜单或业务数据</div>}
          {!isShowingRecent && menuResults.length > 0 && <div style={{ padding: '4px 16px 3px', fontSize: 11, fontWeight: 600, color: 'var(--semi-color-text-2)' }}>菜单</div>}
          {isShowingRecent ? recentMenus.map((item, index) => renderItem({ kind: 'menu', value: item }, index, true)) : menuResults.map((item, index) => renderItem({ kind: 'menu', value: item }, index, false))}
          {!isShowingRecent && remoteResults.length > 0 && <div style={{ padding: '8px 16px 3px', fontSize: 11, fontWeight: 600, color: 'var(--semi-color-text-2)' }}>业务数据</div>}
          {!isShowingRecent && remoteResults.map((item, index) => renderItem({ kind: 'business', value: item }, menuResults.length + index, false))}
          {!isShowingRecent && displayItems.length === 0 && !remoteSearch.isFetching && <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--semi-color-text-2)', fontSize: 13 }}>未找到匹配的菜单或业务数据</div>}
          {!isShowingRecent && remoteSearch.data?.partial && displayItems.length > 0 && <div style={{ padding: '8px 16px', color: 'var(--semi-color-text-2)', fontSize: 11 }}>部分业务数据暂时不可用</div>}
        </div>

        {!isMobile && <div className="cmd-palette-footer" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 16px', borderTop: '1px solid var(--semi-color-border)', fontSize: 11, color: 'var(--semi-color-text-2)' }}><span><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>↑↓</kbd> 导航</span><span><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>↵</kbd> 跳转</span><span><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>ESC</kbd> 关闭</span><span style={{ marginLeft: 'auto' }}><kbd style={{ fontFamily: 'monospace', fontSize: 10, padding: '0 3px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)' }}>Ctrl K</kbd> 快速打开</span></div>}
      </div>
    </Modal>
  );
}
