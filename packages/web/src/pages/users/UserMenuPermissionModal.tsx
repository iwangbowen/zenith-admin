/**
 * 用户菜单权限弹窗
 *
 * Tabs：
 *  1. 直接授权   — 可编辑，显示用户直接授权的菜单
 *  2. 最终有效权限 — 只读，显示角色继承 ∪ 用户组继承 ∪ 直接授权，并用 Tag 标注来源
 */
import { useState, useEffect } from 'react';
import { Tabs, TabPane, Toast, Tag, Space } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import { MenuPermissionPanel } from '@/components/permissions/MenuPermissionPanel';
import { useMenuTree } from '@/hooks/queries/menus';
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
  const [roleMenuIds, setRoleMenuIds] = useState<number[]>([]);
  const [groupMenuIds, setGroupMenuIds] = useState<number[]>([]);
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
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
    setGroupMenuIds(permissionsQuery.data.groupMenuIds ?? []);
    setGroups(permissionsQuery.data.groups ?? []);
    setEffectiveMenuIds(permissionsQuery.data.effectiveMenuIds);
  }, [visible, permissionsQuery.data]);

  const handleSave = async () => {
    await saveMenusMutation.mutateAsync({ params: { id: userId }, body: { menuIds: directMenuIds } });
    Toast.success('菜单权限已更新');
    const effectiveSet = new Set([...directMenuIds, ...roleMenuIds, ...groupMenuIds]);
    setEffectiveMenuIds([...effectiveSet]);
    onClose();
  };

  /** 构造有效权限 Tab 里的具体来源 Tag（同一菜单可能有多个来源） */
  function buildLabelSuffix(): Record<string, React.ReactNode> {
    const menuSources = permissionsQuery.data?.menuSources ?? {};
    const result: Record<string, React.ReactNode> = {};
    for (const id of effectiveMenuIds) {
      const sources = menuSources[String(id)] ?? [];
      const tags = sources.map((source) => (
        <Tag
          key={source}
          size="small"
          color={source === '用户直接授权' ? 'green' : source.includes('用户组：') ? 'orange' : 'blue'}
        >
          {source}
        </Tag>
      ));
      result[String(id)] = <Space spacing={4} style={{ marginLeft: 4 }}>{tags}</Space>;
    }
    return result;
  }

  return (
    <AppModal
      title={`菜单权限 — ${userName}`}
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
      width={640}
    >
      <Tabs collapsible="auto" activeKey={activeTab} onChange={setActiveTab}>
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
            <div>最终权限 = 角色权限 ∪ 用户组继承 ∪ 用户直接授权，仅供预览</div>
            <div style={{ display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', columnGap: 8, rowGap: 6, alignItems: 'start', marginTop: 6 }}>
              <span>权限来源：</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[...new Set(Object.values(permissionsQuery.data?.menuSources ?? {}).flat())].map((source) => (
                  <Tag
                    key={source}
                    size="small"
                    color={source === '用户直接授权' ? 'green' : source.includes('用户组：') ? 'orange' : 'blue'}
                  >
                    {source}
                  </Tag>
                ))}
              </div>
              {groups.length > 0 && (
                <>
                  <span>继承自用户组：</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {groups.map((g) => <Tag key={g.id} size="small" color="orange">{g.name}</Tag>)}
                  </div>
                </>
              )}
            </div>
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
