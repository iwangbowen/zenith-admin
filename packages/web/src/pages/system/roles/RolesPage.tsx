import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Button,
  Dropdown,
  SplitButtonGroup,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Spin,
  Switch,
  DatePicker,
  Avatar,
  AvatarGroup,
  Tag,
  SideSheet,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download, MoreHorizontal, ChevronDown } from 'lucide-react';
import type { Role, Menu, Department, PaginatedResponse, User } from '@zenith/shared';
import { request } from '@/utils/request';
import { UserTransferSelect } from '@/components/UserTransferSelect';
import type { UserTransferUser } from '@/components/UserTransferSelect';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { MenuPermissionPanel } from '@/components/permissions/MenuPermissionPanel';
import { DataScopePanel } from '@/components/permissions/DataScopePanel';
import { usePagination } from '@/hooks/usePagination';

export default function RolesPage() {
  const { hasPermission } = usePermission();
  interface SearchParams {
    keyword: string;
    status: string;
    timeRange: [Date, Date] | null;
  }

  const defaultSearchParams: SearchParams = { keyword: '', status: '', timeRange: null };
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<Role[]>([]);
  const { items: statusItems } = useDictItems('common_status');
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportCsvLoading, setExportCsvLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [total, setTotal] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [menuRole, setMenuRole] = useState<Role | null>(null);
  const [allMenus, setAllMenus] = useState<Menu[]>([]);
  const [checkedMenuIds, setCheckedMenuIds] = useState<number[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [userModalVisible, setUserModalVisible] = useState(false);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [allUsers, setAllUsers] = useState<UserTransferUser[]>([]);
  const [assignedUserIds, setAssignedUserIds] = useState<number[]>([]);
  const [userModalLoading, setUserModalLoading] = useState(false);
  const [dataScopeModalVisible, setDataScopeModalVisible] = useState(false);
  const [dataScopeRole, setDataScopeRole] = useState<Role | null>(null);
  const [selectedDataScope, setSelectedDataScope] = useState<string>('all');
  const [selectedDeptScopeIds, setSelectedDeptScopeIds] = useState<number[]>([]);
  const [dataScopeLoading, setDataScopeLoading] = useState(false);
  const [deptTree, setDeptTree] = useState<Department[]>([]);

  const fetchRoles = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const activeParams = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        ...(activeParams.keyword ? { keyword: activeParams.keyword } : {}),
        ...(activeParams.status ? { status: activeParams.status } : {}),
        ...(activeParams.timeRange
          ? {
            startTime: formatDateTimeForApi(activeParams.timeRange[0]),
            endTime: formatDateTimeForApi(activeParams.timeRange[1]),
          }
          : {}),
        page: String(p),
        pageSize: String(ps),
      }).toString();
      const url = query ? `/api/roles?${query}` : '/api/roles';
      const res = await request.get<PaginatedResponse<Role>>(url);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => { void fetchRoles(); }, [fetchRoles]);

  // 加载部门树（用于管理范围选择）
  useEffect(() => {
    void (async () => {
      const res = await request.get<Department[]>('/api/departments');
      if (res.code === 0) setDeptTree(res.data);
    })();
  }, []);

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
    void fetchRoles(1, pageSize);
  }

  function handleReset() {
    setPage(1);
    setSearchParams(defaultSearchParams);
    void fetchRoles(1, pageSize, defaultSearchParams);
  }

  const handleExportExcel = async () => {
    setExportLoading(true);
    try {
      await request.download('/api/roles/export', '角色列表.xlsx');
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportCsv = async () => {
    setExportCsvLoading(true);
    try {
      await request.download('/api/roles/export/csv', '角色列表.csv');
    } finally {
      setExportCsvLoading(false);
    }
  };

  // 拉取菜单树（用于分配权限）
  const openMenuModal = async (role: Role) => {
    setMenuRole(role);
    setMenuModalVisible(true);
    setMenuLoading(true);
    try {
      const [menusRes, roleRes] = await Promise.all([
        request.get<Menu[]>('/api/menus'),
        request.get<Role>(`/api/roles/${role.id}`),
      ]);
      if (menusRes.code === 0) {
        setAllMenus(menusRes.data);
      }
      if (roleRes.code === 0) setCheckedMenuIds(roleRes.data.menuIds ?? []);
    } finally {
      setMenuLoading(false);
    }
  };

  const handleAssignMenus = async () => {
    if (!menuRole) return;
    const res = await request.put(`/api/roles/${menuRole.id}/menus`, { menuIds: checkedMenuIds });
    if (res.code === 0) {
      Toast.success('菜单权限已更新');
      setMenuModalVisible(false);
    }
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

  const openUserModal = async (role: Role) => {
    setUserRole(role);
    setUserModalVisible(true);
    setUserModalLoading(true);
    try {
      const [usersRes, assignedRes] = await Promise.all([
        request.get<User[]>('/api/users/all'),
        request.get<User[]>(`/api/roles/${role.id}/users`),
      ]);
      if (usersRes.code === 0) setAllUsers(usersRes.data);
      if (assignedRes.code === 0) setAssignedUserIds(assignedRes.data.map((u) => u.id));
    } finally {
      setUserModalLoading(false);
    }
  };

  const handleAssignUsers = async () => {
    if (!userRole) return;
    const res = await request.put(`/api/roles/${userRole.id}/users`, { userIds: assignedUserIds });
    if (res.code === 0) {
      Toast.success('用户分配已更新');
      setUserModalVisible(false);
      void fetchRoles();
    }
  };

  const openDataScopeModal = async (role: Role) => {
    setDataScopeRole(role);
    setSelectedDataScope(role.dataScope);
    setSelectedDeptScopeIds([]);
    setDataScopeModalVisible(true);
    setDataScopeLoading(true);
    try {
      const res = await request.get<Role>(`/api/roles/${role.id}`);
      if (res.code === 0) setSelectedDeptScopeIds(res.data.deptScopeIds ?? []);
    } finally {
      setDataScopeLoading(false);
    }
  };

  const handleSaveDataScope = async () => {
    if (!dataScopeRole) return;
    const body: Record<string, unknown> = { dataScope: selectedDataScope };
    if (selectedDataScope === 'custom') {
      body.deptScopeIds = selectedDeptScopeIds;
    }
    const res = await request.put(`/api/roles/${dataScopeRole.id}`, body);
    if (res.code === 0) {
      Toast.success('数据权限已更新');
      setDataScopeModalVisible(false);
      void fetchRoles();
    }
  };

  const handleRoleModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    const res = editingRole
      ? await request.put(`/api/roles/${editingRole.id}`, values)
      : await request.post('/api/roles', values);
    if (res.code === 0) {
      Toast.success(editingRole ? '更新成功' : '创建成功');
      setModalVisible(false);
      fetchRoles();
    } else {
      throw new Error(res.message);
    }
  };

  const openEditRoleModal = async (role: Role) => {
    // 拉取含 deptScopeIds 的详情
    const res = await request.get<Role>(`/api/roles/${role.id}`);
    setEditingRole(res.code === 0 ? res.data : role);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/roles/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchRoles();
    }
  };

  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null);

  const handleToggleStatus = useCallback(async (role: Role, newStatus: 'enabled' | 'disabled') => {
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
    setTogglingStatusId(role.id);
    try {
      const res = await request.put(`/api/roles/${role.id}`, { status: newStatus });
      if (res.code === 0) {
        Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
        void fetchRoles();
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setTogglingStatusId(null);
    }
  }, [fetchRoles]);

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
      render: (_: unknown, record: Role) => {
        const preview = record.userPreview ?? [];
        const count = record.userCount ?? 0;
        if (count === 0) return <Tag color="blue">0</Tag>;
        return (
          <Space spacing={6}>
            <AvatarGroup maxCount={4} size="extra-extra-small" overlapFrom="end">
              {preview.map((m) => (
                <Avatar
                  key={m.id}
                  style={{ width: 22, height: 22, minWidth: 22, lineHeight: '22px', fontSize: 12, cursor: 'default' }}
                  src={m.avatar ?? undefined}
                  alt={m.nickname}
                  color="light-blue"
                  title={m.nickname}
                >
                  {m.nickname?.[0]}
                </Avatar>
              ))}
            </AvatarGroup>
            <Tag color="blue" style={{ flexShrink: 0 }}>{count}</Tag>
          </Space>
        );
      },
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
    {
      title: '操作',
      fixed: 'right',
      width: 320,
      align: 'center',
      render: (_v, row) => (
        <Space>
          {hasPermission('system:role:update') && <Button
            theme="borderless"
            size="small"
            onClick={() => { void openEditRoleModal(row); }}
          >
            编辑
          </Button>}
          {hasPermission('system:role:assign') && <Button theme="borderless" size="small" onClick={() => openMenuModal(row)}>
            菜单权限
          </Button>}
          {hasPermission('system:role:delete') && <Button theme="borderless" size="small" type="danger" disabled={row.code === 'super_admin'} onClick={() => {
            Modal.confirm({
              title: '确认删除此角色？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(row.id),
            });
          }}>删除</Button>}
          {(hasPermission('system:role:assign') || hasPermission('system:role:update')) && (
            <Dropdown
              trigger="click"
              position="bottomRight"
              clickToHide
              render={
                <Dropdown.Menu>
                  {hasPermission('system:role:assign') && (
                    <Dropdown.Item onClick={() => openUserModal(row)}>分配用户</Dropdown.Item>
                  )}
                  {hasPermission('system:role:update') && (
                    <Dropdown.Item onClick={() => openDataScopeModal(row)}>数据权限</Dropdown.Item>
                  )}
                </Dropdown.Menu>
              }
            >
              <span style={{ display: 'inline-block' }}>
                <Button theme="borderless" size="small" icon={<MoreHorizontal size={14} />} />
              </span>
            </Dropdown>
          )}
        </Space>
      ),
    },
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索角色名称/编码"
      value={searchParams.keyword}
      onChange={(v) => setSearchParams((prev) => ({ ...prev, keyword: v }))}
      onEnterPress={handleSearch}
      style={{ width: 220, maxWidth: '100%' }}
      showClear
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="请选择状态"
      value={searchParams.status || undefined}
      onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
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
      value={searchParams.timeRange ?? undefined}
      onChange={(value) => setSearchParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
      style={{ width: 360, maxWidth: '100%' }}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderExportButtons = () => (
    <SplitButtonGroup>
      <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={handleExportExcel}>导出</Button>
      <Dropdown
        trigger="click"
        position="bottomRight"
        clickToHide
        render={(
          <Dropdown.Menu>
            <Dropdown.Item onClick={handleExportExcel}>导出 Excel</Dropdown.Item>
            <Dropdown.Item onClick={handleExportCsv}>导出 CSV</Dropdown.Item>
          </Dropdown.Menu>
        )}
      >
        <Button type="primary" icon={<ChevronDown size={14} />} loading={exportCsvLoading} />
      </Dropdown>
    </SplitButtonGroup>
  );
  const renderMobileExportActions = () => (
    <>
      <Button icon={<Download size={14} />} loading={exportLoading} onClick={handleExportExcel}>导出 Excel</Button>
      <Button icon={<Download size={14} />} loading={exportCsvLoading} onClick={handleExportCsv}>导出 CSV</Button>
    </>
  );
  const renderCreateButton = () => hasPermission('system:role:create') ? (
    <Button
      type="primary"
      icon={<Plus size={14} />}
      onClick={() => { setEditingRole(null); setModalVisible(true); }}
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
        loading={loading}
        onRefresh={fetchRoles}
        refreshLoading={loading}
        pagination={buildPagination(total, (p, ps) => void fetchRoles(p, ps))}
      />

      {/* 创建/编辑 Modal */}
      <AppModal
        title={editingRole ? '编辑角色' : '新增角色'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleRoleModalOk}
        width={480}

      >
        <Form
          getFormApi={(api) => formApi.current = api}
          allowEmpty
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
          allMenus={allMenus}
          checkedMenuIds={checkedMenuIds}
          onChange={setCheckedMenuIds}
          loading={menuLoading}
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
          loading={dataScopeLoading}
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
            <Button type="primary" loading={userModalLoading} onClick={handleAssignUsers}>保存</Button>
          </Space>
        }
      >
        {userModalLoading ? (
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
