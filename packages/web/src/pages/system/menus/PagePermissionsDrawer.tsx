import { useMemo } from 'react';
import { Banner, SideSheet, Spin } from '@douyinfe/semi-ui';
import type { Menu } from '@zenith/shared/identity';
import { PermissionScopePermissionList } from '@/components/permissions/PermissionScopePermissionList';
import { createAdminScopeData } from '@/components/permissions/scope-adapters';
import { usePermissionCatalog } from '@/hooks/queries/permission-matrix';

type Props = Readonly<{
  menu: Menu | null;
  visible: boolean;
  onClose: () => void;
}>;

/** 菜单管理中的只读页面功能视图：权限定义来自代码注册表，不在此处编辑。 */
export default function PagePermissionsDrawer({ menu, visible, onClose }: Props) {
  const catalogQuery = usePermissionCatalog(visible);
  const data = useMemo(
    () => createAdminScopeData([], catalogQuery.data ?? { items: [] }),
    [catalogQuery.data],
  );
  const items = useMemo(
    () => menu ? data.permissions.filter(item => item.pageId === menu.id) : [],
    [data.permissions, menu],
  );

  return (
    <SideSheet
      title={menu ? `页面权限 — ${menu.title}` : '页面权限'}
      visible={visible}
      onCancel={onClose}
      width="min(560px, 94vw)"
      bodyStyle={{ padding: 16 }}
    >
      <Banner
        type="info"
        fullMode={false}
        closeIcon={null}
        style={{ marginBottom: 12 }}
        description="操作权限由代码权限注册表和权限目录维护，这里只读展示当前页面可用能力；菜单管理不直接编辑权限码。"
      />
      {catalogQuery.isLoading
        ? <Spin />
        : catalogQuery.error
          ? <Banner type="danger" closeIcon={null} description={catalogQuery.error.message} />
          : (
            <PermissionScopePermissionList
              key={menu?.id ?? 'empty'}
              items={items}
              selectedPermissionCodes={menu?.permission ? [menu.permission] : []}
              pageIds={menu ? [menu.id] : []}
              readonly
              defaultExpandAll
              height={520}
              showPolicy
              emptyText="该页面暂未登记页面读权限或操作权限"
            />
          )}
    </SideSheet>
  );
}
