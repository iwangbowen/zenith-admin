import { useMemo, useState } from 'react';
import { Button, Descriptions, Select, SideSheet, Space, Spin, Tabs, TabPane, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { Download, Lock, LockOpen, Star, StarOff } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import { DRIVE_NODE_TYPE_LABELS, DRIVE_ROLE_LABELS, type DriveNode, type DriveNodeDetail } from '@zenith/shared/drive';
import { useCreateDriveTag, useDriveNode, useDriveTags, useLockDriveNode, useSetDriveNodeTags, useStarDriveNode } from '@/hooks/queries/drive';
import { usePermission } from '@/hooks/usePermission';
import { getFileTypeIcon } from '@/utils/file-utils';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { DrivePermissionPanel } from './DrivePermissionPanel';
import { DriveVersionsPanel } from './DriveVersionsPanel';
import { DriveShareLinksPanel } from './DriveShareLinksPanel';
import { DriveActivityPanel, DriveCommentsPanel } from './DriveActivityPanels';
import { roleAtLeast } from '../drive-utils';

interface DriveNodeDrawerProps {
  readonly nodeId: number | null;
  readonly allowExternalShare: boolean;
  readonly onClose: () => void;
  readonly onDownload: (node: DriveNode) => void;
}

/** 节点标签编辑：空间标签多选 + 即时创建 */
function TagsEditor({ node }: { readonly node: DriveNodeDetail }) {
  const { hasPermission } = usePermission();
  const tagsQuery = useDriveTags(node.spaceId);
  const setTags = useSetDriveNodeTags();
  const createTag = useCreateDriveTag();
  const canEdit = hasPermission('drive:node:edit') && roleAtLeast(node.myRole, 'editor');
  const value = useMemo(() => (node.tags ?? []).map((t) => t.id), [node.tags]);
  if (!canEdit) {
    return node.tags?.length ? <Space wrap>{node.tags.map((t) => <Tag key={t.id} color="blue" size="small">{t.name}</Tag>)}</Space> : <span>{EMPTY_PLACEHOLDER}</span>;
  }
  return (
    <Select
      multiple filter allowCreate size="small" style={{ width: '100%' }} placeholder="选择或输入新标签"
      value={value}
      loading={tagsQuery.isPending}
      optionList={(tagsQuery.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
      onChange={async (v) => {
        const raw = (v as Array<number | string>) ?? [];
        const ids: number[] = [];
        for (const item of raw) {
          if (typeof item === 'number') { ids.push(item); continue; }
          const created = await createTag.mutateAsync({ body: { spaceId: node.spaceId, name: String(item).trim().slice(0, 50) } });
          ids.push(created.id);
        }
        await setTags.mutateAsync({ params: { id: node.id }, body: { tagIds: ids } });
      }}
    />
  );
}

export function DriveNodeDrawer({ nodeId, allowExternalShare, onClose, onDownload }: DriveNodeDrawerProps) {
  const { hasPermission } = usePermission();
  const query = useDriveNode(nodeId ?? undefined);
  const star = useStarDriveNode();
  const lock = useLockDriveNode();
  const [tab, setTab] = useState('detail');
  const node = query.data;

  const toggleStar = () => {
    if (!node) return;
    star.mutate({ node, starred: !node.isStarred }, { onSuccess: () => Toast.success(node.isStarred ? '已取消收藏' : '已收藏') });
  };
  const toggleLock = () => {
    if (!node) return;
    lock.mutate({ id: node.id, lock: !node.lockedBy }, { onSuccess: () => Toast.success(node.lockedBy ? '已解锁' : '已锁定') });
  };

  const title = node ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {getFileTypeIcon(node.type === 'folder' ? 'inode/directory' : node.mimeType, 18, node.type === 'folder' ? undefined : node.name)}
      <Typography.Text ellipsis={{ showTooltip: true }} strong style={{ minWidth: 0 }}>{node.name}</Typography.Text>
    </div>
  ) : '详情';

  return (
    <SideSheet visible={nodeId !== null} onCancel={onClose} title={title} width={640} closeOnEsc footer={null} bodyStyle={{ padding: '0 16px 16px' }}>
      <Spin spinning={query.isPending}>
        {node && (
          <>
            <div className="drive-drawer__actions">
              <Button size="small" icon={node.isStarred ? <StarOff size={14} /> : <Star size={14} />} onClick={toggleStar} loading={star.isPending}>
                {node.isStarred ? '取消收藏' : '收藏'}
              </Button>
              {node.type === 'file' && hasPermission('drive:node:download') && roleAtLeast(node.myRole, 'downloader') && (
                <Button size="small" icon={<Download size={14} />} onClick={() => onDownload(node)}>下载</Button>
              )}
              {node.type === 'file' && hasPermission('drive:node:edit') && roleAtLeast(node.myRole, 'editor') && (
                <Button size="small" icon={node.lockedBy ? <LockOpen size={14} /> : <Lock size={14} />} onClick={toggleLock} loading={lock.isPending}>
                  {node.lockedBy ? '解除锁定' : '签出锁定'}
                </Button>
              )}
            </div>
            <Tabs collapsible="auto" activeKey={tab} onChange={setTab} type="line" size="small" lazyRender keepDOM={false}>
              <TabPane tab="详情" itemKey="detail">
                <Descriptions align="left" size="small" className="drive-drawer__desc">
                  <Descriptions.Item itemKey="类型">{DRIVE_NODE_TYPE_LABELS[node.type]}{node.extension ? ` · ${node.extension.toUpperCase()}` : ''}</Descriptions.Item>
                  <Descriptions.Item itemKey="位置">{[node.spaceName, ...node.breadcrumbs.map((b) => b.name)].join(' / ')}</Descriptions.Item>
                  {node.type === 'file' && <Descriptions.Item itemKey="大小">{formatBytes(node.size)}</Descriptions.Item>}
                  {node.type === 'folder' && <Descriptions.Item itemKey="子项">{node.childCount} 项</Descriptions.Item>}
                  {node.type === 'file' && <Descriptions.Item itemKey="版本">v{node.currentVersion}（共 {node.versionCount} 个）</Descriptions.Item>}
                  <Descriptions.Item itemKey="我的角色">{node.myRole ? DRIVE_ROLE_LABELS[node.myRole] : EMPTY_PLACEHOLDER}</Descriptions.Item>
                  <Descriptions.Item itemKey="创建">{node.createdByName ?? EMPTY_PLACEHOLDER} · {node.createdAt}</Descriptions.Item>
                  <Descriptions.Item itemKey="更新">{node.updatedByName ?? EMPTY_PLACEHOLDER} · {node.updatedAt}</Descriptions.Item>
                  {node.lockedBy && <Descriptions.Item itemKey="锁定">{node.lockedByName ?? '—'} 签出中，至 {node.lockExpiresAt ?? '手动解除'}</Descriptions.Item>}
                  {node.contentHash && <Descriptions.Item itemKey="SHA-256"><Typography.Text code copyable size="small">{node.contentHash.slice(0, 16)}…</Typography.Text></Descriptions.Item>}
                  <Descriptions.Item itemKey="标签"><TagsEditor node={node} /></Descriptions.Item>
                </Descriptions>
              </TabPane>
              <TabPane tab="权限" itemKey="permissions"><DrivePermissionPanel node={node} /></TabPane>
              {node.type === 'file' && <TabPane tab="版本" itemKey="versions"><DriveVersionsPanel node={node} /></TabPane>}
              <TabPane tab="外链" itemKey="links"><DriveShareLinksPanel node={node} allowExternalShare={allowExternalShare} /></TabPane>
              <TabPane tab="动态" itemKey="activities"><DriveActivityPanel node={node} /></TabPane>
              <TabPane tab="评论" itemKey="comments"><DriveCommentsPanel node={node} /></TabPane>
            </Tabs>
          </>
        )}
      </Spin>
    </SideSheet>
  );
}
