import { useMemo, useState } from 'react';
import { Button, Empty, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Trash2 } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import {
  DRIVE_ACTIVITY_ACTION_LABELS, DRIVE_ROLE_LABELS, DRIVE_SHARE_PERMISSION_LABELS, DRIVE_SUBJECT_TYPE_LABELS,
  type DriveNode, type DriveRecentItem, type DriveSearchItem, type DriveShareLink, type DriveSharedItem, type DriveView,
} from '@zenith/shared/drive';
import ConfigurableTable from '@/components/ConfigurableTable';
import { FileNameCell } from '@/components/FileNameCell';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';
import { KeywordInput, FilterSelect } from '@/components/search-filters';
import { SearchButton, ResetButton } from '@/components/toolbar-controls';
import { SearchToolbar } from '@/components/SearchToolbar';
import { createOperationColumn, type ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import { useFilePreview } from '@/hooks/useFilePreview';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import {
  driveKeys, useDeleteDriveShareLink, useDriveRecent, useDriveRecycle, useDriveSearch, useDriveSharedWithMe, useDriveStarred,
  useMyDriveShareLinks, useMyDriveSpaces, usePurgeDriveNodes, useRestoreDriveNodes, useRevokeDriveShareLink, useStarDriveNode,
} from '@/hooks/queries/drive';
import { confirmDanger } from '@/utils/confirm';
import { copyTextWithToast } from '@/utils/clipboard';
import { canPreviewFile, fetchManagedFileBlob } from '@/utils/file-utils';
import { downloadBlob } from '@/utils/download';
import { dateTimeColumn, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { nodeDownloadUrl, nodeToManagedFile, roleAtLeast, shareLinkStateTag } from '../drive-utils';

type ListView = Exclude<DriveView, 'space'>;

interface DriveViewsProps {
  readonly view: ListView;
  readonly onOpenFolder: (spaceId: number, folderId: number | null) => void;
  readonly onOpenDetail: (nodeId: number) => void;
}

interface ViewSearch {
  keyword: string;
  spaceId: number | undefined;
}

const VIEW_TITLES: Record<ListView, string> = {
  shared: '与我共享', starred: '我的收藏', recent: '最近访问', recycle: '回收站', links: '我的外链',
};

const VIEW_EMPTY: Record<ListView, string> = {
  shared: '还没有人给你单独授权的文件',
  starred: '收藏常用文件，方便快速打开',
  recent: '最近预览 / 下载 / 上传过的文件会出现在这里',
  recycle: '回收站为空',
  links: '还没有创建外链',
};

type AnyNode = DriveNode & { spaceName?: string };

/** 跨空间个人视图：与我共享 / 收藏 / 最近 / 回收站 / 我的外链 */
export function DriveViews({ view, onOpenFolder, onOpenDetail }: DriveViewsProps) {
  const { hasPermission } = usePermission();
  const spacesQuery = useMyDriveSpaces();
  const listKey = driveKeys.viewOf(view === 'links' ? 'links' : view);
  const { page, pageSize, buildPagination, draftParams, setDraftParams, submittedParams, handleSearch, handleReset } =
    useListSearch<ViewSearch>({ defaults: { keyword: '', spaceId: undefined }, listKey });
  const baseParams = { page, pageSize, keyword: submittedParams.keyword || undefined };
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const shared = useDriveSharedWithMe(baseParams, view === 'shared');
  const starred = useDriveStarred(baseParams, view === 'starred');
  const recent = useDriveRecent(baseParams, view === 'recent');
  // 个人视图中只有回收站支持按空间筛选
  const recycle = useDriveRecycle({ ...baseParams, spaceId: submittedParams.spaceId }, view === 'recycle');
  const links = useMyDriveShareLinks(baseParams, view === 'links');

  const active = view === 'shared' ? shared : view === 'starred' ? starred : view === 'recent' ? recent : view === 'recycle' ? recycle : links;
  const rows = useMemo(() => (active.data?.list ?? []) as AnyNode[] | DriveShareLink[], [active.data?.list]);
  const total = active.data?.total ?? 0;

  const star = useStarDriveNode();
  const restore = useRestoreDriveNodes();
  const purge = usePurgeDriveNodes();
  const revoke = useRevokeDriveShareLink();
  const removeLink = useDeleteDriveShareLink();

  const nodeRows = useMemo(() => (view === 'links' ? [] : (rows as AnyNode[])), [rows, view]);
  const preview = useFilePreview(() => nodeRows.filter((n) => n.type === 'file' && n.url).map(nodeToManagedFile));

  const openNode = (node: AnyNode) => {
    if (view === 'recycle') return;
    if (node.type === 'folder') { onOpenFolder(node.spaceId, node.id); return; }
    if (canPreviewFile(node.mimeType, node.name) && node.url) void preview.handlePreview(nodeToManagedFile(node));
    else onOpenDetail(node.id);
  };

  const nodeActions = (node: AnyNode): ResponsiveTableAction[] => {
    if (view === 'recycle') {
      return [
        { key: 'restore', label: '还原', hidden: !hasPermission('drive:recycle:restore'), onClick: async () => { await restore.mutateAsync({ body: { ids: [node.id] } }); Toast.success('已还原'); } },
        { key: 'purge', label: '彻底删除', danger: true, hidden: !hasPermission('drive:recycle:purge'), onClick: () => { confirmDanger({
          title: `彻底删除「${node.name}」？`, content: '文件将被永久删除且不可恢复。', okText: '彻底删除',
          onOk: () => purge.mutateAsync({ ids: [node.id] }).then(() => Toast.success('已彻底删除')),
        }); } },
      ];
    }
    return [
      ...(node.type === 'file' && canPreviewFile(node.mimeType, node.name) ? [{ key: 'preview', label: '预览', onClick: () => openNode(node) }] : []),
      ...(node.type === 'file' && hasPermission('drive:node:download') && roleAtLeast(node.myRole, 'downloader')
        ? [{ key: 'download', label: '下载', onClick: async () => downloadBlob(await fetchManagedFileBlob(nodeDownloadUrl(node)), node.name) }] : []),
      { key: 'locate', label: '打开所在目录', onClick: () => onOpenFolder(node.spaceId, node.parentId) },
      { key: 'detail', label: '详情', onClick: () => onOpenDetail(node.id) },
      { key: 'star', label: node.isStarred ? '取消收藏' : '收藏', onClick: () => star.mutate({ node, starred: !node.isStarred }) },
    ];
  };

  const nameColumn: ColumnProps<AnyNode> = {
    title: '名称', dataIndex: 'name', minWidth: 240, ellipsis: { showTitle: false },
    render: (_: unknown, node: AnyNode) => (
      <FileNameCell name={node.name} mimeType={node.type === 'folder' ? 'inode/directory' : node.mimeType} onClick={view === 'recycle' ? undefined : () => openNode(node)} />
    ),
  };
  const spaceColumn: ColumnProps<AnyNode> = { title: '所在空间', dataIndex: 'spaceName', width: 140, render: (v: string | undefined) => v ?? EMPTY_PLACEHOLDER };
  const sizeColumn: ColumnProps<AnyNode> = { title: '大小', dataIndex: 'size', width: 100, render: (v: number, n: AnyNode) => (n.type === 'folder' ? EMPTY_PLACEHOLDER : formatBytes(v)) };

  const nodeColumns: ColumnProps<AnyNode>[] = (() => {
    switch (view) {
      case 'shared':
        return [nameColumn, spaceColumn, sizeColumn,
          { title: '授权来源', dataIndex: 'grantedVia', width: 110, render: (v: DriveSharedItem['grantedVia']) => DRIVE_SUBJECT_TYPE_LABELS[v] },
          { title: '角色', dataIndex: 'grantedRole', width: 90, render: (v: DriveSharedItem['grantedRole']) => DRIVE_ROLE_LABELS[v] },
          dateTimeColumn('修改时间', 'updatedAt'),
          createOperationColumn<AnyNode>({ width: 170, desktopInlineKeys: ['preview', 'download'], actions: nodeActions })];
      case 'recent':
        return [nameColumn, spaceColumn, sizeColumn,
          { title: '最近操作', dataIndex: 'lastAction', width: 110, render: (v: DriveRecentItem['lastAction']) => DRIVE_ACTIVITY_ACTION_LABELS[v] },
          dateTimeColumn('访问时间', 'lastAccessAt'),
          createOperationColumn<AnyNode>({ width: 170, desktopInlineKeys: ['preview', 'download'], actions: nodeActions })];
      case 'recycle':
        return [nameColumn, spaceColumn, sizeColumn,
          { title: '删除人', dataIndex: 'deletedByName', width: 110, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
          dateTimeColumn('删除时间', 'deletedAt'),
          createOperationColumn<AnyNode>({ width: 180, actions: nodeActions })];
      default:
        return [nameColumn, spaceColumn, sizeColumn,
          { title: '修改人', dataIndex: 'updatedByName', width: 110, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
          dateTimeColumn('修改时间', 'updatedAt'),
          createOperationColumn<AnyNode>({ width: 170, desktopInlineKeys: ['preview', 'download'], actions: nodeActions })];
    }
  })();

  const linkColumns: ColumnProps<DriveShareLink>[] = [
    { title: '文件', dataIndex: 'nodeName', minWidth: 220, ellipsis: { showTitle: false },
      render: (_: unknown, l: DriveShareLink) => <FileNameCell name={l.nodeName} mimeType={l.nodeType === 'folder' ? 'inode/directory' : null} onClick={() => onOpenDetail(l.nodeId)} /> },
    { title: '状态', dataIndex: 'state', width: 90, render: (v: DriveShareLink['state']) => shareLinkStateTag(v) },
    { title: '权限', dataIndex: 'permission', width: 90, render: (v: DriveShareLink['permission']) => DRIVE_SHARE_PERMISSION_LABELS[v] },
    { title: '密码', dataIndex: 'hasPassword', width: 70, render: (v: boolean) => (v ? <Tag size="small" color="orange">有</Tag> : '无') },
    { title: '访问 / 下载', width: 110, render: (_: unknown, l: DriveShareLink) => `${l.accessCount}${l.maxAccessCount ? `/${l.maxAccessCount}` : ''} · ${l.downloadCount}` },
    dateTimeColumn('过期时间', 'expireAt'),
    dateTimeColumn('创建时间', 'createdAt'),
    createOperationColumn<DriveShareLink>({ width: 170, desktopInlineKeys: ['copy'], actions: (l) => [
      { key: 'copy', label: '复制链接', disabled: l.state !== 'active', onClick: () => void copyTextWithToast(`${globalThis.location.origin}${l.url}`, { success: '链接已复制' }) },
      { key: 'node', label: '查看文件', onClick: () => onOpenDetail(l.nodeId) },
      { key: 'revoke', label: '撤销', hidden: l.state === 'revoked', onClick: () => { confirmDanger({ title: '撤销这条外链？', content: '撤销后链接立即失效。', okText: '撤销',
        onOk: () => revoke.mutateAsync({ id: l.id, nodeId: l.nodeId }).then(() => Toast.success('已撤销')) }); } },
      { key: 'delete', label: '删除记录', danger: true, hidden: l.state !== 'revoked' && l.state !== 'expired',
        onClick: async () => { await removeLink.mutateAsync({ id: l.id, nodeId: l.nodeId }); Toast.success('已删除'); } },
    ] }),
  ];

  const spaceOptions = (spacesQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }));

  const recycleBatch = view === 'recycle' && selectedIds.length > 0 && (
    <Space>
      <Button size="small" icon={<RotateCcw size={14} />} onClick={() => restore.mutateAsync({ body: { ids: selectedIds } }).then(() => { Toast.success('已还原'); setSelectedIds([]); })}>还原所选</Button>
      {hasPermission('drive:recycle:purge') && (
        <Button size="small" type="danger" icon={<Trash2 size={14} />} onClick={() => confirmDanger({
          title: `彻底删除选中的 ${selectedIds.length} 项？`, content: '永久删除且不可恢复。', okText: '彻底删除',
          onOk: () => purge.mutateAsync({ ids: selectedIds }).then(() => { Toast.success('已彻底删除'); setSelectedIds([]); }),
        })}>彻底删除所选</Button>
      )}
    </Space>
  );

  return (
    <div className="drive-views">
      <div className="drive-views__header">
        <Typography.Title heading={5} style={{ margin: 0 }}>{VIEW_TITLES[view]}</Typography.Title>
        {view === 'recycle' && hasPermission('drive:recycle:purge') && total > 0 && (
          <Button size="small" type="danger" theme="borderless" onClick={() => confirmDanger({
            title: '清空回收站？', content: submittedParams.spaceId ? '将永久删除该空间回收站中的全部项目。' : '将永久删除你可管理的全部回收站项目。', okText: '清空',
            onOk: () => purge.mutateAsync({ ids: [], spaceId: submittedParams.spaceId }).then(() => Toast.success('回收站已清空')),
          })}>清空回收站</Button>
        )}
      </div>
      <SearchToolbar
        filters={(
          <>
            <KeywordInput value={draftParams.keyword} width={200} placeholder={view === 'links' ? '搜索文件名 / 备注' : '搜索名称'}
              onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
            {view === 'recycle' && (
              <FilterSelect<number> value={draftParams.spaceId} placeholder="全部空间" width={160} items={spaceOptions}
                onChange={(v) => setDraftParams((p) => ({ ...p, spaceId: v }))} />
            )}
          </>
        )}
        actions={(<>{recycleBatch}<SearchButton onClick={handleSearch} /><ResetButton onClick={handleReset} /></>)}
      />
      {view === 'links' ? (
        <ConfigurableTable<DriveShareLink> bordered size="small" rowKey="id" columns={linkColumns} dataSource={rows as DriveShareLink[]}
          loading={active.isFetching} onRefresh={() => void active.refetch()} refreshLoading={active.isFetching}
          pagination={buildPagination(total)} empty={<Empty description={VIEW_EMPTY[view]} />} />
      ) : (
        <ConfigurableTable<AnyNode> bordered size="small" rowKey="id" columns={nodeColumns} dataSource={rows as AnyNode[]}
          loading={active.isFetching} onRefresh={() => void active.refetch()} refreshLoading={active.isFetching}
          pagination={buildPagination(total)} empty={<Empty description={VIEW_EMPTY[view]} />}
          rowSelection={view === 'recycle' ? { selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds((keys ?? []).map(Number)) } : undefined}
          onRow={(record) => ({ onDoubleClick: () => { if (record) openNode(record); } })} />
      )}
      <FilePreviewLayer preview={preview} />
    </div>
  );
}

/** 全局搜索结果视图（工作台顶部搜索框触发） */
export function DriveSearchView({ keyword, fullText, onOpenFolder, onOpenDetail, onClear }: {
  readonly keyword: string; readonly fullText: boolean;
  readonly onOpenFolder: (spaceId: number, folderId: number | null) => void;
  readonly onOpenDetail: (nodeId: number) => void;
  readonly onClear: () => void;
}) {
  const { hasPermission } = usePermission();
  const [page, setPage] = useState(1);
  const query = useDriveSearch({ keyword, fullText, page, pageSize: 20 });
  const list = query.data?.list ?? [];
  const preview = useFilePreview(() => list.filter((n) => n.type === 'file' && n.url).map(nodeToManagedFile));
  const openNode = (node: DriveSearchItem) => {
    if (node.type === 'folder') { onOpenFolder(node.spaceId, node.id); return; }
    if (canPreviewFile(node.mimeType, node.name) && node.url) void preview.handlePreview(nodeToManagedFile(node));
    else onOpenDetail(node.id);
  };
  const columns: ColumnProps<DriveSearchItem>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 240, ellipsis: { showTitle: false },
      render: (_: unknown, n: DriveSearchItem) => (
        <div>
          <FileNameCell name={n.name} mimeType={n.type === 'folder' ? 'inode/directory' : n.mimeType} onClick={() => openNode(n)} />
          {n.snippet && <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ display: 'block', paddingLeft: 24 }}>{n.snippet}</Typography.Text>}
        </div>
      ) },
    { title: '所在空间', dataIndex: 'spaceName', width: 140 },
    { title: '大小', dataIndex: 'size', width: 100, render: (v: number, n: DriveSearchItem) => (n.type === 'folder' ? EMPTY_PLACEHOLDER : formatBytes(v)) },
    dateTimeColumn('修改时间', 'updatedAt'),
    createOperationColumn<DriveSearchItem>({ width: 170, desktopInlineKeys: ['preview', 'download'], actions: (n) => [
      ...(n.type === 'file' && canPreviewFile(n.mimeType, n.name) ? [{ key: 'preview', label: '预览', onClick: () => openNode(n) }] : []),
      ...(n.type === 'file' && hasPermission('drive:node:download') && roleAtLeast(n.myRole, 'downloader')
        ? [{ key: 'download', label: '下载', onClick: async () => downloadBlob(await fetchManagedFileBlob(nodeDownloadUrl(n)), n.name) }] : []),
      { key: 'locate', label: '打开所在目录', onClick: () => onOpenFolder(n.spaceId, n.parentId) },
      { key: 'detail', label: '详情', onClick: () => onOpenDetail(n.id) },
    ] }),
  ];
  return (
    <div className="drive-views">
      <div className="drive-views__header">
        <Typography.Title heading={5} style={{ margin: 0 }}>搜索「{keyword}」{fullText ? '（含正文）' : ''}</Typography.Title>
        <Button size="small" theme="borderless" onClick={onClear}>返回</Button>
      </div>
      <ConfigurableTable<DriveSearchItem> bordered size="small" rowKey="id" columns={columns} dataSource={list}
        loading={query.isFetching} onRefresh={() => void query.refetch()} refreshLoading={query.isFetching}
        pagination={{ currentPage: page, pageSize: 20, total: query.data?.total ?? 0, onPageChange: setPage }}
        empty={<Empty description="没有找到匹配的文件" />} />
      <FilePreviewLayer preview={preview} />
    </div>
  );
}
