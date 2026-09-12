import { useMemo, useState } from 'react';
import { Button, Descriptions, Input, Select, SideSheet, Space, Spin, Tabs, TabPane, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { Download, Lock, LockOpen, MessageSquareShare, Scale, Star, StarOff } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import { DRIVE_NODE_TYPE_LABELS, DRIVE_ROLE_LABELS, type DriveNode, type DriveNodeDetail } from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import { useConversations } from '@/hooks/queries/chat';
import { useCreateDriveLegalHold, useCreateDriveTag, useDriveNode, useDriveTags, useLockDriveNode, useSendDriveNodeToChat, useSetDriveNodeTags, useStarDriveNode, useUnlockDriveNode, useUnstarDriveNode } from '@/hooks/queries/drive';
import { ForwardModal } from '@/pages/chat/components/ForwardModal';
import { usePermission } from '@/hooks/usePermission';
import { getFileTypeIcon } from '@/utils/file-utils';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { DrivePermissionPanel } from './DrivePermissionPanel';
import { DriveVersionsPanel } from './DriveVersionsPanel';
import { DriveShareLinksPanel } from './DriveShareLinksPanel';
import { DriveActivityPanel, DriveCommentsPanel } from './DriveActivityPanels';
import { DriveAccessGate, DrivePresenceBadge } from './DriveAccessPanels';
import { roleAtLeast } from '../drive-utils';
import { DriveProfilePanel, DriveSubscriptionButton } from './DriveCollaborationPanels';

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

/** 网盘管理员：对当前节点（含子树）设置法律保留 */
function LegalHoldButton({ node }: { readonly node: DriveNodeDetail }) {
  const { hasPermission } = usePermission();
  const create = useCreateDriveLegalHold();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState('');
  if (!hasPermission('drive:admin:legal-hold:edit') || node.legalHold) return null;
  return (
    <>
      <Button size="small" icon={<Scale size={14} />} onClick={() => setVisible(true)}>法律保留</Button>
      <AppModal visible={visible} title={`对「${node.name}」设置法律保留`} width={480} closeOnEsc onCancel={() => setVisible(false)} okText="设置保留"
        okButtonProps={{ loading: create.isPending, disabled: !reason.trim() }}
        onOk={async () => {
          await create.mutateAsync({ body: { nodeId: node.id, reason: reason.trim() } });
          Toast.success('已设置法律保留');
          setVisible(false);
          setReason('');
        }}>
        <Typography.Paragraph type="tertiary" size="small">
          保留期间{node.type === 'folder' ? '该文件夹及其全部子项' : '该文件'}不可删除、彻底删除、删除历史版本或跨空间移动，也不参与回收站到期清理与版本修剪；可在「合规治理」中解除。
        </Typography.Paragraph>
        <Input value={reason} onChange={setReason} placeholder="保留原因（必填，如案件 / 审计编号）" maxLength={500} showClear />
      </AppModal>
    </>
  );
}

/** 把节点以卡片消息发到聊天：复用聊天的会话选择弹窗，收件人仍按网盘 ACL 访问 */
function SendToChatButton({ node }: { readonly node: DriveNodeDetail }) {
  const [visible, setVisible] = useState(false);
  const send = useSendDriveNodeToChat();
  // 复用壳层共享的会话列表缓存，只在弹窗打开时观察
  const conversations = useConversations(visible);
  return (
    <>
      <Button size="small" icon={<MessageSquareShare size={14} />} onClick={() => setVisible(true)}>发送到聊天</Button>
      <ForwardModal visible={visible} mode="individual" conversations={conversations.data ?? []} currentConvId={null}
        title={`发送到聊天 · ${node.name}`} hint="以卡片消息发送链接；对方需拥有该文件的访问权限，无权时可在卡片中发起访问申请" okText="发送"
        onCancel={() => setVisible(false)}
        onConfirm={(targetIds) => {
          send.mutate({ params: { id: node.id }, body: { conversationIds: targetIds } }, {
            onSuccess: (result) => { Toast.success(`已发送到 ${result.sent} 个会话`); setVisible(false); },
          });
        }} />
    </>
  );
}

export function DriveNodeDrawer({ nodeId, allowExternalShare, onClose, onDownload }: DriveNodeDrawerProps) {
  const { hasPermission } = usePermission();
  const query = useDriveNode(nodeId ?? undefined);
  const star = useStarDriveNode();
  const unstar = useUnstarDriveNode();
  const lock = useLockDriveNode();
  const unlock = useUnlockDriveNode();
  const [tab, setTab] = useState('detail');
  const node = query.data;

  const toggleStar = () => {
    if (!node) return;
    (node.isStarred ? unstar : star).mutate({ params: { id: node.id }, node }, { onSuccess: () => Toast.success(node.isStarred ? '已取消收藏' : '已收藏') });
  };
  const toggleLock = () => {
    if (!node) return;
    if (node.lockedBy) unlock.mutate({ params: { id: node.id } }, { onSuccess: () => Toast.success('已解锁') });
    else lock.mutate({ params: { id: node.id }, body: {} }, { onSuccess: () => Toast.success('已锁定') });
  };

  const title = node ? (
    <div className="drive-drawer__title">
      <span className="drive-drawer__title-icon">{getFileTypeIcon(node.type === 'folder' ? 'inode/directory' : node.mimeType, 18, node.type === 'folder' ? undefined : node.name)}</span>
      <Typography.Text ellipsis={{ showTooltip: true }} strong>{node.name}</Typography.Text>
    </div>
  ) : '详情';

  return (
    <SideSheet visible={nodeId !== null} onCancel={onClose} title={title} width={760} closeOnEsc footer={null} className="drive-node-drawer" bodyStyle={{ padding: '0 16px 16px' }}>
      <Spin spinning={query.isPending}>
        {query.isError && nodeId !== null && <DriveAccessGate nodeId={nodeId} error={query.error} onRetry={() => void query.refetch()} />}
        {node && (
          <>
            <div className="drive-drawer__actions">
              <DriveSubscriptionButton nodeId={node.id} />
              <Button size="small" icon={node.isStarred ? <StarOff size={14} /> : <Star size={14} />} onClick={toggleStar} loading={star.isPending || unstar.isPending}>
                {node.isStarred ? '取消收藏' : '收藏'}
              </Button>
              {node.type === 'file' && hasPermission('drive:node:download') && roleAtLeast(node.myRole, 'downloader') && (
                <Button size="small" icon={<Download size={14} />} onClick={() => onDownload(node)}>下载</Button>
              )}
              {node.type === 'file' && hasPermission('drive:node:edit') && roleAtLeast(node.myRole, 'editor') && !node.spaceArchived && (
                <Button size="small" icon={node.lockedBy ? <LockOpen size={14} /> : <Lock size={14} />} onClick={toggleLock} loading={lock.isPending || unlock.isPending}>
                  {node.lockedBy ? '解除锁定' : '签出锁定'}
                </Button>
              )}
              <LegalHoldButton node={node} />
              <SendToChatButton node={node} />
              <DrivePresenceBadge nodeId={node.id} />
            </div>
            {(node.legalHold || node.spaceArchived) && (
              <Space wrap style={{ marginBottom: 8 }}>
                {node.legalHold && <Tag color="red" size="small" prefixIcon={<Scale size={12} />}>法律保留中：不可删除 / 删版本 / 跨空间移动</Tag>}
                {node.spaceArchived && <Tag color="grey" size="small">所在空间已归档：只读</Tag>}
              </Space>
            )}
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
              <TabPane tab="说明与属性" itemKey="profile"><DriveProfilePanel node={node} /></TabPane>
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
