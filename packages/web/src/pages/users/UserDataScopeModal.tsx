/**
 * 用户数据权限弹窗
 *
 * 布局：
 *  - 角色数据权限（只读）：显示角色最宽松数据权限及自定义部门列表
 *  - 用户直接数据权限（可编辑）：可选「跟随角色」(null) 或单独指定
 *  - 最终有效权限（只读）：取两者中最宽松的
 */
import { useState, useEffect } from 'react';
import { Typography, Divider, Toast } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import type { Department } from '@zenith/shared';
import { DataScopePanel, DATA_SCOPE_OPTIONS } from '@/components/permissions/DataScopePanel';
import { useSaveUserDataPermission, useUserDataPermission } from '@/hooks/queries/users';

const { Text } = Typography;

type Props = Readonly<{
  userId: number;
  userName: string;
  visible: boolean;
  deptTree: Department[];
  onClose: () => void;
}>;

function scopeLabel(scope: string | null): string {
  if (scope === null) return '未设置';
  return DATA_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope;
}

const SCOPE_PRIORITY: Record<string, number> = { all: 5, dept: 4, dept_only: 3, custom: 2, self: 1 };

function getMostPermissive(a: string | null, b: string | null): string {
  if (!a && !b) return 'self';
  if (!a) return b ?? 'self';
  if (!b) return a;
  return (SCOPE_PRIORITY[a] ?? 0) >= (SCOPE_PRIORITY[b] ?? 0) ? a : b;
}

export function UserDataScopeModal({ userId, userName, visible, deptTree, onClose }: Props) {
  const [userDataScope, setUserDataScope] = useState<string | null>(null);
  const [deptScopeIds, setDeptScopeIds] = useState<number[]>([]);
  const [roleDataScope, setRoleDataScope] = useState<string | null>(null);
  const [roleDeptScopeIds, setRoleDeptScopeIds] = useState<number[]>([]);
  const permissionQuery = useUserDataPermission(userId, visible);
  const saveMutation = useSaveUserDataPermission();

  useEffect(() => {
    if (!visible || !permissionQuery.data) return;
    setUserDataScope(permissionQuery.data.userDataScope);
    setDeptScopeIds(permissionQuery.data.deptScopeIds);
    setRoleDataScope(permissionQuery.data.roleDataScope);
    setRoleDeptScopeIds(permissionQuery.data.roleDeptScopeIds);
  }, [visible, permissionQuery.data]);

  const handleSave = async () => {
    await saveMutation.mutateAsync({
      userId,
      dataScope: userDataScope,
      deptScopeIds: userDataScope === 'custom' ? deptScopeIds : [],
    });
    Toast.success('数据权限已更新');
    onClose();
  };

  const effectiveScope = getMostPermissive(userDataScope, roleDataScope);
  const effectiveDeptIds =
    effectiveScope === 'custom'
      ? [...new Set([...(userDataScope === 'custom' ? deptScopeIds : []), ...roleDeptScopeIds])]
      : [];

  return (
    <AppModal
      title={`数据权限 — ${userName}`}
      visible={visible}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saveMutation.isPending}
      width={440}
    >
      {/* 角色数据权限（只读） */}
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>角色数据权限（只读）</Text>
        <DataScopePanel
          dataScope={roleDataScope ?? 'self'}
          deptScopeIds={roleDeptScopeIds}
          deptTree={deptTree}
          loading={permissionQuery.isFetching}
          readonly
        />
      </div>

      <Divider margin={12} />

      {/* 用户直接数据权限（可编辑） */}
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>用户直接权限</Text>
        <DataScopePanel
          dataScope={userDataScope}
          deptScopeIds={deptScopeIds}
          deptTree={deptTree}
          onScopeChange={setUserDataScope}
          onDeptIdsChange={setDeptScopeIds}
          loading={permissionQuery.isFetching}
          nullable
        />
      </div>

      <Divider margin={12} />

      {/* 最终有效权限（只读） */}
      <div>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>
          最终有效权限：
          <Text type="secondary" style={{ fontWeight: 'normal', marginLeft: 8 }}>
            {scopeLabel(effectiveScope)}
          </Text>
        </Text>
        <DataScopePanel
          dataScope={effectiveScope}
          deptScopeIds={effectiveDeptIds}
          deptTree={deptTree}
          loading={permissionQuery.isFetching}
          readonly
        />
      </div>
    </AppModal>
  );
}
