import { useState, useMemo } from 'react';
import { Popover, Input } from '@douyinfe/semi-ui';
import { Search, ChevronDown, X } from 'lucide-react';
import { ICON_REGISTRY, renderLucideIcon } from '../utils/icons';
import './IconPicker.css';

interface IconPickerProps {
  value?: string;
  onChange?: (icon: string) => void;
  style?: React.CSSProperties;
}

export default function IconPicker({ value, onChange, style }: Readonly<IconPickerProps>) {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return Object.keys(ICON_REGISTRY).filter((name) => name.toLowerCase().includes(q));
  }, [search]);

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
        placeholder="搜索图标名称…"
        value={search}
        onChange={(v) => setSearch(v)}
        className="icon-picker-search"
        style={{ marginBottom: 8 }}
      />
      <div className="icon-picker-scroll">
        {searchResults ? (
          <div className="icon-picker-grid">
            {searchResults.length > 0 ? (
              searchResults.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  className={`icon-picker-cell ${value === name ? 'icon-picker-cell--active' : ''}`}
                  onClick={() => handleSelect(name)}
                >
                  {renderLucideIcon(name, 18)}
                </button>
              ))
            ) : (
              <div className="icon-picker-empty-result">无匹配图标</div>
            )}
          </div>
        ) : (
          <div className="icon-picker-grid">
            {Object.keys(ICON_REGISTRY).map((name) => (
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
        )}
      </div>
    </div>
  );

  return (
    <Popover
      content={panelContent}
      visible={visible}
      onVisibleChange={setVisible}
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
