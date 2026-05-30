/**
 * 菜单权限面板（可复用于角色管理 & 用户管理）
 *
 * Props:
 *  - allMenus:       完整菜单树（Menu[]）
 *  - checkedMenuIds: 当前已选中的菜单 ID
 *  - onChange:       选中状态变化回调
 *  - loading?:       是否显示骨架屏
 *  - readonly?:      只读模式（不可勾选，用于「有效权限」预览）
 *  - extraTreeData?:  叶/节点额外渲染内容（key->ReactNode），用于显示来源 Tag
 */
import { useState } from 'react';
import { Button, Space, Spin, Tree } from '@douyinfe/semi-ui';
import type { Menu } from '@zenith/shared';

type MenuPermissionPanelProps = Readonly<{
  allMenus: Menu[];
  checkedMenuIds: number[];
  onChange?: (ids: number[]) => void;
  loading?: boolean;
  readonly?: boolean;
  /** key(menuId 字符串) -> 额外渲染的 ReactNode（如来源 Tag）*/
  labelSuffix?: Record<string, React.ReactNode>;
}>;

function menusToTreeData(items: Menu[], labelSuffix?: Record<string, React.ReactNode>): object[] {
  return items.map((m) => ({
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span>{m.title}</span>
        {labelSuffix?.[String(m.id)]}
      </span>
    ),
    key: String(m.id),
    value: m.id,
    children: m.children ? menusToTreeData(m.children, labelSuffix) : undefined,
  }));
}

function getAllMenuIds(items: Menu[]): number[] {
  return items.flatMap((m) => [m.id, ...(m.children ? getAllMenuIds(m.children) : [])]);
}

function getAllMenuKeys(items: Menu[]): string[] {
  return items.flatMap((m) => [String(m.id), ...(m.children ? getAllMenuKeys(m.children) : [])]);
}

export function MenuPermissionPanel({
  allMenus,
  checkedMenuIds,
  onChange,
  loading = false,
  readonly = false,
  labelSuffix,
}: MenuPermissionPanelProps) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>(() => getAllMenuKeys(allMenus));

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
    <>
      {!readonly && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <Space>
            <Button size="small" theme="borderless" onClick={() => onChange?.(getAllMenuIds(allMenus))}>全选</Button>
            <Button size="small" theme="borderless" onClick={() => onChange?.([])}>全不选</Button>
          </Space>
          <Space>
            <Button size="small" theme="borderless" onClick={() => setExpandedKeys(getAllMenuKeys(allMenus))}>展开全部</Button>
            <Button size="small" theme="borderless" onClick={() => setExpandedKeys([])}>折叠全部</Button>
          </Space>
        </div>
      )}
      <Tree
        treeData={menusToTreeData(allMenus, labelSuffix)}
        multiple
        autoMergeValue={false}
        expandedKeys={expandedKeys}
        onExpand={(keys) => setExpandedKeys(keys)}
        value={checkedMenuIds.map(String)}
        onChange={readonly ? undefined : (keys) => onChange?.((keys as string[]).map(Number))}
        disableStrictly={readonly}
        style={{ maxHeight: 400, overflow: 'auto' }}
      />
    </>
  );
}
