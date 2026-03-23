import { useState, useMemo, useRef, useCallback } from 'react';
import { Popover, Input } from '@douyinfe/semi-ui';
import { Search, ChevronDown, X } from 'lucide-react';
import { ALL_ICON_NAMES, renderLucideIcon } from '../utils/icons';
import './IconPicker.css';

interface IconPickerProps {
  value?: string;
  onChange?: (icon: string) => void;
  style?: React.CSSProperties;
}

const PAGE_SIZE = 300;

export default function IconPicker({ value, onChange, style }: Readonly<IconPickerProps>) {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredNames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ALL_ICON_NAMES;
    return ALL_ICON_NAMES.filter((name) => name.toLowerCase().includes(q));
  }, [search]);

  const displayNames = useMemo(
    () => filteredNames.slice(0, page * PAGE_SIZE),
    [filteredNames, page],
  );

  const hasMore = displayNames.length < filteredNames.length;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      setPage((p) => p + 1);
    }
  }, [hasMore]);

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const handleVisibleChange = (v: boolean) => {
    setVisible(v);
    if (v) {
      setPage(1);
      setSearch('');
    }
  };

  const handleSelect = (name: string) => {
    onChange?.(name);
    setVisible(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.('');
  };

  const panelContent = (
    <div className="icon-picker-panel">
      <Input
        size="small"
        prefix={<Search size={13} />}
        placeholder={`搜索图标（共 ${ALL_ICON_NAMES.length} 个）…`}
        value={search}
        onChange={handleSearchChange}
        className="icon-picker-search"
        style={{ marginBottom: 8 }}
      />
      <div className="icon-picker-scroll" ref={scrollRef} onScroll={handleScroll}>
        {filteredNames.length > 0 ? (
          <>
            <div className="icon-picker-grid">
              {displayNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  className={`icon-picker-cell ${value === name ? 'icon-picker-cell--active' : ''}`}
                  onClick={() => handleSelect(name)}
                >
                  {renderLucideIcon(name, 18)}
                </button>
              ))}
            </div>
            {hasMore && (
              <div className="icon-picker-load-more">
                向下滚动加载更多 ({displayNames.length} / {filteredNames.length})
              </div>
            )}
          </>
        ) : (
          <div className="icon-picker-empty-result">无匹配图标</div>
        )}
      </div>
    </div>
  );

  return (
    <Popover
      content={panelContent}
      visible={visible}
      onVisibleChange={handleVisibleChange}
      trigger="click"
      position="bottomLeft"
      showArrow={false}
    >
      <div
        className={`icon-picker-trigger ${visible ? 'icon-picker-trigger--open' : ''}`}
        style={style}
      >
        <span className="icon-picker-preview">
          {value ? renderLucideIcon(value, 16) : null}
        </span>
        <span className={`icon-picker-label ${value ? '' : 'icon-picker-label--placeholder'}`}>
          {value || '点击选择图标'}
        </span>
        {value ? (
          <button type="button" className="icon-picker-arrow icon-picker-arrow--clear" onClick={handleClear}>
            <X size={13} />
          </button>
        ) : (
          <span className="icon-picker-arrow">
            <ChevronDown size={13} />
          </span>
        )}
      </div>
    </Popover>
  );
}
