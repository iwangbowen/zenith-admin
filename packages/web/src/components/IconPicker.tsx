import { useState, useMemo } from 'react';
import { Popover, Input, List, Pagination } from '@douyinfe/semi-ui';
import { Search, ChevronDown, X } from 'lucide-react';
import { ALL_ICON_NAMES, renderLucideIcon } from '@/utils/icons';
import './IconPicker.css';

interface IconPickerProps {
  value?: string;
  onChange?: (icon: string) => void;
  style?: React.CSSProperties;
}

/** 每页显示图标数（8 列 × 7 行） */
const PAGE_SIZE = 56;

export default function IconPicker({ value, onChange, style }: Readonly<IconPickerProps>) {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const filteredNames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ALL_ICON_NAMES;
    return ALL_ICON_NAMES.filter((name) => name.toLowerCase().includes(q));
  }, [search]);

  const pageNames = useMemo(
    () => filteredNames.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredNames, currentPage],
  );

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setCurrentPage(1);
  };

  const handleVisibleChange = (v: boolean) => {
    setVisible(v);
    if (v) {
      setCurrentPage(1);
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
      <div className="icon-picker-grid-wrap">
        <List
          size="small"
          split={false}
          grid={{ span: 3, gutter: 4 }}
          dataSource={pageNames}
          emptyContent={<div className="icon-picker-empty-result">无匹配图标</div>}
          renderItem={(name) => (
            <List.Item style={{ padding: 0 }}>
              <button
                type="button"
                className={`icon-picker-cell${value === name ? ' icon-picker-cell--active' : ''}`}
                onClick={() => handleSelect(name)}
                title={name}
              >
                {renderLucideIcon(name, 18)}
              </button>
            </List.Item>
          )}
        />
      </div>
      {filteredNames.length > PAGE_SIZE && (
        <div className="icon-picker-pagination">
          <Pagination
            size="small"
            total={filteredNames.length}
            pageSize={PAGE_SIZE}
            currentPage={currentPage}
            onPageChange={(page) => setCurrentPage(page)}
            showSizeChanger={false}
          />
        </div>
      )}
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
