/**
 * 用户菜单权限弹窗
 *
 * Tabs：
 *  1. 直接授权   — 可编辑，显示用户直接授权的菜单
 *  2. 最终有效权限 — 只读，显示角色继承 ∪ 直接授权，并用 Tag 标注来源
 */
import { useState, useEffect } from 'react';
import { Modal, Tabs, TabPane, Toast, Tag } from '@douyinfe/semi-ui';
import type { Menu } from '@zenith/shared';
import { request } from '@/utils/request';
import { MenuPermissionPanel } from '@/components/permissions/MenuPermissionPanel';

interface UserMenuPermissions {
  directMenuIds: number[];
  roleMenuIds: number[];
}

interface UserEffectivePermissions extends UserMenuPermissions {
  effectiveMenuIds: number[];
}

type Props = Readonly<{
  userId: number;
  userName: string;
  visible: boolean;
  onClose: () => void;
}>;

export function UserMenuPermissionModal({ userId, userName, visible, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allMenus, setAllMenus] = useState<Menu[]>([]);
  const [directMenuIds, setDirectMenuIds] = useState<number[]>([]);
  const [roleMenuIds, setRoleMenuIds] = useState<number[]>([]);
  const [effectiveMenuIds, setEffectiveMenuIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState('direct');

  useEffect(() => {
    if (!visible) return;
    setActiveTab('direct');
    void (async () => {
      setLoading(true);
      try {
        const [menusRes, permRes] = await Promise.all([
          request.get<Menu[]>('/api/menus'),
          request.get<UserEffectivePermissions>(`/api/users/${userId}/effective-permissions`),
        ]);
        if (menusRes.code === 0) setAllMenus(menusRes.data);
        if (permRes.code === 0) {
          setDirectMenuIds(permRes.data.directMenuIds);
          setRoleMenuIds(permRes.data.roleMenuIds);
          setEffectiveMenuIds(permRes.data.effectiveMenuIds);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, userId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await request.put(`/api/users/${userId}/menus`, { menuIds: directMenuIds });
      if (res.code === 0) {
        Toast.success('菜单权限已更新');
        // 更新有效权限预览
        const effectiveSet = new Set([...directMenuIds, ...roleMenuIds]);
        setEffectiveMenuIds([...effectiveSet]);
        onClose();
      }
    } finally {
      setSaving(false);
    }
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
    <Modal
      title={`菜单权限 — ${userName}`}
      visible={visible}
      onCancel={onClose}
      onOk={activeTab === 'direct' ? handleSave : undefined}
      okText={activeTab === 'direct' ? '保存' : undefined}
      footer={activeTab === 'effective' ? null : undefined}
      confirmLoading={saving}
      width={520}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="直接授权" itemKey="direct">
          <MenuPermissionPanel
            allMenus={allMenus}
            checkedMenuIds={directMenuIds}
            onChange={setDirectMenuIds}
            loading={loading}
          />
        </TabPane>
        <TabPane tab="最终有效权限" itemKey="effective">
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            最终权限 = 角色权限 ∪ 用户直接授权，仅供预览
          </div>
          <MenuPermissionPanel
            allMenus={allMenus}
            checkedMenuIds={effectiveMenuIds}
            loading={loading}
            readonly
            labelSuffix={buildLabelSuffix()}
          />
        </TabPane>
      </Tabs>
    </Modal>
  );
}
