import { memo, useMemo } from 'react';
import { Button, Checkbox, Popover, RadioGroup, Radio, Spin, Typography } from '@douyinfe/semi-ui';
import { Columns3 } from 'lucide-react';
import type { DataGridColumn } from './types';

const { Text } = Typography;

export type RowStatusFilterValue = 'all' | 'modified' | 'new' | 'deleted';

interface GridStatusBarProps {
  loaded: number;
  total?: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  /** 数据整体刷新中（stale-while-revalidate：旧数据仍在展示） */
  refreshing?: boolean;
  selectedRowCount: number;
  selectedCellCount: number;
  columns: DataGridColumn[];
  hiddenColumns: Set<string>;
  onToggleColumn: (name: string, visible: boolean) => void;
  onResetColumns: () => void;
  /** 行状态筛选（有暂存变更时显示） */
  rowStatusFilter?: RowStatusFilterValue;
  onRowStatusFilterChange?: (v: RowStatusFilterValue) => void;
  pendingCounts?: { modified: number; added: number; deleted: number; total: number };
  extra?: React.ReactNode;
}

/** 网格底部状态条：加载进度 · 选区统计 · 列设置 */
export const GridStatusBar = memo(function GridStatusBar(props: GridStatusBarProps) {
  const {
    loaded, total, hasMore, loadingMore, refreshing,
    selectedRowCount, selectedCellCount,
    columns, hiddenColumns, onToggleColumn, onResetColumns,
    rowStatusFilter, onRowStatusFilterChange, pendingCounts, extra,
  } = props;

  const columnPanel = useMemo(() => (
    <div style={{ padding: 8, width: 240 }}>
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {columns.map((c) => (
          <div key={c.name} style={{ padding: '3px 4px' }}>
            <Checkbox
              checked={!hiddenColumns.has(c.name)}
              onChange={(e) => onToggleColumn(c.name, Boolean(e.target.checked))}
            >
              <Text size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 170 }}>
                {c.name}
              </Text>
            </Checkbox>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button size="small" theme="borderless" onClick={onResetColumns}>重置列宽与显示</Button>
      </div>
    </div>
  ), [columns, hiddenColumns, onToggleColumn, onResetColumns]);

  let loadedText: string;
  if (total !== undefined) {
    loadedText = `已加载 ${loaded.toLocaleString()} / 共 ${total.toLocaleString()} 行`;
  } else {
    loadedText = `已加载 ${loaded.toLocaleString()} 行`;
  }

  const showStatusFilter = Boolean(
    onRowStatusFilterChange && rowStatusFilter && (pendingCounts?.total ?? 0) > 0,
  );

  return (
    <div className="dg-statusbar">
      {extra}
      {showStatusFilter && (
        <RadioGroup
          type="button"
          buttonSize="small"
          value={rowStatusFilter}
          onChange={(e) => onRowStatusFilterChange?.(e.target.value as RowStatusFilterValue)}
        >
          <Radio value="all">全部</Radio>
          <Radio value="modified" disabled={(pendingCounts?.modified ?? 0) === 0}>已修改</Radio>
          <Radio value="new" disabled={(pendingCounts?.added ?? 0) === 0}>新增</Radio>
          <Radio value="deleted" disabled={(pendingCounts?.deleted ?? 0) === 0}>删除</Radio>
        </RadioGroup>
      )}
      <span>{loadedText}</span>
      {(loadingMore || refreshing) && <Spin size="small" />}
      {!hasMore && total !== undefined && loaded < total && (rowStatusFilter ?? 'all') === 'all' && (
        <Text type="warning" size="small">已达查询上限</Text>
      )}
      {selectedRowCount > 0 && (
        <Text type="primary" size="small">已选 {selectedRowCount} 行</Text>
      )}
      {selectedRowCount === 0 && selectedCellCount > 1 && (
        <Text type="primary" size="small">已选 {selectedCellCount} 格</Text>
      )}
      <span className="dg-statusbar__spacer" />
      {hiddenColumns.size > 0 && (
        <Text type="tertiary" size="small">已隐藏 {hiddenColumns.size} 列</Text>
      )}
      <Popover content={columnPanel} trigger="click" position="topRight">
        <Button size="small" theme="borderless" icon={<Columns3 size={14} />} aria-label="列设置" />
      </Popover>
    </div>
  );
});
