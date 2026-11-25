/**
 * 用户页面与权限授权弹窗
 *
 * Tabs：
 *  1. 页面访问 — 可编辑，只选择导航页面
 *  2. 接口权限 — 可编辑，选择页面读/按钮操作/API-only 权限码
 *  3. 最终有效权限 — 只读，显示角色继承 ∪ 用户组继承 ∪ 直接授权，并用 Tag 标注来源
 */
import { useMemo, useState, useEffect } from 'react';
import { Tabs, TabPane, Toast } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import { EffectivePermissionsPanel } from '@/components/permissions/EffectivePermissionsPanel';
import { PermissionScopeWorkspace } from '@/components/permissions/PermissionScopeWorkspace';
import { createAdminScopeData } from '@/components/permissions/scope-adapters';
import { usePermissionCatalog } from '@/hooks/queries/permission-matrix';
import { useMenuTree } from '@/hooks/queries/menus';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { mediaDown } from '@/lib/breakpoints';
import ModalFooter from '@/components/ModalFooter';
import { useSaveUserMenus, useUserEffectivePermissions } from '@/hooks/queries/users';

type Props = Readonly<{
  userId: number;
  userName: string;
  visible: boolean;
  onClose: () => void;
}>;

export function UserMenuPermissionModal({ userId, userName, visible, onClose }: Props) {
  const [directMenuIds, setDirectMenuIds] = useState<number[]>([]);
  const [directPermissionCodes, setDirectPermissionCodes] = useState<string[]>([]);
  const [roleMenuIds, setRoleMenuIds] = useState<number[]>([]);
  const [groupMenuIds, setGroupMenuIds] = useState<number[]>([]);
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [effectiveMenuIds, setEffectiveMenuIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState('direct');
  const compact = useMediaQuery(mediaDown('lg'));
  const menuTreeQuery = useMenuTree({ enabled: visible });
  const permissionCatalogQuery = usePermissionCatalog(visible);
  const scopeData = useMemo(
    () => createAdminScopeData(menuTreeQuery.data ?? [], permissionCatalogQuery.data ?? { items: [] }),
    [menuTreeQuery.data, permissionCatalogQuery.data],
  );
  const permissionsQuery = useUserEffectivePermissions(userId, visible);
  const saveMenusMutation = useSaveUserMenus();

  useEffect(() => {
    if (!visible) return;
    setActiveTab('direct');
  }, [visible, userId]);

  useEffect(() => {
    if (!visible || !permissionsQuery.data) return;
    setDirectMenuIds(permissionsQuery.data.directMenuIds);
    setDirectPermissionCodes(permissionsQuery.data.directPermissionCodes);
    setRoleMenuIds(permissionsQuery.data.roleMenuIds);
    setGroupMenuIds(permissionsQuery.data.groupMenuIds ?? []);
    setGroups(permissionsQuery.data.groups ?? []);
    setEffectiveMenuIds(permissionsQuery.data.effectiveMenuIds);
  }, [visible, permissionsQuery.data]);

  const handleSave = async () => {
    await saveMenusMutation.mutateAsync({ params: { id: userId }, body: { menuIds: directMenuIds, permissionCodes: directPermissionCodes } });
    Toast.success('页面与权限已更新');
    const effectiveSet = new Set([...directMenuIds, ...roleMenuIds, ...groupMenuIds]);
    setEffectiveMenuIds([...effectiveSet]);
    onClose();
  };

  return (
    <AppModal
      title={`页面与权限 — ${userName}`}
      visible={visible}
      onCancel={onClose}
      footer={activeTab === 'effective' ? null : (
        <ModalFooter
          onCancel={onClose}
          onOk={handleSave}
          okText="保存"
          loading={saveMenusMutation.isPending}
          disabled={!permissionsQuery.isSuccess}
        />
      )}
      width={compact ? Math.max(320, Math.floor(window.innerWidth * 0.94)) : 1180}
    >
      <Tabs collapsible="auto" activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab={`直接授权 ${directMenuIds.length} 个页面 / ${directPermissionCodes.length} 项权限`} itemKey="direct">
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            这里只编辑用户直接授权；角色、用户组或审批继承的权限请在「最终有效权限」查看。
          </div>
          <PermissionScopeWorkspace
            data={scopeData}
            value={{ pageIds: directMenuIds, permissionCodes: directPermissionCodes }}
            onChange={(next) => {
              setDirectMenuIds(next.pageIds);
              setDirectPermissionCodes(next.permissionCodes);
            }}
            loading={menuTreeQuery.isFetching || permissionCatalogQuery.isLoading || permissionsQuery.isFetching}
            height={460}
          />
        </TabPane>
        <TabPane tab="最终有效权限" itemKey="effective">
          <EffectivePermissionsPanel
            allMenus={menuTreeQuery.data ?? []}
            pageIds={effectiveMenuIds}
            permissionCodes={permissionsQuery.data?.permissionCodes ?? []}
            loading={menuTreeQuery.isFetching || permissionsQuery.isFetching}
            pageSources={permissionsQuery.data?.menuSources}
            groups={groups}
          />
        </TabPane>
      </Tabs>
    </AppModal>
  );
}
