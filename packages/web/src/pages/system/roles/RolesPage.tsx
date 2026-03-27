import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  Button,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Tree,
  Spin,
  Avatar,
  DatePicker,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download } from 'lucide-react';
import type { Role, Menu, User } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime } from '@/utils/date';
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
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [menuRole, setMenuRole] = useState<Role | null>(null);
  const [allMenus, setAllMenus] = useState<Menu[]>([]);
  const [checkedMenuIds, setCheckedMenuIds] = useState<number[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [userModalVisible, setUserModalVisible] = useState(false);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [assignedUserIds, setAssignedUserIds] = useState<number[]>([]);
  const [userModalLoading, setUserModalLoading] = useState(false);

  const fetchRoles = useCallback(async (params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.timeRange
          ? {
            startTime: params.timeRange[0].toISOString(),
            endTime: params.timeRange[1].toISOString(),
          }
          : {}),
      }).toString();
      const url = query ? `/api/roles?${query}` : '/api/roles';
      const res = await request.get<Role[]>(url);
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => { void fetchRoles(); }, [fetchRoles]);

  function handleSearch() {
    void fetchRoles();
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    void fetchRoles(defaultSearchParams);
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
      if (menusRes.code === 0) setAllMenus(menusRes.data);
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
        request.get<{ list: User[] }>('/api/users?page=1&pageSize=1000'),
        request.get<User[]>(`/api/roles/${role.id}/users`),
      ]);
      if (usersRes.code === 0) setAllUsers(usersRes.data.list);
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

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/roles/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchRoles();
    }
  };

  const columns: ColumnProps<Role>[] = [
    { title: '角色名称', dataIndex: 'name', width: 160, ellipsis: true },
    { title: '角色编码', dataIndex: 'code', width: 160, ellipsis: true },
    { title: '描述', dataIndex: 'description', ellipsis: true, render: (v) => v || '—' },
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
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      render: (v: string) => <DictTag dictCode="common_status" value={v} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      ellipsis: true,
      render: (v) => formatDateTime(v),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 360,
      align: 'center',
      render: (_v, row) => (
        <Space>
          {hasPermission('system:role:assign') && <Button theme="borderless" size="small" onClick={() => openMenuModal(row)}>
            菜单权限
          </Button>}
          {hasPermission('system:role:assign') && <Button theme="borderless" size="small" onClick={() => openUserModal(row)}>
            分配用户
          </Button>}
          {hasPermission('system:role:update') && <Button
            theme="borderless"
            size="small"
            onClick={() => { setEditingRole(row); setModalVisible(true); }}
          >
            编辑
          </Button>}
          {hasPermission('system:role:delete') && <Button theme="borderless" size="small" type="danger" onClick={() => {
            Modal.confirm({
              title: '确认删除此角色？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(row.id),
            });
          }}>删除</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        left={<>
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
        </>}
        right={<Space>
          <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/roles/export', '角色列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          {hasPermission('system:role:create') && <Button
            type="secondary"
            icon={<Plus size={14} />}
            onClick={() => { setEditingRole(null); setModalVisible(true); }}
          >
            新增
          </Button>}
        </Space>}
      />

      <Table
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true }}
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
          initValues={editingRole ?? { status: 'active' }}
          labelPosition="left"
          labelWidth={80}
        >
          <Form.Input field="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]} />
          <Form.Input field="code" label="角色编码" rules={[{ required: true, message: '请输入角色编码' }]} />
          <Form.Input field="description" label="描述" />
          <Form.Select field="status" label="状态"
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
          />
          <Form.Select field="dataScope" label="数据权限"
            optionList={[
              { value: 'all', label: '全部数据' },
              { value: 'dept', label: '本部门及以下' },
              { value: 'self', label: '仅本人数据' },
            ]}
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
          <Tree
            treeData={menusToTreeData(allMenus)}
            multiple
            defaultExpandAll
            value={checkedMenuIds.map(String)}
            onChange={(keys) => setCheckedMenuIds((keys as string[]).map(Number))}
            style={{ maxHeight: 400, overflow: 'auto' }}
          />
        )}
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
                    <Avatar size="extra-small" color="blue" style={{ fontSize: 11 }}>
                      {u.nickname?.charAt(0)?.toUpperCase() || 'U'}
                    </Avatar>
                    <span>{u.nickname}（{u.username}）</span>
                  </Space>
                ),
              },
              { title: '邮箱', dataIndex: 'email', ellipsis: true },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
