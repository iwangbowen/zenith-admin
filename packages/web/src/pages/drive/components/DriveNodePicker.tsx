import { useEffect, useMemo, useState } from 'react';
import { Breadcrumb, Empty, List, Select, Spin, Typography } from '@douyinfe/semi-ui';
import { ChevronRight } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import { DRIVE_SPACE_TYPE_LABELS, type DriveNode } from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import { getFileTypeIcon } from '@/utils/file-utils';
import { useDriveDir, useMyDriveSpaces } from '@/hooks/queries/drive';
import { driveNodeUrl } from '../drive-utils';

export interface DriveNodePick {
  node: DriveNode;
  spaceName: string;
  /** 站内链接：文件夹落到目录，文件落到详情抽屉 */
  url: string;
}

interface DriveNodePickerProps {
  readonly visible: boolean;
  readonly title?: string;
  readonly okText?: string;
  /** 允许选择的节点类型；缺省只选文件 */
  readonly allowFolders?: boolean;
  readonly onCancel: () => void;
  readonly onOk: (pick: DriveNodePick) => void;
}

/**
 * 网盘节点选择器（供 Wiki 插入链接等站内互通场景）：空间下拉 + 目录逐级浏览，
 * 只返回节点元数据与站内链接，不复制对象；被引用方仍按网盘 ACL 判定可见性。
 */
export function DriveNodePicker({ visible, title = '选择网盘文件', okText = '插入链接', allowFolders = false, onCancel, onOk }: DriveNodePickerProps) {
  const spacesQuery = useMyDriveSpaces();
  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const [spaceId, setSpaceId] = useState<number | undefined>();
  const [parentId, setParentId] = useState<number | null>(null);
  const [selected, setSelected] = useState<DriveNode | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSpaceId((current) => current ?? spaces[0]?.id);
    setParentId(null);
    setSelected(null);
  }, [visible, spaces]);

  const dir = useDriveDir({ spaceId, parentId, page: 1, pageSize: 200, sortBy: 'name', order: 'asc' }, visible && spaceId !== undefined);
  const space = spaces.find((s) => s.id === spaceId);
  const rows = dir.data?.list ?? [];

  const choose = (node: DriveNode) => {
    if (node.type === 'folder' && !allowFolders) { setParentId(node.id); setSelected(null); return; }
    setSelected((current) => (current?.id === node.id ? null : node));
  };

  return (
    <AppModal visible={visible} title={title} width={640} closeOnEsc onCancel={onCancel} okText={okText}
      okButtonProps={{ disabled: !selected }}
      onOk={() => { if (selected && space) onOk({ node: selected, spaceName: space.name, url: driveNodeUrl(selected) }); }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Select value={spaceId} style={{ width: '100%' }} placeholder="选择空间" loading={spacesQuery.isPending}
          optionList={spaces.map((s) => ({ value: s.id, label: `${s.name}（${DRIVE_SPACE_TYPE_LABELS[s.type]}）` }))}
          onChange={(v) => { setSpaceId(v as number); setParentId(null); setSelected(null); }} />
        <Breadcrumb compact={false} separator={<ChevronRight size={12} />}>
          <Breadcrumb.Item onClick={() => { setParentId(null); setSelected(null); }}>{space?.name ?? '根目录'}</Breadcrumb.Item>
          {(dir.data?.breadcrumbs ?? []).map((b) => (
            <Breadcrumb.Item key={b.id} onClick={() => { setParentId(b.id); setSelected(null); }}>{b.name}</Breadcrumb.Item>
          ))}
        </Breadcrumb>
        <Spin spinning={dir.isFetching}>
          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
            {rows.length === 0 && !dir.isFetching
              ? <Empty description="该目录为空" style={{ padding: '24px 0' }} />
              : (
                <List size="small" dataSource={rows} renderItem={(node: DriveNode) => {
                  const active = selected?.id === node.id;
                  return (
                    <List.Item key={node.id} onClick={() => choose(node)}
                      style={{ padding: '8px 12px', cursor: 'pointer', background: active ? 'var(--semi-color-primary-light-default)' : undefined }}
                      header={<span style={{ display: 'inline-flex' }}>{getFileTypeIcon(node.type === 'folder' ? 'inode/directory' : node.mimeType, 18, node.type === 'folder' ? undefined : node.name)}</span>}
                      main={(
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
                          <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1 }}>{node.name}</Typography.Text>
                          {node.type === 'folder'
                            ? <Typography.Text link size="small" style={{ flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); setParentId(node.id); setSelected(null); }}>进入</Typography.Text>
                            : <Typography.Text type="tertiary" size="small" style={{ flexShrink: 0 }}>{formatBytes(node.size)}</Typography.Text>}
                        </div>
                      )} />
                  );
                }} />
              )}
          </div>
        </Spin>
        <Typography.Text type="tertiary" size="small">
          {selected ? `已选择：${selected.name}` : allowFolders ? '单击选择文件或文件夹，点「进入」浏览子目录' : '单击文件夹进入，单击文件选择'}
        </Typography.Text>
      </div>
    </AppModal>
  );
}
