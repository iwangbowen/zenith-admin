import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  Button,
  Dropdown,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Tree,
  Typography,
  Spin,
  Avatar,
  DatePicker,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download, MoreHorizontal } from 'lucide-react';
import type { Role, Menu, User, Department, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';

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
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [menuRole, setMenuRole] = useState<Role | null>(null);
  const [allMenus, setAllMenus] = useState<Menu[]>([]);
  const [checkedMenuIds, setCheckedMenuIds] = useState<number[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuExpandedKeys, setMenuExpandedKeys] = useState<string[]>([]);
  const [userModalVisible, setUserModalVisible] = useState(false);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [assignedUserIds, setAssignedUserIds] = useState<number[]>([]);
  const [userModalLoading, setUserModalLoading] = useState(false);
  const [dataScopeModalVisible, setDataScopeModalVisible] = useState(false);
  const [dataScopeRole, setDataScopeRole] = useState<Role | null>(null);
  const [selectedDataScope, setSelectedDataScope] = useState<string>('all');
  const [deptTree, setDeptTree] = useState<Department[]>([]);

  const fetchRoles = useCallback(async (params = searchParams, p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.timeRange
          ? {
            startTime: formatDateTimeForApi(params.timeRange[0]),
            endTime: formatDateTimeForApi(params.timeRange[1]),
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
  }, [searchParams, page, pageSize]);

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
    void fetchRoles(searchParams, 1, pageSize);
  }

  function handleReset() {
    setPage(1);
    setSearchParams(defaultSearchParams);
    void fetchRoles(defaultSearchParams, 1, pageSize);
  }

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
        setMenuExpandedKeys(getAllMenuKeys(menusRes.data));
      }
      if (roleRes.code === 0) setCheckedMenuIds(roleRes.data.menuIds ?? []);
    } finally {
      setMenuLoading(false);
    }
  };

  function menusToTreeData(items: Menu[]): object[] {
    return items.map((m) => ({
      label: m.title,
      key: String(m.id),
      value: m.id,
      children: m.children ? menusToTreeData(m.children) : undefined,
    }));
  }

  function getAllMenuIds(items: Menu[]): number[] {
    return items.flatMap((m) => [m.id, ...(m.children ? getAllMenuIds(m.children) : [])]);
  }

  function getAllMenuKeys(items: Menu[]): string[] {
    return items.flatMap((m) => [String(m.id), ...(m.children ? getAllMenuKeys(m.children) : [])]);
  }

  const handleAssignMenus = async () => {
    if (!menuRole) return;
    const res = await request.put(`/api/roles/${menuRole.id}/menus`, { menuIds: checkedMenuIds });
    if (res.code === 0) {
      Toast.success('菜单权限已更新');
      setMenuModalVisible(false);
    }
  };

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
    }
  };

  const openDataScopeModal = (role: Role) => {
    setDataScopeRole(role);
    setSelectedDataScope(role.dataScope);
    setDataScopeModalVisible(true);
  };

  const handleSaveDataScope = async () => {
    if (!dataScopeRole) return;
    const res = await request.put(`/api/roles/${dataScopeRole.id}`, { dataScope: selectedDataScope });
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

  const columns: ColumnProps<Role>[] = [
    { title: '角色名称', dataIndex: 'name', width: 160, render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
    { title: '角色编码', dataIndex: 'code', width: 160, render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
    { title: '描述', dataIndex: 'description', width: 200, render: (v) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{}</Typography.Text> },
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
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      fixed: 'right',
      render: (v: string) => <DictTag dictCode="common_status" value={v} />,
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
          {hasPermission('system:role:delete') && <Button theme="borderless" size="small" type="danger" onClick={() => {
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

  return (
    <div className="page-container">
      <SearchToolbar>
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索角色名称/编码"
            value={searchParams.keyword}
            onChange={(v) => setSearchParams((prev) => ({ ...prev, keyword: v }))}
            onEnterPress={handleSearch}
            style={{ width: 220 }}
            showClear
          />
          <Select
            placeholder="请选择状态"
            value={searchParams.status || undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
            style={{ width: 140 }}
            optionList={[
              { value: '', label: '全部状态' },
              ...statusItems.map((item) => ({ value: item.value, label: item.label })),
            ]}
          />
          <DatePicker
            type="dateTimeRange"
            placeholder={["开始时间", "结束时间"]}
            value={searchParams.timeRange ?? undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
            style={{ width: 360 }}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/roles/export', '角色列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          {hasPermission('system:role:create') && <Button
            type="primary"
            icon={<Plus size={14} />}
            onClick={() => { setEditingRole(null); setModalVisible(true); }}
          >
            新增
          </Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: (p) => { setPage(p); void fetchRoles(searchParams, p, pageSize); },
          onPageSizeChange: (s) => { setPage(1); setPageSize(s); void fetchRoles(searchParams, 1, s); },
          showSizeChanger: true,
        }}
      />

      {/* 创建/编辑 Modal */}
      <Modal
        title={editingRole ? '编辑角色' : '新增角色'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleRoleModalOk}
        width={480}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          getFormApi={(api) => formApi.current = api}
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
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
            placeholder="请选择状态"
          />
        </Form>
      </Modal>

      {/* 菜单权限 Modal */}
      <Modal
        title={`分配菜单权限 — ${menuRole?.name}`}
        visible={menuModalVisible}
        onCancel={() => setMenuModalVisible(false)}
        onOk={handleAssignMenus}
        width={480}
        bodyStyle={{ paddingBottom: 24 }}
      >
        {menuLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Space>
                <Button size="small" theme="borderless" onClick={() => setCheckedMenuIds(getAllMenuIds(allMenus))}>全选</Button>
                <Button size="small" theme="borderless" onClick={() => setCheckedMenuIds([])}>全不选</Button>
              </Space>
              <Space>
                <Button size="small" theme="borderless" onClick={() => setMenuExpandedKeys(getAllMenuKeys(allMenus))}>展开全部</Button>
                <Button size="small" theme="borderless" onClick={() => setMenuExpandedKeys([])}>折叠全部</Button>
              </Space>
            </div>
            <Tree
              treeData={menusToTreeData(allMenus)}
              multiple
              expandedKeys={menuExpandedKeys}
              onExpand={(keys) => setMenuExpandedKeys(keys)}
              value={checkedMenuIds.map(String)}
              onChange={(keys) => setCheckedMenuIds((keys as string[]).map(Number))}
              style={{ maxHeight: 400, overflow: 'auto' }}
            />
          </>
        )}
      </Modal>

      {/* 数据权限 Modal */}
      <Modal
        title={`数据权限 — ${dataScopeRole?.name}`}
        visible={dataScopeModalVisible}
        onCancel={() => setDataScopeModalVisible(false)}
        onOk={handleSaveDataScope}
        width={400}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Select
          value={selectedDataScope}
          onChange={(v) => setSelectedDataScope(v as string)}
          style={{ width: '100%' }}
          optionList={[
            { value: 'all', label: '全部数据' },
            { value: 'dept', label: '本部门及以下' },
            { value: 'self', label: '仅本人数据' },
          ]}
        />
      </Modal>

      {/* 分配用户 Modal */}
      <Modal
        title={`分配用户 — ${userRole?.name}`}
        visible={userModalVisible}
        onCancel={() => setUserModalVisible(false)}
        onOk={handleAssignUsers}
        width={560}
        bodyStyle={{ paddingBottom: 0 }}
      >
        {userModalLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={allUsers}
            pagination={false}
            rowSelection={{
              selectedRowKeys: assignedUserIds,
              onChange: (keys) => setAssignedUserIds(keys as number[]),
            }}
            style={{ maxHeight: 400, overflow: 'auto' }}
            columns={[
              {
                title: '用户',
                render: (_: unknown, u: User) => (
                  <Space>
                    <Avatar size="extra-small" style={{ backgroundColor: u.avatar ? undefined : 'var(--semi-color-primary)', color: '#fff', fontSize: 11 }} src={u.avatar || undefined}>
                      {u.nickname?.charAt(0)?.toUpperCase() || 'U'}
                    </Avatar>
                    <span>{u.nickname}（{u.username}）</span>
                  </Space>
                ),
              },
              { title: '邮箱', dataIndex: 'email', render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
