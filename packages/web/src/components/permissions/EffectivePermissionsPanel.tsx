/**
 * 最终有效权限：页面权限与接口权限双栏只读预览。
 *
 * 页面树和权限列表各自有搜索与独立滚动，避免页面树过长时把接口权限推到视口外。
 */
import { useMemo } from 'react';
import { TabPane, Tabs, Typography } from '@douyinfe/semi-ui';
import type { Menu } from '@zenith/shared/identity';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { CapabilityPanel } from './CapabilityPanel';
import { MenuPermissionPanel } from './MenuPermissionPanel';

type PermissionSourceGroups = ReadonlyArray<{ id: number; name: string }>;

type EffectivePermissionsPanelProps = Readonly<{
  allMenus: Menu[];
  pageIds: number[];
  permissionCodes: string[];
  loading?: boolean;
  /** 页面 ID → 来源说明（角色 / 用户组 / 直接授权 / 审批授权） */
  pageSources?: Record<string, string[]>;
  groups?: PermissionSourceGroups;
}>;

function flattenMenus(items: Menu[], map = new Map<number, Menu>()): Map<number, Menu> {
  for (const item of items) {
    map.set(item.id, item);
    if (item.children) flattenMenus(item.children, map);
  }
  return map;
}

/** 只保留已生效页面及其祖先目录，避免最终有效权限展示整棵后台菜单。 */
function filterEffectiveMenus(items: Menu[], selected: ReadonlySet<number>): Menu[] {
  return items.flatMap((item) => {
    const children = item.children ? filterEffectiveMenus(item.children, selected) : [];
    if (selected.has(item.id) || children.length > 0) {
      return [{ ...item, children }];
    }
    return [];
  });
}

export function EffectivePermissionsPanel({
  allMenus,
  pageIds,
  permissionCodes,
  loading = false,
  pageSources = {},
  groups = [],
}: EffectivePermissionsPanelProps) {
  const isMobile = useIsMobile();
  const pageSet = useMemo(() => new Set(pageIds), [pageIds]);
  const menuIndex = useMemo(() => flattenMenus(allMenus), [allMenus]);
  const effectiveMenus = useMemo(() => filterEffectiveMenus(allMenus, pageSet), [allMenus, pageSet]);
  const pageCount = useMemo(
    () => pageIds.filter((id) => menuIndex.get(id)?.type === 'menu').length,
    [menuIndex, pageIds],
  );
  const sources = useMemo(
    () => [...new Set(Object.values(pageSources).flat())],
    [pageSources],
  );
  const sourceText = useMemo(() => {
    const values = [...sources, ...groups.map((group) => `用户组：${group.name}`)];
    return [...new Set(values)].join(' · ');
  }, [groups, sources]);
  // 所有页面来源一致时只在顶部展示一次，避免每一行重复挂同一个来源 Tag。
  const sourceSignatures = useMemo(
    () => new Set(pageIds.map((id) => (pageSources[String(id)] ?? []).join('|'))),
    [pageIds, pageSources],
  );
  const labelSuffix = useMemo(() => {
    if (sourceSignatures.size <= 1) return undefined;
    const result: Record<string, React.ReactNode> = {};
    for (const id of pageIds) {
      const sourceList = pageSources[String(id)] ?? [];
      if (!sourceList.length) continue;
      result[String(id)] = <Typography.Text type="tertiary" size="small">{sourceList.join('、')}</Typography.Text>;
    }
    return result;
  }, [pageIds, pageSources, sourceSignatures]);

  const pagePanel = (
    <MenuPermissionPanel
      allMenus={effectiveMenus}
      checkedMenuIds={pageIds}
      loading={loading}
      readonly
      pagesOnly
      defaultExpandAll
      showExpandControls
      height={400}
      labelSuffix={labelSuffix}
    />
  );
  const permissionPanel = (
    <CapabilityPanel
      selectedPermissionCodes={permissionCodes}
      selectedPageIds={pageIds}
      readonly
      onlySelected
      hideBanner
      showToolbar
      height={400}
    />
  );

  const summary = (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10, fontSize: 13 }}>
      <Typography.Text strong>页面权限 {pageCount}</Typography.Text>
      <Typography.Text type="tertiary">·</Typography.Text>
      <Typography.Text strong>接口权限 {permissionCodes.length}</Typography.Text>
      <Typography.Text type="tertiary">· 只读预览</Typography.Text>
      {sourceText && (
        <>
          <Typography.Text type="tertiary">· 来源：</Typography.Text>
          <Typography.Text type="tertiary">{sourceText}</Typography.Text>
        </>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div>
        {summary}
        <Tabs collapsible="auto">
          <TabPane tab={`页面权限 ${pageCount}`} itemKey="pages">{pagePanel}</TabPane>
          <TabPane tab={`接口权限 ${permissionCodes.length}`} itemKey="permissions">{permissionPanel}</TabPane>
        </Tabs>
      </div>
    );
  }

  return (
    <div>
      {summary}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
        border: '1px solid var(--semi-color-border)',
        borderRadius: 'var(--semi-border-radius-medium)',
        overflow: 'hidden',
      }}>
        <div style={{ minWidth: 0, padding: 12, borderRight: '1px solid var(--semi-color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <Typography.Text strong>页面权限</Typography.Text>
            <Typography.Text type="tertiary" size="small">{pageCount} 项</Typography.Text>
          </div>
          {pagePanel}
        </div>
        <div style={{ minWidth: 0, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <Typography.Text strong>接口权限</Typography.Text>
            <Typography.Text type="tertiary" size="small">{permissionCodes.length} 项</Typography.Text>
          </div>
          {permissionPanel}
        </div>
      </div>
    </div>
  );
}
