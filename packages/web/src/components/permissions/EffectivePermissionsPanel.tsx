/**
 * 最终有效权限：页面为主、操作权限跟随页面的只读预览。
 *
 * 页面树和权限项共享同一套页面分组结构，避免页面与接口权限各占一栏后失去关联。
 */
import { useMemo } from 'react';
import { Banner, Typography } from '@douyinfe/semi-ui';
import type { Menu } from '@zenith/shared/identity';
import { usePermissionCatalog } from '@/hooks/queries/permission-matrix';
import { PermissionScopeWorkspace } from './PermissionScopeWorkspace';
import { createAdminScopeData } from './scope-adapters';

type PermissionSourceGroups = ReadonlyArray<{ id: number; name: string }>;

type EffectivePermissionsPanelProps = Readonly<{
  allMenus: Menu[];
  pageIds: number[];
  permissionCodes: string[];
  loading?: boolean;
  /** 页面 ID → 来源说明（角色 / 用户组 / 直接授权 / 审批授权） */
  pageSources?: Record<string, string[]>;
  permissionSources?: Record<string, string[]>;
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
  permissionSources = {},
  groups = [],
}: EffectivePermissionsPanelProps) {
  const catalogQuery = usePermissionCatalog();
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

  const scopeData = useMemo(() => {
    const base = createAdminScopeData(effectiveMenus, catalogQuery.data ?? { items: [] });
    const codeSet = new Set(permissionCodes);
    return {
      pages: base.pages,
      permissions: base.permissions.filter(item => codeSet.has(item.code))
        .map(item => ({ ...item, sources: permissionSources[item.code] })),
    };
  }, [catalogQuery.data, effectiveMenus, permissionCodes, permissionSources]);

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

  if (catalogQuery.error) {
    return <div>{summary}<Banner type="warning" closeIcon={null} description={catalogQuery.error.message} /></div>;
  }

  return (
    <div>
      {summary}
      <PermissionScopeWorkspace
        data={scopeData}
        value={{ pageIds, permissionCodes }}
        onChange={() => {}}
        readonly
        onlySelected
        autoExpandSelected={false}
        showBanner={false}
        showSummary={false}
        loading={loading || catalogQuery.isLoading}
        height={400}
        pageSuffix={labelSuffix}
      />
    </div>
  );
}
