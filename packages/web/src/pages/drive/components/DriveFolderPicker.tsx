import { useCallback, useEffect, useMemo, useState } from 'react';
import { Select, Tree, Typography } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Folder, HardDrive } from 'lucide-react';
import { DRIVE_SPACE_TYPE_LABELS, driveNodeContract, type DriveSpace } from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import { api } from '@/lib/contract-query';
import { useMyDriveSpaces } from '@/hooks/queries/drive';
import { roleAtLeast } from '../drive-utils';

export interface FolderTarget {
  spaceId: number;
  parentId: number | null;
  label: string;
}

interface DriveFolderPickerProps {
  readonly visible: boolean;
  readonly title: string;
  readonly okText?: string;
  /** 初始展开的空间 */
  readonly defaultSpaceId?: number;
  /** 不可选中的节点（如正被移动的文件夹自身及其子树） */
  readonly disabledNodeIds?: readonly number[];
  readonly loading?: boolean;
  /** 只允许当前用户至少 editor 的空间 */
  readonly writableOnly?: boolean;
  readonly onCancel: () => void;
  readonly onOk: (target: FolderTarget) => void;
}

const ROOT_KEY = 'root';

/** 目标目录选择：空间下拉 + 懒加载的文件夹树（只加载文件夹） */
export function DriveFolderPicker({ visible, title, okText = '确定', defaultSpaceId, disabledNodeIds = [], loading, writableOnly = true, onCancel, onOk }: DriveFolderPickerProps) {
  const spacesQuery = useMyDriveSpaces();
  const spaces = useMemo(
    () => (spacesQuery.data ?? []).filter((s) => !writableOnly || roleAtLeast(s.myRole, 'editor')),
    [spacesQuery.data, writableOnly],
  );
  const [spaceId, setSpaceId] = useState<number | undefined>(defaultSpaceId);
  const [treeData, setTreeData] = useState<TreeNodeData[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(ROOT_KEY);
  const [labelPath, setLabelPath] = useState<string>('');

  useEffect(() => {
    if (!visible) return;
    const initial = defaultSpaceId && spaces.some((s) => s.id === defaultSpaceId) ? defaultSpaceId : spaces[0]?.id;
    setSpaceId(initial);
    setSelectedKey(ROOT_KEY);
  }, [visible, defaultSpaceId, spaces]);

  const space: DriveSpace | undefined = spaces.find((s) => s.id === spaceId);

  const loadChildren = useCallback(async (parentId: number | null): Promise<TreeNodeData[]> => {
    if (!spaceId) return [];
    const res = await api(driveNodeContract.list, {
      query: { spaceId: parentId ? undefined : spaceId, parentId: parentId ?? undefined, type: 'folder', pageSize: 200, sortBy: 'name' },
    });
    return res.list.map((n) => ({
      key: String(n.id),
      label: n.name,
      value: n.id,
      icon: <Folder size={14} style={{ marginRight: 6, color: 'var(--semi-color-warning)' }} />,
      disabled: disabledNodeIds.includes(n.id) || n.ancestorIds.some((id) => disabledNodeIds.includes(id)),
      isLeaf: false,
    }));
  }, [disabledNodeIds, spaceId]);

  useEffect(() => {
    if (!visible || !spaceId) { setTreeData([]); return; }
    let cancelled = false;
    setTreeData([]);
    loadChildren(null).then((children) => {
      if (cancelled) return;
      setTreeData([{
        key: ROOT_KEY,
        label: space?.name ?? '根目录',
        value: 0,
        icon: <HardDrive size={14} style={{ marginRight: 6, color: 'var(--semi-color-primary)' }} />,
        children,
        isLeaf: false,
      }]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [visible, spaceId, loadChildren, space?.name]);

  const onLoad = async (node?: TreeNodeData) => {
    if (!node || node.key === ROOT_KEY) return;
    const children = await loadChildren(Number(node.value));
    setTreeData((prev) => patchChildren(prev, String(node.key), children));
  };

  const handleOk = () => {
    if (!spaceId) return;
    const parentId = selectedKey === ROOT_KEY ? null : Number(selectedKey);
    onOk({ spaceId, parentId, label: labelPath || space?.name || '' });
  };

  return (
    <AppModal visible={visible} title={title} okText={okText} onCancel={onCancel} onOk={handleOk} width={520}
      okButtonProps={{ disabled: !spaceId, loading }} closeOnEsc>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Select style={{ width: '100%' }} value={spaceId} placeholder="选择目标空间" loading={spacesQuery.isPending}
          onChange={(v) => { setSpaceId(v as number); setSelectedKey(ROOT_KEY); setLabelPath(''); }}
          optionList={spaces.map((s) => ({ value: s.id, label: `${s.name}（${DRIVE_SPACE_TYPE_LABELS[s.type]}）` }))} />
        <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', maxHeight: 320, overflow: 'auto', minHeight: 160 }}>
          <Tree
            treeData={treeData}
            loadData={onLoad}
            value={selectedKey}
            defaultExpandedKeys={[ROOT_KEY]}
            onSelect={(key, _selected, node) => {
              setSelectedKey(String(key));
              setLabelPath(String((node as TreeNodeData | undefined)?.label ?? ''));
            }}
            emptyContent={<Typography.Text type="tertiary">加载中…</Typography.Text>}
          />
        </div>
        <Typography.Text type="tertiary" size="small">
          目标：{space?.name ?? '—'}{selectedKey !== ROOT_KEY && labelPath ? ` / ${labelPath}` : ' / 根目录'}
        </Typography.Text>
      </div>
    </AppModal>
  );
}

function patchChildren(nodes: TreeNodeData[], key: string, children: TreeNodeData[]): TreeNodeData[] {
  return nodes.map((n) => {
    if (String(n.key) === key) return { ...n, children, isLeaf: children.length === 0 };
    if (n.children) return { ...n, children: patchChildren(n.children, key, children) };
    return n;
  });
}
