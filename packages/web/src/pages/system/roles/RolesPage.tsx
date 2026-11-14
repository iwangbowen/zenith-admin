import { useEffect, useMemo, useState } from 'react';
import { Form, Toast, Spin, SideSheet } from '@douyinfe/semi-ui';
import { DATA_SCOPES, type CreateRoleInput, type Role, type Department, roleContract } from '@zenith/shared/identity';
import { enumValueOf } from '@zenith/shared/core';
import { UserTransferSelect } from '@/components/UserTransferSelect';
import type { UserTransferUser } from '@/components/UserTransferSelect';
import { UserPreviewCell } from '@/components/UserPreviewCell';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { MenuPermissionPanel } from '@/components/permissions/MenuPermissionPanel';
import { DataScopePanel } from '@/components/permissions/DataScopePanel';
import { departmentTreeToTreeData, useDepartmentTree } from '@/hooks/queries/departments';
import { useMenuTree } from '@/hooks/queries/menus';
import { useAllUsers } from '@/hooks/queries/users';
import { useEditModal } from '@/hooks/useEditModal';
import {
  useAssignRoleMenus,
  useAssignRoleUsers,
  useDeleteRoles,
  useRoleDetail,
  useRoleList,
  useRoleUsers,
  useSaveRole,
  useUpdateRoleDataScope,
} from '@/hooks/queries/roles';
import { CreateButton } from '@/components/toolbar-controls';
import { DateRangeFilter } from '@/components/search-filters';
import { ListSearchToolbar, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';
import ModalFooter from '@/components/ModalFooter';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

export default function RolesPage() {
  const { hasPermission } = usePermission();
  const { options: statusOptions } = useDictItems('common_status');
  const page = useListPage({
    contract: roleContract,
    useList: useRoleList,
  });
  const { tableProps, filterQuery } = page;
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [menuRole, setMenuRole] = useState<Role | null>(null);
  const [checkedMenuIds, setCheckedMenuIds] = useState<number[]>([]);
  const [userModalVisible, setUserModalVisible] = useState(false);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [assignedUserIds, setAssignedUserIds] = useState<number[]>([]);
  const [dataScopeModalVisible, setDataScopeModalVisible] = useState(false);
  const [dataScopeRole, setDataScopeRole] = useState<Role | null>(null);
  const [selectedDataScope, setSelectedDataScope] = useState<string>('all');
  const [selectedDeptScopeIds, setSelectedDeptScopeIds] = useState<number[]>([]);

  const menuTreeQuery = useMenuTree({ enabled: menuModalVisible });
  const menuRoleDetailQuery = useRoleDetail(menuRole?.id, menuModalVisible);
  const allUsersQuery = useAllUsers({ enabled: userModalVisible });
  const roleUsersQuery = useRoleUsers(userRole?.id, userModalVisible);
  const dataScopeRoleDetailQuery = useRoleDetail(dataScopeRole?.id, dataScopeModalVisible);
  const deptTreeQuery = useDepartmentTree();
  const deptTree = useMemo(() => deptTreeQuery.data ?? [], [deptTreeQuery.data]);

  const saveMutation = useSaveRole();
  const roleModal = useEditModal<Role, Partial<CreateRoleInput>>({
    entityName: '角色',
    save: saveMutation,
    useDetail: useRoleDetail,
    defaults: { status: 'enabled' },
    // 记录里的 null 描述在表单中视为未填
    toValues: (role) => ({ name: role.name, code: role.code, description: role.description ?? undefined, deptScopeIds: role.deptScopeIds, status: role.status }),
  });
  const editingRole = roleModal.editing;
  const toggleStatusMutation = useSaveRole();
  const deleteMutation = useDeleteRoles();
  const assignMenusMutation = useAssignRoleMenus();
  const assignUsersMutation = useAssignRoleUsers();
  const updateDataScopeMutation = useUpdateRoleDataScope();
  const status = useStatusToggle<Role>({
    toggle: (role, enabled) => toggleStatusMutation.mutateAsync({ id: role.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (role) => ({ danger: true, title: `确认禁用角色「${role.name}」？`, content: '禁用后持有该角色的用户将不能登录。', okText: '确认禁用' }),
    disabled: (role) => role.code === 'super_admin' || !hasPermission('system:role:update'),
    messages: { disabled: '已禁用' },
  });

  useEffect(() => {
    if (menuModalVisible) setCheckedMenuIds(menuRoleDetailQuery.data?.menuIds ?? []);
  }, [menuModalVisible, menuRoleDetailQuery.data]);

  useEffect(() => {
    if (userModalVisible) setAssignedUserIds((roleUsersQuery.data ?? []).map((u) => u.id));
  }, [userModalVisible, roleUsersQuery.data]);

  useEffect(() => {
    if (dataScopeModalVisible && dataScopeRoleDetailQuery.data) {
      setSelectedDeptScopeIds(dataScopeRoleDetailQuery.data.deptScopeIds ?? []);
    }
  }, [dataScopeModalVisible, dataScopeRoleDetailQuery.data]);

  const openMenuModal = (role: Role) => {
    setMenuRole(role);
    setMenuModalVisible(true);
  };

  const handleAssignMenus = async () => {
    if (!menuRole) return;
    await assignMenusMutation.mutateAsync({ params: { id: menuRole.id }, body: { menuIds: checkedMenuIds } });
    Toast.success('菜单权限已更新');
    setMenuModalVisible(false);
  };

  // 扁平化部门列表（供分配用户组件的树形视图使用）
  const flatDepts = useMemo<Department[]>(() => {
    const result: Department[] = [];
    const flatten = (items: Department[]) => {
      items.forEach((d) => {
        result.push(d);
        if (d.children) flatten(d.children);
      });
    };
    flatten(deptTree);
    return result;
  }, [deptTree]);

  const allUsers = useMemo<UserTransferUser[]>(() => allUsersQuery.data ?? [], [allUsersQuery.data]);

  const openUserModal = (role: Role) => {
    setUserRole(role);
    setUserModalVisible(true);
  };

  const handleAssignUsers = async () => {
    if (!userRole) return;
    if (userRole.code === 'super_admin' && userRole.tenantId == null) {
      const admin = roleUsersQuery.data?.find(user => user.username.trim().toLowerCase() === 'admin');
      if (admin && !assignedUserIds.includes(admin.id)) {
        Toast.warning('不能移除 admin 管理员用户的超级管理员角色');
        return;
      }
    }
    await assignUsersMutation.mutateAsync({ params: { id: userRole.id }, body: { userIds: assignedUserIds } });
    Toast.success('用户分配已更新');
    setUserModalVisible(false);
  };

  const openDataScopeModal = (role: Role) => {
    setDataScopeRole(role);
    setSelectedDataScope(role.dataScope ?? 'all');
    setSelectedDeptScopeIds([]);
    setDataScopeModalVisible(true);
  };

  const handleSaveDataScope = async () => {
    if (!dataScopeRole) return;
    // 面板以宽 string 维护选中值，提交前收窄为数据范围枚举
    const dataScope = enumValueOf(DATA_SCOPES, selectedDataScope) ?? 'all';
    await updateDataScopeMutation.mutateAsync({
      params: { id: dataScopeRole.id },
      body: dataScope === 'custom' ? { dataScope, deptScopeIds: selectedDeptScopeIds } : { dataScope },
    });
    Toast.success('数据权限已更新');
    setDataScopeModalVisible(false);
  };

  const operationColumn = useCrudOperationColumn<Role>({
    permission: 'system:role',
    edit: roleModal,
    remove: deleteMutation,
    title: '确认删除此角色？',
    disabled: { remove: (row) => row.code === 'super_admin', reason: '超级管理员角色不允许删除' },
    extraBetween: (row) => [
      {
        key: 'menu',
        label: '菜单权限',
        hidden: !hasPermission('system:role:assign'),
        onClick: () => openMenuModal(row),
      },
    ],
    extraAfter: (row) => [
      {
        key: 'users',
        label: '分配用户',
        hidden: !hasPermission('system:role:assign'),
        onClick: () => openUserModal(row),
      },
      {
        key: 'dataScope',
        label: '数据权限',
        hidden: !hasPermission('system:role:update'),
        onClick: () => openDataScopeModal(row),
      },
    ],
    width: 260,
    desktopInlineKeys: ['edit', 'menu', 'delete'],
  });

  const columns: ColumnProps<Role>[] = [
    { title: '角色名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    { title: '角色编码', dataIndex: 'code', width: 160, render: renderEllipsis },
    { title: '描述', dataIndex: 'description', minWidth: 200, render: (_v, record) => renderEllipsis(record.description) },
    {
      title: '数据权限',
      dataIndex: 'dataScope',
      width: 140,
      align: 'center',
      render: (v: string) => {
        const map: Record<string, string> = { all: '全部数据', dept: '本部门及以下', self: '仅本人数据' };
        return map[v] ?? v;
      },
    },
    {
      title: '用户',
      dataIndex: 'userPreview',
      width: 180,
      render: (_: unknown, record: Role) => <UserPreviewCell preview={record.userPreview} count={record.userCount} scope={{ type: 'role', id: record.id, name: record.name }} />,
    },
    createdAtColumn,
    status.column(),
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'status', ['startTime', 'endTime']]}
        overrides={{
          startTime: (p) => <DateRangeFilter placeholder={["开始时间", "结束时间"]} {...p.bindRange(['startTime', 'endTime'])} />,
        }}
        create={<CreateButton permission="system:role:create" onClick={roleModal.openCreate} />}
        actions={<ExportButton entity="system.roles" query={filterQuery} pageIds={tableProps.dataSource?.map(row => row.id)} />}
        filterTitle="角色筛选"
        actionTitle="角色操作"
      />

      <ConfigurableTable<Role>
        columns={columns}
        {...tableProps}
      />

      {/* 创建/编辑 Modal */}
      <EditFormModal modal={roleModal} width={480}>
        <Form.Input field="name" label="角色名称" placeholder="请输入角色名称" rules={[{ required: true, message: '请输入角色名称' }]} />
        <Form.Input field="code" label="角色编码" placeholder="请输入角色编码" rules={[{ required: true, message: '请输入角色编码' }]} />
        <Form.Input field="description" label="描述" placeholder="请输入描述" />
        <Form.TreeSelect
          field="deptScopeIds"
          label="管理范围"
          placeholder="默认全员（用于工作流「角色」审批人按部门过滤）"
          multiple
          filterTreeNode
          treeData={departmentTreeToTreeData(deptTree)}
          style={{ width: '100%' }}
        />
        <Form.Select field="status" label="状态" style={{ width: '100%' }}
          disabled={editingRole?.code === 'super_admin'}
          optionList={statusOptions}
          placeholder="请选择状态"
        />
      </EditFormModal>

      {/* 菜单权限 Modal */}
      <AppModal
        title={`分配菜单权限 — ${menuRole?.name}`}
        visible={menuModalVisible}
        onCancel={() => setMenuModalVisible(false)}
        onOk={handleAssignMenus}
        okButtonProps={{ disabled: !menuRoleDetailQuery.isSuccess, loading: assignMenusMutation.isPending }}
        width={640}
      >
        <MenuPermissionPanel
          allMenus={menuTreeQuery.data ?? []}
          checkedMenuIds={checkedMenuIds}
          onChange={setCheckedMenuIds}
          loading={menuTreeQuery.isFetching || menuRoleDetailQuery.isFetching}
        />
      </AppModal>

      {/* 数据权限 Modal */}
      <AppModal
        title={`数据权限 — ${dataScopeRole?.name}`}
        visible={dataScopeModalVisible}
        onCancel={() => setDataScopeModalVisible(false)}
        onOk={handleSaveDataScope}
        okButtonProps={{ disabled: !dataScopeRoleDetailQuery.isSuccess, loading: updateDataScopeMutation.isPending }}
        width={400}
      >
        <DataScopePanel
          dataScope={selectedDataScope}
          deptScopeIds={selectedDeptScopeIds}
          deptTree={deptTree}
          onScopeChange={(v) => setSelectedDataScope(v ?? 'all')}
          onDeptIdsChange={setSelectedDeptScopeIds}
          loading={deptTreeQuery.isFetching || dataScopeRoleDetailQuery.isFetching}
        />
      </AppModal>

      {/* 分配用户 SideSheet */}
      <SideSheet
        title={<span>分配用户 — {userRole?.name}</span>}
        visible={userModalVisible}
        onCancel={() => setUserModalVisible(false)}
        width={720}
        footer={(
          <ModalFooter
            onCancel={() => setUserModalVisible(false)}
            onOk={handleAssignUsers}
            okText="保存"
            loading={assignUsersMutation.isPending}
            disabled={!roleUsersQuery.isSuccess || !allUsersQuery.isSuccess}
          />
        )}
      >
        {allUsersQuery.isFetching || roleUsersQuery.isFetching ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <UserTransferSelect
            dataSource={allUsers}
            value={assignedUserIds}
            onChange={ids => {
              const admin = userRole?.code === 'super_admin' && userRole.tenantId == null
                ? roleUsersQuery.data?.find(user => user.username.trim().toLowerCase() === 'admin') : undefined;
              if (admin && !ids.includes(admin.id)) {
                Toast.warning('不能移除 admin 管理员用户的超级管理员角色');
                return;
              }
              setAssignedUserIds(ids);
            }}
            departments={flatDepts}
          />
        )}
      </SideSheet>
    </div>
  );
}
