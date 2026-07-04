/**
 * TabSwitcher — 标签页快速切换器
 *
 * 点击 ChevronDown 图标展开所有已打开标签页，
 * 支持搜索（中文拼音）、上下方向键导航、Enter 跳转、逐条关闭。
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Input, List, Popover, Typography } from '@douyinfe/semi-ui';
import { ChevronDown, Search, X } from 'lucide-react';
import { pinyinMatch } from '@/utils/pinyin';
import { renderLucideIcon } from '@/utils/icons';
import type { TabItem } from '@/hooks/useTabsStore';

interface TabSwitcherProps {
  readonly tabs: TabItem[];
  readonly activeKey: string;
  readonly onNavigate: (key: string) => void;
  readonly onClose: (key: string) => void;
  readonly pathIconMap?: Record<string, string>;
}

export function TabSwitcher({ tabs, activeKey, onNavigate, onClose, pathIconMap }: TabSwitcherProps) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = tabs.filter((t) => {
    if (!search.trim()) return true;
    return t.title.toLowerCase().includes(search.toLowerCase()) || pinyinMatch(t.title, search);
  });

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

  const content = (
    <div style={{ width: 280 }}>
      {/* 搜索框 */}
      <div style={{ padding: '8px 8px 4px' }}>
        <Input
          ref={inputRef}
          size="small"
          prefix={<Search size={13} />}
          placeholder="搜索标签页…"
          value={search}
          onChange={setSearch}
          showClear
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* 标签页列表 */}
      <div ref={listRef} style={{ maxHeight: 320, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '12px 16px', textAlign: 'center' }}>
            <Typography.Text type="tertiary" size="small">没有匹配的标签页</Typography.Text>
          </div>
        ) : (
          <List
            split={false}
            size="small"
            dataSource={filtered}
            renderItem={(tab, idx) => {
              const isActive = tab.key === activeKey;
              const isFocused = idx === focusedIdx;
              return (
                <List.Item
                  key={tab.key}
                  data-idx={idx}
                  style={{
                    padding: '5px 8px',
                    cursor: 'pointer',
                    borderRadius: 6,
                    margin: '1px 4px',
                    background: isFocused
                      ? 'var(--semi-color-fill-1)'
                      : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={() => setFocusedIdx(idx)}
                  onClick={() => { onNavigate(tab.key); setVisible(false); }}
                  main={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                      {(tab.icon ?? pathIconMap?.[tab.key]) && (
                        <span style={{ display: 'inline-flex', flexShrink: 0, opacity: 0.6 }}>
                          {renderLucideIcon((tab.icon ?? pathIconMap?.[tab.key])!, 13)}
                        </span>
                      )}
                      <Typography.Text
                        ellipsis={{ showTooltip: false }}
                        strong={isActive}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 13,
                          color: isActive ? 'var(--semi-color-primary)' : undefined,
                        }}
                      >
                        {tab.title}
                      </Typography.Text>
                    </span>
                  }
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
            }}
          />
        )}
      </div>

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
