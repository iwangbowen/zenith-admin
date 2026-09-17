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
import { useMemo, useState } from 'react';
import { Banner, Button, Space, Spin, Tree } from '@douyinfe/semi-ui';
import type { Menu } from '@zenith/shared/identity';

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
      <Space spacing={6}>
        <span>{m.title}</span>
        {labelSuffix?.[String(m.id)]}
      </Space>
    ),
    // label 为 ReactNode，搜索改用该字段（treeNodeFilterProp="filterLabel"）
    filterLabel: m.title,
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

function flattenMenus(items: Menu[], map = new Map<number, Menu>()): Map<number, Menu> {
  for (const m of items) {
    map.set(m.id, m);
    if (m.children) flattenMenus(m.children, map);
  }
  return map;
}

/** 页面/目录节点的「查询」按钮子节点：勾选页面时自动带上，保证页面数据可加载 */
function queryButtonIdsOf(node: Menu): number[] {
  return (node.children ?? [])
    .filter((c) => c.type === 'button' && (
      c.permission?.endsWith(':list') || c.permission?.endsWith(':query') || c.title === '查询'
    ))
    .map((c) => c.id);
}

export function MenuPermissionPanel({
  allMenus,
  checkedMenuIds,
  onChange,
  loading = false,
  readonly = false,
  labelSuffix,
}: MenuPermissionPanelProps) {
  // 默认折叠（菜单树节点较多，全展开列表过长）；可用「展开全部」按钮展开
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const menuIndex = useMemo(() => flattenMenus(allMenus), [allMenus]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  // 父子不联动（精确授权）：新勾选页面/目录时自动带上其「查询」按钮；取消勾选不级联
  const handleChange = (keys: string[]) => {
    const next = new Set(keys.map(Number));
    const prev = new Set(checkedMenuIds);
    for (const id of next) {
      if (prev.has(id)) continue;
      const node = menuIndex.get(id);
      if (node && node.type !== 'button') {
        for (const qid of queryButtonIdsOf(node)) next.add(qid);
      }
    }
    onChange?.([...next]);
  };

  return (
    <>
      {!readonly && (
        <>
          <Banner
            type="info"
            closeIcon={null}
            style={{ marginBottom: 8 }}
            description="菜单仅控制页面可见性，操作能力（含查询）由按钮权限决定；勾选按钮不会带出所属页面。勾选页面时已自动带上「查询」按钮。"
          />
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
        </>
      )}
      <Tree
        treeData={menusToTreeData(allMenus, labelSuffix)}
        multiple
        autoMergeValue={false}
        checkRelation="unRelated"
        expandedKeys={expandedKeys}
        onExpand={(keys) => setExpandedKeys(keys)}
        value={checkedMenuIds.map(String)}
        onChange={readonly ? undefined : (keys) => handleChange(keys as string[])}
        disableStrictly={readonly}
        filterTreeNode
        treeNodeFilterProp="filterLabel"
        showFilteredOnly
        searchPlaceholder="搜索菜单名称"
        // 唯一的滚动容器：虚拟列表内部滚动；外层不定高（搜索框 + 400 列表自适应），
        // 否则外层 448 与内层 400 两个滚动容器叠加出现双滚动条
        virtualize={{ height: 400, itemSize: 36 }}
      />
    </>
  );
}
