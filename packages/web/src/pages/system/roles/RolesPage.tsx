import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Spin,
  Switch,
  DatePicker,
  SideSheet,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw } from 'lucide-react';
import type { Role, Department } from '@zenith/shared';
import { UserTransferSelect } from '@/components/UserTransferSelect';
import type { UserTransferUser } from '@/components/UserTransferSelect';
import { SearchToolbar } from '@/components/SearchToolbar';
import { UserPreviewCell } from '@/components/UserPreviewCell';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { MenuPermissionPanel } from '@/components/permissions/MenuPermissionPanel';
import { DataScopePanel } from '@/components/permissions/DataScopePanel';
import { usePagination } from '@/hooks/usePagination';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useDepartmentTree } from '@/hooks/queries/departments';
import { useMenuTree } from '@/hooks/queries/menus';
import { useAllUsers } from '@/hooks/queries/users';
import {
  roleKeys,
  useAssignRoleMenus,
  useAssignRoleUsers,
  useDeleteRole,
  useRoleDetail,
  useRoleList,
  useRoleUsers,
  useSaveRole,
  useUpdateRoleDataScope,
} from '@/hooks/queries/roles';

export default function RolesPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  interface SearchParams {
    keyword: string;
    status: string;
    timeRange: [Date, Date] | null;
  }

  const defaultSearchParams: SearchParams = { keyword: '', status: '', timeRange: null };
  const formApi = useRef<FormApi | null>(null);
  const { items: statusItems } = useDictItems('common_status');
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Role | null>(null);
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

  const listQuery = useRoleList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    startTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[0]) : undefined,
    endTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[1]) : undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const editDetailQuery = useRoleDetail(editingRecord?.id, modalVisible);
  const editingRole = editingRecord ? (editDetailQuery.data ?? editingRecord) : null;
  const menuTreeQuery = useMenuTree({ enabled: menuModalVisible });
  const menuRoleDetailQuery = useRoleDetail(menuRole?.id, menuModalVisible);
  const allUsersQuery = useAllUsers({ enabled: userModalVisible });
  const roleUsersQuery = useRoleUsers(userRole?.id, userModalVisible);
  const dataScopeRoleDetailQuery = useRoleDetail(dataScopeRole?.id, dataScopeModalVisible);
  const deptTreeQuery = useDepartmentTree();
  const deptTree = useMemo(() => deptTreeQuery.data ?? [], [deptTreeQuery.data]);

  const saveMutation = useSaveRole();
  const toggleStatusMutation = useSaveRole();
  const deleteMutation = useDeleteRole();
  const assignMenusMutation = useAssignRoleMenus();
  const assignUsersMutation = useAssignRoleUsers();
  const updateDataScopeMutation = useUpdateRoleDataScope();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

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

  function deptsToTreeData(items: Department[]): object[] {
    return items.map((d) => ({
      label: d.name,
      key: String(d.id),
      value: d.id,
      children: d.children ? deptsToTreeData(d.children) : undefined,
    }));
  }

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: roleKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: roleKeys.lists });
  }

  const openMenuModal = (role: Role) => {
    setMenuRole(role);
    setMenuModalVisible(true);
  };

  const handleAssignMenus = async () => {
    if (!menuRole) return;
    await assignMenusMutation.mutateAsync({ id: menuRole.id, menuIds: checkedMenuIds });
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
    await assignUsersMutation.mutateAsync({ id: userRole.id, userIds: assignedUserIds });
    Toast.success('用户分配已更新');
    setUserModalVisible(false);
  };

  const openDataScopeModal = (role: Role) => {
    setDataScopeRole(role);
    setSelectedDataScope(role.dataScope);
    setSelectedDeptScopeIds([]);
    setDataScopeModalVisible(true);
  };

  const handleSaveDataScope = async () => {
    if (!dataScopeRole) return;
    const body: Record<string, unknown> = { dataScope: selectedDataScope };
    if (selectedDataScope === 'custom') {
      body.deptScopeIds = selectedDeptScopeIds;
    }
    await updateDataScopeMutation.mutateAsync({ id: dataScopeRole.id, values: body as Partial<Role> });
    Toast.success('数据权限已更新');
    setDataScopeModalVisible(false);
  };

  const handleRoleModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  };

  const openEditRoleModal = (role: Role) => {
    setEditingRecord(role);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const handleToggleStatus = async (role: Role, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用角色「${role.name}」？`,
          content: '禁用后持有该角色的用户将不能登录。',
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    await toggleStatusMutation.mutateAsync({ id: role.id, values: { status: newStatus } });
    Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
  };

  const columns: ColumnProps<Role>[] = [
    { title: '角色名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    { title: '角色编码', dataIndex: 'code', width: 160, render: renderEllipsis },
    { title: '描述', dataIndex: 'description', width: 200, render: (_v, record) => renderEllipsis(record.description) },
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
      render: (_: unknown, record: Role) => <UserPreviewCell preview={record.userPreview} count={record.userCount} />,
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      fixed: 'right',
      render: (v: string, record: Role) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={record.code === 'super_admin' || !hasPermission('system:role:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<Role>({
      width: 320,
      desktopInlineKeys: ['edit', 'menu', 'delete'],
      actions: (row) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:role:update'),
          onClick: () => openEditRoleModal(row),
        },
        {
          key: 'menu',
          label: '菜单权限',
          hidden: !hasPermission('system:role:assign'),
          onClick: () => openMenuModal(row),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:role:delete'),
          disabled: row.code === 'super_admin',
          disabledReason: '超级管理员角色不允许删除',
          onClick: () => {
            Modal.confirm({
              title: '确认删除此角色？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(row.id),
            });
          },
        },
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
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索角色名称/编码"
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((prev) => ({ ...prev, keyword: v }))}
      onEnterPress={handleSearch}
      style={{ width: 220, maxWidth: '100%' }}
      showClear
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="请选择状态"
      value={draftParams.status || undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
      style={{ width: 140, maxWidth: '100%' }}
      optionList={[
        { value: '', label: '全部状态' },
        ...statusItems.map((item) => ({ value: item.value, label: item.label })),
      ]}
    />
  );

  const renderTimeRangeFilter = () => (
    <DatePicker
      type="dateTimeRange"
      placeholder={["开始时间", "结束时间"]}
      value={draftParams.timeRange ?? undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
      style={{ width: 360, maxWidth: '100%' }}
    />
  );

  const buildExportQuery = () => ({
    ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
    ...(submittedParams.status ? { status: submittedParams.status } : {}),
    ...(submittedParams.timeRange
      ? {
          startTime: formatDateTimeForApi(submittedParams.timeRange[0]),
          endTime: formatDateTimeForApi(submittedParams.timeRange[1]),
        }
      : {}),
  });

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderExportButtons = () => <ExportButton entity="system.roles" query={buildExportQuery()} />;
  const renderMobileExportActions = () => <ExportButton entity="system.roles" query={buildExportQuery()} variant="flat" />;
  const renderCreateButton = () => hasPermission('system:role:create') ? (
    <Button
      type="primary"
      icon={<Plus size={14} />}
      onClick={() => { setEditingRecord(null); setModalVisible(true); }}
    >
      新增
    </Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderTimeRangeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderExportButtons()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderStatusFilter()}
            {renderTimeRangeFilter()}
          </>
        )}
        mobileActions={renderMobileExportActions()}
        filterTitle="角色筛选"
        actionTitle="角色操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      {/* 创建/编辑 Modal */}
      <AppModal
        title={editingRole ? '编辑角色' : '新增角色'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        onOk={handleRoleModalOk}
        okButtonProps={{ disabled: !!editingRecord && editDetailQuery.isFetching }}
        width={480}

      >
        <Form
          getFormApi={(api) => formApi.current = api}
          allowEmpty
          key={editingRole?.id ?? 'new-role'}
          initValues={editingRole ?? { status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="角色名称" placeholder="请输入角色名称" rules={[{ required: true, message: '请输入角色名称' }]} />
          <Form.Input field="code" label="角色编码" placeholder="请输入角色编码" rules={[{ required: true, message: '请输入角色编码' }]} />
          <Form.Input field="description" label="描述" placeholder="请输入描述" />
          <Form.TreeSelect
            field="deptScopeIds"
            label="管理范围"
            placeholder="默认全员（用于工作流「角色」审批人按部门过滤）"
            multiple
            filterTreeNode
            treeData={deptsToTreeData(deptTree)}
            style={{ width: '100%' }}
          />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            disabled={editingRole?.code === 'super_admin'}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
            placeholder="请选择状态"
          />
        </Form>
      </AppModal>

      {/* 菜单权限 Modal */}
      <AppModal
        title={`分配菜单权限 — ${menuRole?.name}`}
        visible={menuModalVisible}
        onCancel={() => setMenuModalVisible(false)}
        onOk={handleAssignMenus}
        width={480}
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
        footer={
          <Space>
            <Button onClick={() => setUserModalVisible(false)}>取消</Button>
            <Button type="primary" loading={assignUsersMutation.isPending} onClick={handleAssignUsers}>保存</Button>
          </Space>
        }
      >
        {allUsersQuery.isFetching || roleUsersQuery.isFetching ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <UserTransferSelect
            dataSource={allUsers}
            value={assignedUserIds}
            onChange={setAssignedUserIds}
            departments={flatDepts}
          />
        )}
      </SideSheet>
    </div>
  );
}
