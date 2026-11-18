import { useMemo, useState } from 'react';
import { Banner, Button, Checkbox, Space, Tag, Tree, Typography, withField } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { ACCESS_RISK_LABELS, type AccessWorkflowOptions } from '@zenith/shared/identity';
import { buildTree, mapTree } from '@zenith/shared/core';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { textMatches } from '@/utils/pinyin';

type MenuOption = AccessWorkflowOptions['menus'][number];
interface PermissionTreeNode extends MenuOption { children?: PermissionTreeNode[] }
interface Props {
  readonly menus: MenuOption[];
  readonly coveredPermissionCodes: string[];
  readonly value?: string[];
  readonly onChange?: (codes: string[]) => void;
}

function AccessPermissionPicker({ menus, coveredPermissionCodes, value = [], onChange }: Props) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [showSelected, setShowSelected] = useState(false);
  const [searchExpandedKeys, setSearchExpandedKeys] = useState<string[]>([]);
  usePinyinReady();
  const covered = new Set(coveredPermissionCodes);
  const index = useMemo(() => new Map(menus.map(menu => [menu.id, menu])), [menus]);
  const treeData = useMemo<TreeNodeData[]>(() => mapTree<PermissionTreeNode, TreeNodeData>(buildTree<PermissionTreeNode>(menus), menu => {
    const permission = menu.permission;
    const roleCovered = !!permission && coveredPermissionCodes.includes(permission);
    return {
        key: String(menu.id), value: String(menu.id),
        label: <Space spacing={6}>
          {menu.requestable && permission ? <span onClick={event => event.stopPropagation()}>
            <Checkbox aria-label={`申请${menu.path.join('/')}`} checked={value.includes(permission)}
              onChange={event => onChange?.(event.target.checked ? [...new Set([...value, permission])] : value.filter(code => code !== permission))}>{menu.title}</Checkbox>
          </span> : <span>{menu.title}</span>}
          {menu.requestable && menu.riskLevel !== 'low' && <Tag size="small" color={menu.riskLevel === 'critical' ? 'red' : 'orange'}>{ACCESS_RISK_LABELS[menu.riskLevel]}</Tag>}
          {roleCovered && <Tag size="small">角色已包含</Tag>}
        </Space>,
        filterLabel: `${menu.path.join(' / ')} ${menu.permission ?? ''} ${menu.permissionLabel ?? ''}`,
    };
  }), [menus, coveredPermissionCodes, value, onChange]);
  const selected = value.map(code => menus.find(menu => menu.permission === code)).filter((menu): menu is MenuOption => !!menu);
  const locate = (menu: MenuOption) => {
    const ancestors = new Set(expandedKeys);
    const visited = new Set<number>();
    let current = index.get(menu.parentId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      ancestors.add(String(current.id));
      current = index.get(current.parentId);
    }
    setExpandedKeys([...ancestors]);
  };

  return <div>
    <Banner type="info" closeIcon={null} description="按业务模块逐项选择操作权限，目录只用于定位。页面查询和操作权限分别授权，请同时选择需要的查询能力；系统会补齐导航目录。" style={{ marginBottom: 8 }} />
    <div className="access-permission-summary" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
      <Typography.Text type="tertiary">直接申请 {value.length} 项 · 角色覆盖 {covered.size} 项</Typography.Text>
      <Button size="small" theme="borderless" onClick={() => setShowSelected(value => !value)}>{showSelected ? '收起已选' : '查看已选'}</Button>
      <Button size="small" theme="borderless" onClick={() => { setSearch(''); setExpandedKeys([]); setSearchExpandedKeys([]); }}>折叠模块</Button>
      <Button size="small" theme="borderless" disabled={!value.length} onClick={() => onChange?.([])}>清空直接申请项</Button>
    </div>
    <Tree treeData={treeData} value="" expandAction="click"
      expandedKeys={search ? searchExpandedKeys : expandedKeys}
      onExpand={keys => { if (search) setSearchExpandedKeys(keys); else setExpandedKeys(keys); }}
      onSearch={(input, keys) => { setSearch(input); setSearchExpandedKeys(keys); }}
      filterTreeNode={(input, _node, data) => textMatches(String(data?.filterLabel ?? ''), String(input))}
      showFilteredOnly searchPlaceholder="搜索名称、完整路径或权限码" virtualize={{ height: 288, itemSize: 36 }} />
    {showSelected && selected.length > 0 && <div style={{ marginTop: 12, display: 'grid', gap: 6 }} aria-label="直接申请的权限清单">
      {selected.map(menu => <div key={menu.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}><Typography.Text>{menu.path.join(' / ')}</Typography.Text><Typography.Text type="tertiary" size="small" style={{ display: 'block', overflowWrap: 'anywhere' }}>{menu.permission}</Typography.Text></div>
        <Space><Button size="small" theme="borderless" onClick={() => locate(menu)}>定位</Button><Button size="small" theme="borderless" onClick={() => onChange?.(value.filter(code => code !== menu.permission))} aria-label={`移除${menu.path.join('/')}`}>移除</Button></Space>
      </div>)}
    </div>}
  </div>;
}

export const FormAccessPermissionPicker = withField(AccessPermissionPicker);
