/** 列表视图：ConfigurableTable + 列定义（操作列与右键菜单共享 EntryActions） */
import React from 'react';
import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Icon } from '@iconify/react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { FileNameCell } from '@/components/FileNameCell';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { getFileIcon, getFolderIcon } from '@/utils/fileIcons';
import { isArchive, isEditableFile } from '../fs-utils';
import type { EntryActions } from '../entry-actions';
import type { ClipOp, FsEntry, SortField, SortState } from '../types';
import { dateTimeColumn, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { formatBytes } from '@zenith/shared/core';

// Table 虚拟滚动：ConfigurableTable 有工具栏（约36px）+ 表头（约37px）= 73px
const VIRTUAL_ITEM_HEIGHT = 40;
const TABLE_OVERHEAD = 73;

interface FmListViewProps {
  readonly entries: FsEntry[];
  readonly isWindows: boolean;
  readonly loading: boolean;
  readonly contentHeight: number;
  readonly sortState: SortState | null;
  readonly onSortChange: (s: SortState | null) => void;
  readonly selectedPaths: Set<string>;
  readonly onSelectionChange: (paths: Set<string>) => void;
  readonly onToggleSelect: (path: string) => void;
  readonly clipboard: { paths: string[]; op: ClipOp } | null;
  readonly onRefresh: () => void;
  readonly onOpenEntry: (entry: FsEntry) => void;
  readonly onContextMenu: (e: React.MouseEvent, entry: FsEntry) => void;
  readonly actions: EntryActions;
}

export default function FmListView({
  entries, isWindows, loading, contentHeight, sortState, onSortChange,
  selectedPaths, onSelectionChange, onToggleSelect, clipboard,
  onRefresh, onOpenEntry, onContextMenu, actions,
}: Readonly<FmListViewProps>) {
  const columns: ColumnProps<FsEntry>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      sorter: true,
      sortOrder: sortState?.field === 'name' ? sortState.order : false,
      ellipsis: { showTitle: false },
      render: (v: string, r: FsEntry) => {
        const iconId = r.type === 'dir' ? getFolderIcon(v, false) : getFileIcon(v);
        return (
          <FileNameCell
            name={v}
            icon={<Icon icon={iconId} width={16} height={16} />}
            onClick={r.type === 'dir' ? () => void actions.navigateTo(r.path) : undefined}
          />
        );
      },
    },
    { title: '大小', dataIndex: 'size', width: 100, align: 'right', sorter: true, sortOrder: sortState?.field === 'size' ? sortState.order : false, render: (v: number, r: FsEntry) => r.type === 'dir' ? EMPTY_PLACEHOLDER : formatBytes(v) },
    dateTimeColumn('修改时间', 'mtime', { sorter: true, sortOrder: sortState?.field === 'mtime' ? sortState.order : false }),
    // Windows 下权限/属主概念不适用，隐藏对应列
    ...(isWindows ? [] : [
      { title: '权限', dataIndex: 'permissions', width: 110, render: (v?: string) => v ? <Tag size="small" color="grey">{v}</Tag> : EMPTY_PLACEHOLDER },
      { title: 'UID', dataIndex: 'uid', width: 70, render: (v?: number) => v ?? EMPTY_PLACEHOLDER },
      { title: 'GID', dataIndex: 'gid', width: 70, render: (v?: number) => v ?? EMPTY_PLACEHOLDER },
    ] satisfies ColumnProps<FsEntry>[]),
    createOperationColumn<FsEntry>({
      width: 180,
      desktopInlineKeys: ['open', 'preview', 'edit'],
      actions: (record) => [
        ...(record.type === 'dir'
          ? [{
              key: 'open',
              label: '打开',
              onClick: () => { void actions.navigateTo(record.path); },
            }]
          : [
              {
                key: 'preview',
                label: '预览',
                onClick: () => actions.onPreview(record),
              },
              ...(isEditableFile(record.name)
                ? [{
                    key: 'edit',
                    label: '编辑',
                    onClick: () => actions.onEdit(record),
                  }]
                : []),
              {
                key: 'download',
                label: '下载',
                onClick: () => actions.onDownload(record),
              },
            ]),
        {
          key: 'rename',
          label: '重命名',
          onClick: () => actions.onRename(record),
        },
        {
          key: 'copy',
          label: '复制到...',
          onClick: () => actions.onCopyTo([record]),
        },
        {
          key: 'move',
          label: '移动到...',
          onClick: () => actions.onMoveTo([record]),
        },
        {
          key: 'compress',
          label: '压缩为 ZIP',
          onClick: () => actions.onCompress([record], `${record.name}.zip`),
        },
        {
          key: 'extract',
          label: '解压到此处',
          hidden: record.type === 'dir' || !isArchive(record.name),
          onClick: () => actions.onExtract(record),
        },
        {
          key: 'checksum',
          label: '校验和',
          hidden: record.type === 'dir',
          onClick: () => actions.onChecksum(record),
        },
        {
          key: 'chmod',
          label: '修改权限',
          onClick: () => actions.onChmod(record),
        },
        {
          key: 'props',
          label: '属性',
          onClick: () => actions.onProps(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          dividerBefore: true,
          onClick: () => actions.onDelete([record.path]),
        },
      ],
    }),
  ];

  const tableScrollY = contentHeight > TABLE_OVERHEAD + VIRTUAL_ITEM_HEIGHT * 2
    ? contentHeight - TABLE_OVERHEAD
    : undefined;

  return (
    <ConfigurableTable
      bordered
      rowKey="path"
      dataSource={entries}
      columns={columns}
      loading={false}
      pagination={false}
      size="small"
      onRefresh={onRefresh}
      refreshLoading={loading}
      scroll={tableScrollY ? { y: tableScrollY } : undefined}
      virtualized={tableScrollY ? { itemSize: VIRTUAL_ITEM_HEIGHT } : undefined}
      rowSelection={{
        selectedRowKeys: [...selectedPaths],
        // eslint-disable-next-line no-restricted-syntax -- 选中集合由父组件以 Set<string> 持有并跨视图共享，不走 useRowSelection
        onChange: (keys) => onSelectionChange(new Set(keys as string[])),
      }}
      onChange={({ sorter }) => {
        const s = sorter as { dataIndex?: string; sortOrder?: 'ascend' | 'descend' | false } | undefined;
        if (s?.dataIndex && s.sortOrder) {
          onSortChange({ field: s.dataIndex as SortField, order: s.sortOrder });
        } else {
          onSortChange(null);
        }
      }}
      onRow={(r) => ({
        onContextMenu: r ? (e: React.MouseEvent) => onContextMenu(e, r) : undefined,
        // 剪切中的条目半透明提示
        className: r && clipboard?.op === 'cut' && clipboard.paths.includes(r.path) ? 'fm-row--cut' : undefined,
        // 与网格视图统一：行空白处单击选中、双击打开（按钮/复选框/链接自身的点击不参与）
        onClick: r ? (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('button, a, input, .semi-checkbox, .semi-switch')) return;
          onToggleSelect(r.path);
        } : undefined,
        onDoubleClick: r ? (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('button, a, input, .semi-checkbox, .semi-switch')) return;
          onOpenEntry(r);
        } : undefined,
      })}
    />
  );
}
