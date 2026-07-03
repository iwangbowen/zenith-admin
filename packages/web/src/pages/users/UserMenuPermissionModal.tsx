/**
 * 用户菜单权限弹窗
 *
 * Tabs：
 *  1. 直接授权   — 可编辑，显示用户直接授权的菜单
 *  2. 最终有效权限 — 只读，显示角色继承 ∪ 直接授权，并用 Tag 标注来源
 */
import { useState, useEffect } from 'react';
import { Tabs, TabPane, Toast, Tag } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import { MenuPermissionPanel } from '@/components/permissions/MenuPermissionPanel';
import { useMenuTree } from '@/hooks/queries/menus';
import { useSaveUserMenus, useUserEffectivePermissions } from '@/hooks/queries/users';

type Props = Readonly<{
  userId: number;
  userName: string;
  visible: boolean;
  onClose: () => void;
}>;

export function UserMenuPermissionModal({ userId, userName, visible, onClose }: Props) {
  const [directMenuIds, setDirectMenuIds] = useState<number[]>([]);
  const [roleMenuIds, setRoleMenuIds] = useState<number[]>([]);
  const [effectiveMenuIds, setEffectiveMenuIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState('direct');
  const menuTreeQuery = useMenuTree({ enabled: visible });
  const permissionsQuery = useUserEffectivePermissions(userId, visible);
  const saveMenusMutation = useSaveUserMenus();

  useEffect(() => {
    if (!visible) return;
    setActiveTab('direct');
  }, [visible, userId]);

  useEffect(() => {
    if (!visible || !permissionsQuery.data) return;
    setDirectMenuIds(permissionsQuery.data.directMenuIds);
    setRoleMenuIds(permissionsQuery.data.roleMenuIds);
    setEffectiveMenuIds(permissionsQuery.data.effectiveMenuIds);
  }, [visible, permissionsQuery.data]);

  const handleSave = async () => {
    await saveMenusMutation.mutateAsync({ userId, menuIds: directMenuIds });
    Toast.success('菜单权限已更新');
    const effectiveSet = new Set([...directMenuIds, ...roleMenuIds]);
    setEffectiveMenuIds([...effectiveSet]);
    onClose();
  };

  /** 构造有效权限 Tab 里的来源 Tag */
  function buildLabelSuffix(): Record<string, React.ReactNode> {
    const directSet = new Set(directMenuIds);
    const roleSet = new Set(roleMenuIds);
    const result: Record<string, React.ReactNode> = {};
    for (const id of effectiveMenuIds) {
      const inDirect = directSet.has(id);
      const inRole = roleSet.has(id);
      if (inDirect && inRole) {
        result[String(id)] = <Tag size="small" color="purple" style={{ marginLeft: 4 }}>角色+用户</Tag>;
      } else if (inRole) {
        result[String(id)] = <Tag size="small" color="blue" style={{ marginLeft: 4 }}>角色</Tag>;
      } else {
        result[String(id)] = <Tag size="small" color="green" style={{ marginLeft: 4 }}>用户</Tag>;
      }
    }
    return result;
  }

  return (
    <AppModal
      title={`菜单权限 — ${userName}`}
      visible={visible}
      onCancel={onClose}
      onOk={activeTab === 'direct' ? handleSave : undefined}
      okText={activeTab === 'direct' ? '保存' : undefined}
      footer={activeTab === 'effective' ? null : undefined}
      confirmLoading={saveMenusMutation.isPending}
      width={520}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="直接授权" itemKey="direct">
          <MenuPermissionPanel
            allMenus={menuTreeQuery.data ?? []}
            checkedMenuIds={directMenuIds}
            onChange={setDirectMenuIds}
            loading={menuTreeQuery.isFetching || permissionsQuery.isFetching}
          />
        </TabPane>
        <TabPane tab="最终有效权限" itemKey="effective">
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            最终权限 = 角色权限 ∪ 用户直接授权，仅供预览
          </div>
          <MenuPermissionPanel
            allMenus={menuTreeQuery.data ?? []}
            checkedMenuIds={effectiveMenuIds}
            loading={menuTreeQuery.isFetching || permissionsQuery.isFetching}
            readonly
            labelSuffix={buildLabelSuffix()}
          />
        </TabPane>
      </Tabs>
    </AppModal>
  );
}
