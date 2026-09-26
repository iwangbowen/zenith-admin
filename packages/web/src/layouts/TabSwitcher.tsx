/**
 * TabSwitcher — 标签页快速切换器（Chrome 标签页搜索风格）
 *
 * 顶部搜索（中文拼音）+ 快捷键 Ctrl+Shift+A 开合；「打开的标签页」分组显示
 * 图标 / 标题 / 路径·相对时间副标题，悬停关闭；底部「最近关闭的标签页」
 * 可折叠，点击重新打开。上下方向键导航、Enter 跳转、Esc 关闭。
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Input, List, Popover, Typography } from '@douyinfe/semi-ui';
import { ChevronDown, Search, X } from 'lucide-react';
import { textMatches } from '@/utils/pinyin';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { renderLucideIcon, useLucideIconsReady } from '@/utils/icons';
import { useOptionalPreferences } from '@/hooks/usePreferences';
import { formatRelativeTime } from '@/utils/date';
import type { TabItem } from '@/hooks/useTabsStore';

/** 最近关闭的标签快照（会话内有效，不持久化）：重开走路由导航，标题/图标由路由元数据重新解析 */
export interface RecentlyClosedTab {
  readonly key: string;
  readonly title: string;
  readonly icon?: string;
  readonly closedAt: number;
}

interface TabSwitcherProps {
  readonly tabs: TabItem[];
  readonly activeKey: string;
  readonly onNavigate: (key: string) => void;
  readonly onClose: (key: string) => void;
  readonly resolveIcon?: (pathname: string) => string | undefined;
  readonly recentlyClosed?: readonly RecentlyClosedTab[];
  readonly onReopen?: (key: string) => void;
}

/** 图标磁贴：无图标时取标题首字（Chrome 无 favicon 时的字母磁贴既视感） */
function TabIconTile({ title, iconName }: Readonly<{ title: string; iconName?: string }>) {
  return (
    <span
      style={{
        width: 28, height: 28, borderRadius: 'var(--semi-border-radius-medium)', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--semi-color-fill-0)', color: 'var(--semi-color-text-1)',
      }}
    >
      {iconName
        ? renderLucideIcon(iconName, 14)
        : <span style={{ fontSize: 13, fontWeight: 600 }}>{title.slice(0, 1)}</span>}
    </span>
  );
}

export function TabSwitcher({ tabs, activeKey, onNavigate, onClose, resolveIcon, recentlyClosed = [], onReopen }: TabSwitcherProps) {
  useLucideIconsReady();
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shortcutsEnabled = useOptionalPreferences()?.preferences.enableShortcuts ?? true;
  // 拼音词典就绪后重渲染，补上已输入关键字的拼音命中（与其他搜索同口径）
  usePinyinReady();
  // 相对时间（x 秒前）随展示流逝：面板打开期间每 15 秒重算一次
  const [, setClockTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setClockTick((v) => v + 1), 15_000);
    return () => clearInterval(timer);
  }, [visible]);

  // 快捷键开合（Chrome 同款 Ctrl+Shift+A）：输入框内不劫持
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || (e.key !== 'a' && e.key !== 'A') || !shortcutsEnabled) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      setVisible((v) => !v);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsEnabled]);

  const filtered = tabs.filter((t) => textMatches(t.title, search));
  const closedFiltered = recentlyClosed.filter((t) => textMatches(t.title, search));

  // 打开时自动 focus 搜索框 + 选中当前标签
  useEffect(() => {
    if (visible) {
      setSearch('');
      const idx = filtered.findIndex((t) => t.key === activeKey);
      setFocusedIdx(Math.max(0, idx));
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // search 变化时重置 focus
  useEffect(() => {
    setFocusedIdx(0);
  }, [search]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const tab = filtered[focusedIdx];
      if (tab) { onNavigate(tab.key); setVisible(false); }
    } else if (e.key === 'Escape') {
      setVisible(false);
    }
  }, [filtered, focusedIdx, onNavigate]);

  // 滚动高亮项进入视野
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.querySelector<HTMLDivElement>(`[data-idx="${focusedIdx}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  const renderOpenRow = (tab: TabItem, idx: number) => {
    const isActive = tab.key === activeKey;
    const isFocused = idx === focusedIdx;
    const iconName = tab.icon ?? resolveIcon?.(tab.key);
    const subtitle = tab.lastUsedAt ? `${tab.key} • ${formatRelativeTime(tab.lastUsedAt)}` : tab.key;
    return (
      <List.Item
        key={tab.key}
        data-idx={idx}
        style={{
          padding: '6px 8px',
          cursor: 'pointer',
          borderRadius: 'var(--semi-border-radius-medium)',
          margin: '1px 4px',
          background: isFocused ? 'var(--semi-color-fill-1)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          transition: 'background 0.1s',
        }}
        onMouseEnter={() => setFocusedIdx(idx)}
        onClick={() => { onNavigate(tab.key); setVisible(false); }}
        main={(
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <TabIconTile title={tab.title} iconName={iconName} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography.Text
                ellipsis={{ showTooltip: false }}
                strong={isActive}
                style={{ fontSize: 13, color: isActive ? 'var(--semi-color-primary)' : undefined }}
              >
                {tab.title}
              </Typography.Text>
              <Typography.Text ellipsis={{ showTooltip: false }} type="tertiary" style={{ fontSize: 12 }}>
                {subtitle}
              </Typography.Text>
            </span>
          </span>
        )}
        extra={
          tab.closable ? (
            <Button
              icon={<X size={12} />}
              size="small"
              theme="borderless"
              type="tertiary"
              style={{ flexShrink: 0, opacity: isFocused ? 1 : 0, transition: 'opacity 0.1s' }}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.key);
                // 如果关闭后列表变空就收起
                if (tabs.filter((t) => t.closable || t.key === activeKey).length <= 1) {
                  setVisible(false);
                }
              }}
            />
          ) : undefined
        }
      />
    );
  };

  const renderClosedRow = (tab: RecentlyClosedTab) => {
    const iconName = tab.icon;
    return (
      <List.Item
        key={tab.key}
        style={{
          padding: '6px 8px',
          cursor: 'pointer',
          borderRadius: 'var(--semi-border-radius-medium)',
          margin: '1px 4px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        onClick={() => onReopen?.(tab.key)}
        main={(
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <TabIconTile title={tab.title} iconName={iconName} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography.Text ellipsis={{ showTooltip: false }} style={{ fontSize: 13 }}>
                {tab.title}
              </Typography.Text>
              <Typography.Text ellipsis={{ showTooltip: false }} type="tertiary" style={{ fontSize: 12 }}>
                {`${tab.key} • ${formatRelativeTime(tab.closedAt)}`}
              </Typography.Text>
            </span>
          </span>
        )}
      />
    );
  };

  const content = (
    <div style={{ width: 340 }}>
      {/* 搜索框 */}
      <div style={{ padding: '8px 8px 4px' }}>
        <Input
          ref={inputRef}
          size="small"
          prefix={<Search size={13} />}
          suffix={<kbd style={{ fontSize: 11, color: 'var(--semi-color-text-2)', fontFamily: 'inherit' }}>Ctrl+Shift+A</kbd>}
          placeholder="搜索标签页"
          value={search}
          onChange={setSearch}
          showClear
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* 打开的标签页 */}
      <div style={{ padding: '6px 12px 2px' }}>
        <Typography.Text type="tertiary" style={{ fontSize: 12 }}>打开的标签页</Typography.Text>
      </div>
      <div ref={listRef} style={{ maxHeight: 300, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '12px 16px', textAlign: 'center' }}>
            <Typography.Text type="tertiary" size="small">没有匹配的标签页</Typography.Text>
          </div>
        ) : (
          <List
            split={false}
            size="small"
            dataSource={filtered}
            renderItem={renderOpenRow}
          />
        )}
      </div>

      {/* 最近关闭的标签页 */}
      {onReopen && closedFiltered.length > 0 && (
        <div style={{ borderTop: '1px solid var(--semi-color-border)', marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setClosedExpanded((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '8px 12px 4px', border: 0, background: 'transparent', cursor: 'pointer',
            }}
          >
            <Typography.Text type="tertiary" style={{ fontSize: 12 }}>最近关闭的标签页</Typography.Text>
            <ChevronDown size={13} style={{ color: 'var(--semi-color-text-2)', transition: 'transform 0.2s', transform: closedExpanded ? 'rotate(180deg)' : 'none' }} />
          </button>
          {closedExpanded && (
            <div style={{ maxHeight: 200, overflowY: 'auto', paddingBottom: 4 }}>
              <List
                split={false}
                size="small"
                dataSource={closedFiltered}
                renderItem={renderClosedRow}
              />
            </div>
          )}
        </div>
      )}

      {/* 底部提示 */}
      <div style={{ padding: '4px 12px 8px', borderTop: '1px solid var(--semi-color-border)', marginTop: 4 }}>
        <Typography.Text type="tertiary" style={{ fontSize: 11 }}>
          ↑↓ 导航 · Enter 跳转 · Esc 关闭
        </Typography.Text>
      </div>
    </div>
  );

  return (
    <div className="admin-tabs-bar__switcher">
      <Popover
        trigger="custom"
        visible={visible}
        onClickOutSide={() => setVisible(false)}
        content={content}
        position="bottomRight"
        style={{ padding: 0 }}
        showArrow={false}
      >
        <button
          type="button"
          title="所有标签页"
          onClick={() => setVisible((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: '100%',
            border: 'none',
            background: visible ? 'var(--semi-color-fill-1)' : 'transparent',
            cursor: 'pointer',
            color: 'var(--semi-color-text-1)',
            flexShrink: 0,
            transition: 'background 0.15s',
            padding: 0,
          }}
        >
          <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: visible ? 'rotate(180deg)' : 'none' }} />
        </button>
      </Popover>
    </div>
  );
}
