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
import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Space, Spin, Tree } from '@douyinfe/semi-ui';
import type { Menu } from '@zenith/shared/identity';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { textMatches } from '@/utils/pinyin';

type MenuPermissionPanelProps = Readonly<{
  allMenus: Menu[];
  checkedMenuIds: number[];
  onChange?: (ids: number[]) => void;
  loading?: boolean;
  readonly?: boolean;
  /** 数据首次到达时自动展开所有节点；只读有效权限预览使用 */
  defaultExpandAll?: boolean;
  /** 只读模式下也显示展开/折叠工具条 */
  showExpandControls?: boolean;
  /** 树虚拟列表高度，默认 400；双栏预览时由调用方统一列高 */
  height?: number;
  /** key(menuId 字符串) -> 额外渲染的 ReactNode（如来源 Tag）*/
  labelSuffix?: Record<string, React.ReactNode>;
}>;

function visibleMenus(items: Menu[]): Menu[] {
  return items.map((m) => ({ ...m, children: m.children ? visibleMenus(m.children) : undefined }));
}

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

export function MenuPermissionPanel({
  allMenus,
  checkedMenuIds,
  onChange,
  loading = false,
  readonly = false,
  defaultExpandAll = false,
  showExpandControls = false,
  height = 400,
  labelSuffix,
}: MenuPermissionPanelProps) {
  // 默认折叠（菜单树节点较多，全展开列表过长）；可用「展开全部」按钮展开
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const displayMenus = useMemo(() => visibleMenus(allMenus), [allMenus]);
  useEffect(() => {
    if (defaultExpandAll && displayMenus.length > 0) setExpandedKeys(getAllMenuKeys(displayMenus));
  }, [defaultExpandAll, displayMenus]);
  // 拼音词典就绪后重渲染，补上已输入关键字的拼音命中
  usePinyinReady();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  // 父子不联动（精确授权）。页面读权限由服务端按页面自动补齐。
  const handleChange = (keys: string[]) => onChange?.(keys.map(Number));

  return (
    <>
      {!readonly && (
        <>
          <Banner
            type="info"
            closeIcon={null}
            style={{ marginBottom: 8 }}
            description="页面访问只控制导航；页面读权限随页面自动授予。操作权限请在「接口权限」中单独选择，不会隐藏或带出页面。"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <Space>
              <Button size="small" theme="borderless" onClick={() => onChange?.(getAllMenuIds(displayMenus))}>全选</Button>
              <Button size="small" theme="borderless" onClick={() => onChange?.([])}>全不选</Button>
            </Space>
            <Space>
              <Button size="small" theme="borderless" onClick={() => setExpandedKeys(getAllMenuKeys(displayMenus))}>展开全部</Button>
              <Button size="small" theme="borderless" onClick={() => setExpandedKeys([])}>折叠全部</Button>
            </Space>
          </div>
        </>
      )}
      {readonly && showExpandControls && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Space>
            <Button size="small" theme="borderless" onClick={() => setExpandedKeys(getAllMenuKeys(displayMenus))}>展开全部</Button>
            <Button size="small" theme="borderless" onClick={() => setExpandedKeys([])}>折叠全部</Button>
          </Space>
        </div>
      )}
      <Tree
        treeData={menusToTreeData(displayMenus, labelSuffix)}
        multiple
        autoMergeValue={false}
        checkRelation="unRelated"
        expandedKeys={expandedKeys}
        onExpand={(keys) => setExpandedKeys(keys)}
        value={checkedMenuIds.map(String)}
        onChange={readonly ? undefined : (keys) => handleChange(keys as string[])}
        disableStrictly={readonly}
        filterTreeNode={(input, _node, data) => textMatches(
          String((data as { filterLabel?: unknown } | undefined)?.filterLabel ?? ''),
          String(input),
        )}
        showFilteredOnly
        searchPlaceholder="搜索菜单名称"
        // 唯一的滚动容器：虚拟列表内部滚动；外层不定高（搜索框 + 400 列表自适应），
        // 否则外层 448 与内层 400 两个滚动容器叠加出现双滚动条
        virtualize={{ height, itemSize: 36 }}
      />
    </>
  );
}
