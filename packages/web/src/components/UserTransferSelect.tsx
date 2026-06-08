import { useCallback, useMemo, useState } from 'react';
import { Checkbox, Radio, RadioGroup, Transfer } from '@douyinfe/semi-ui';
import { X } from 'lucide-react';
import type { Department } from '@zenith/shared';
import { UserAvatar } from './UserAvatar';

export interface UserTransferUser {
  id: number;
  username: string;
  nickname: string;
  avatar?: string | null;
  departmentId?: number | null;
  departmentName?: string | null;
}

interface UserTransferSelectProps {
  dataSource: UserTransferUser[];
  value: number[];
  onChange: (ids: number[]) => void;
  /** 传入扁平部门列表可在树形模式中呈现真实多级层级，不传则按 departmentName 平铺分组 */
  departments?: Department[];
}

interface TransferDataItem {
  key: string;
  value: number;
  label: string;
  disabled: boolean;
  _username: string;
  _avatar?: string | null;
  _departmentName?: string | null;
  _departmentId?: number | null;
}

interface DeptTreeNode {
  key: string;
  value: string;
  label: string;
  disabled: true; // 部门节点不可选，只作为分组导航
  children: Array<DeptTreeNode | TransferDataItem>;
}

type SourceItem = TransferDataItem & {
  onChange: (value: string | number) => void;
  checked: boolean;
};

type SelectedItem = TransferDataItem & {
  onRemove: () => void;
};

type ViewMode = 'flat' | 'tree';

function buildHierarchicalTree(
  departments: Department[],
  users: TransferDataItem[],
): Array<DeptTreeNode | TransferDataItem> {
  const deptMap = new Map(departments.map((d) => [d.id, d]));
  const childDeptIds = new Map<number, number[]>();
  const rootDeptIds: number[] = [];

    departments.forEach((d) => {
    const parent = d.parentId && deptMap.has(d.parentId) ? d.parentId : 0;
    if (parent) {
      if (!childDeptIds.has(parent)) childDeptIds.set(parent, []);
      const list = childDeptIds.get(parent);
      if (list) list.push(d.id);
    } else {
      rootDeptIds.push(d.id);
    }
  });

  const usersByDept = new Map<number | null, TransferDataItem[]>();
  const assignedUserIds = new Set<number>();
  users.forEach((u) => {
    const deptId = u._departmentId ?? null;
    if (deptId !== null && deptMap.has(deptId)) {
      if (!usersByDept.has(deptId)) usersByDept.set(deptId, []);
      const list = usersByDept.get(deptId);
      if (list) list.push(u);
      assignedUserIds.add(u.value);
    }
  });

  function buildDeptNode(deptId: number): DeptTreeNode | null {
    const dept = deptMap.get(deptId);
    if (!dept) return null;
    const childDepts = (childDeptIds.get(deptId) ?? [])
      .map(buildDeptNode)
      .filter((n): n is DeptTreeNode => n !== null);
    const deptUsers = usersByDept.get(deptId) ?? [];
    const children: Array<DeptTreeNode | TransferDataItem> = [...childDepts, ...deptUsers];
    return { key: `dept-${deptId}`, value: `dept-${deptId}`, label: dept.name, disabled: true as const, children };
  }

  const result: Array<DeptTreeNode | TransferDataItem> = [];
  rootDeptIds.forEach((id) => {
    const node = buildDeptNode(id);
    if (node) result.push(node);
  });

  // Users with no matched department
  const noDeptUsers = users.filter((u) => !assignedUserIds.has(u.value));
  if (noDeptUsers.length > 0) {
result.push({ key: 'dept-none', value: 'dept-none', label: '无部门', disabled: true as const, children: noDeptUsers });
  }

  return result;
}

function buildFlatTree(users: TransferDataItem[]): DeptTreeNode[] {
  const deptMap = new Map<string, TransferDataItem[]>();
  const noDept: TransferDataItem[] = [];
  users.forEach((item) => {
    if (item._departmentName) {
      if (!deptMap.has(item._departmentName)) deptMap.set(item._departmentName, []);
      const list = deptMap.get(item._departmentName);
      if (list) list.push(item);
    } else {
      noDept.push(item);
    }
  });
  const result: DeptTreeNode[] = [];
  deptMap.forEach((u, name) => {
    result.push({ key: `dept-${name}`, value: `dept-${name}`, label: name, disabled: true as const, children: u });
  });
  if (noDept.length > 0) {
    result.push({ key: 'dept-none', value: 'dept-none', label: '无部门', disabled: true as const, children: noDept });
  }
  return result;
}

/**
 * 用户穿梭框选择器，展示头像、昵称、账号和部门名称。
 * 支持两种视图：扁平列表 / 部门树形（可传入 departments 显示真实多级层级）。
 */
export function UserTransferSelect({
  dataSource,
  value,
  onChange,
  departments,
}: Readonly<UserTransferSelectProps>) {
  const [viewMode, setViewMode] = useState<ViewMode>('flat');

  const transferData = useMemo<TransferDataItem[]>(
    () =>
      dataSource.map((u) => ({
        key: String(u.id),
        value: u.id,
        label: u.nickname,
        disabled: false,
        _username: u.username,
        _avatar: u.avatar,
        _departmentName: u.departmentName,
        _departmentId: u.departmentId,
      })),
    [dataSource],
  );

  // ─── 扁平模式过滤 ─────────────────────────────────────────────
  const filter = (input: string, item: TransferDataItem) => {
    const q = input.toLowerCase();
    return (
      item._username.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q) ||
      (item._departmentName ?? '').toLowerCase().includes(q)
    );
  };

  // ─── 扁平模式 - 左侧候选项渲染 ────────────────────────────────
  const renderSourceItem = (item: SourceItem) => (
    <div
      key={item.key}
      style={{ height: 52, boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: '0 12px' }}
    >
      <Checkbox
        onChange={() => item.onChange(item.value)}
        checked={item.checked}
        style={{ display: 'flex', alignItems: 'center', width: '100%' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <UserAvatar name={item.label} avatar={item._avatar} size={32} semiSize="small" style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, lineHeight: '20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
              <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginLeft: 4, fontWeight: 400 }}>
                {item._username}
              </span>
            </div>
            {item._departmentName && (
              <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--semi-color-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item._departmentName}
              </div>
            )}
          </div>
        </div>
      </Checkbox>
    </div>
  );

  // ─── 右侧已选项渲染（扁平 / 树形共用） ────────────────────────
  const renderSelectedItem = (item: SelectedItem) => (
    <div
      key={item.key}
      style={{ height: 52, boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10, justifyContent: 'space-between' }}
    >
      <UserAvatar name={item.label} avatar={item._avatar} size={32} semiSize="small" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, lineHeight: '20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.label}
          <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginLeft: 4, fontWeight: 400 }}>
            {item._username}
          </span>
        </div>
        {item._departmentName && (
          <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--semi-color-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item._departmentName}
          </div>
        )}
      </div>
      <X size={14} onClick={item.onRemove} style={{ cursor: 'pointer', color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
    </div>
  );

  // ─── 树形模式数据构建 ──────────────────────────────────────────
  const treeData = useMemo(
    () =>
      departments && departments.length > 0
        ? buildHierarchicalTree(departments, transferData)
        : buildFlatTree(transferData),
    [departments, transferData],
  );

  // ─── 树形模式 - 搜索过滤（仅叶节点） ─────────────────────────
  const filterTreeNode = useCallback(
    (inputValue: string, treeNode: Record<string, unknown>) => {
      const item = treeNode as Partial<TransferDataItem>;
      if (!item._username) return false; // 部门节点不直接匹配
      const q = inputValue.toLowerCase();
      return (
        item._username.toLowerCase().includes(q) ||
        (item.label ?? '').toLowerCase().includes(q) ||
        (item._departmentName ?? '').toLowerCase().includes(q)
      );
    },
    [],
  );

  // ─── 树形模式 - 节点标签渲染 ──────────────────────────────────
  const renderTreeLabel = useCallback(
    (label: React.ReactNode, nodeData: Record<string, unknown>) => {
      const item = nodeData as Partial<TransferDataItem>;
      if (!item._username) {
        return <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>;
      }
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserAvatar name={item.label ?? ''} avatar={item._avatar} size={24} semiSize="extra-small" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 14 }}>{item.label}</span>
          <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>{item._username}</span>
        </div>
      );
    },
    [],
  );

  const sharedProps = {
    style: { width: '100%' },
    value,
    onChange: (values: Array<string | number>) => onChange((values as number[]) || []),
    renderSelectedItem: renderSelectedItem as (item: unknown) => React.ReactNode,
    inputProps: { placeholder: '搜索姓名、账号、部门' },
    emptyContent: { left: '暂无可选用户', right: '暂无成员', search: '无匹配用户' } as const,
  };

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <RadioGroup
          value={viewMode}
          onChange={(e) => setViewMode((e as React.ChangeEvent<HTMLInputElement>).target.value as ViewMode)}
          type="button"
          size="small"
        >
          <Radio value="flat">列表</Radio>
          <Radio value="tree">部门树</Radio>
        </RadioGroup>
      </div>

      {viewMode === 'flat' ? (
        <Transfer
          {...sharedProps}
          dataSource={transferData}
          filter={filter}
          renderSourceItem={renderSourceItem as (item: unknown) => React.ReactNode}
        />
      ) : (
        <Transfer
          {...sharedProps}
          type="treeList"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          dataSource={treeData as any}
          filter
          treeProps={{
            filterTreeNode: filterTreeNode as unknown as never,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderLabel: renderTreeLabel as any,
            disableStrictly: false, // 部门节点 disabled=true 但不影响子节点（用户）可选
          }}
        />
      )}
    </div>
  );
}
