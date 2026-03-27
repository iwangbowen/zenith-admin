import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Table,
  Button,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Avatar,
  Tag,
  DatePicker,
  Upload,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download, Trash2, FileUp } from 'lucide-react';
import type { User, Role, PaginatedResponse, Department, Position } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { formatPasswordPolicyHint, type PasswordPolicy } from '@/utils/password-policy';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import './UsersPage.css';

interface SearchParams {
  keyword: string;
  status: string;
  timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '', timeRange: null };

export default function UsersPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const passwordFormApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<PaginatedResponse<User> | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [allPositions, setAllPositions] = useState<Position[]>([]);
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(null);

  const { items: statusItems } = useDictItems('common_status');
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  interface ImportResult {
    total: number;
    success: number;
    failed: number;
    errors: Array<{ row: number; message: string }>;
  }

  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const importFileRef = useRef<File | null>(null);

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个用户？`,
      content: '删除后无法恢复，请谨慎操作。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>('/api/users/batch', { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success('批量删除成功');
          setSelectedRowKeys([]);
          void fetchUsers();
        }
      },
    });
  };

  useEffect(() => {
    Promise.all([
      request.get<Role[]>('/api/roles'),
      request.get<Department[]>('/api/departments/flat'),
      request.get<Position[]>('/api/positions'),
    ]).then(([rolesRes, departmentsRes, positionsRes]) => {
      if (rolesRes.code === 0) setAllRoles(rolesRes.data);
      if (departmentsRes.code === 0) setAllDepartments(departmentsRes.data);
      if (positionsRes.code === 0) setAllPositions(positionsRes.data);
    });
    request.get<PasswordPolicy>('/api/system-configs/password-policy').then((res) => {
      if (res.code === 0) setPasswordPolicy(res.data);
    });
  }, []);

  const departmentTreeData = useMemo<TreeNodeData[]>(
    () => {
      const nodeMap = new Map<number, TreeNodeData>();
      const rootNodes: TreeNodeData[] = [];

      allDepartments.forEach((item) => {
        nodeMap.set(item.id, {
          key: String(item.id),
          value: item.id,
          label: item.name,
          children: [],
        });
      });

      allDepartments.forEach((item) => {
        const currentNode = nodeMap.get(item.id);
        if (!currentNode) return;

        const parentNode = item.parentId ? nodeMap.get(item.parentId) : undefined;
        if (parentNode) {
          parentNode.children = [...(parentNode.children ?? []), currentNode];
          return;
        }

        rootNodes.push(currentNode);
      });

      return rootNodes;
    },
    [allDepartments]
  );

  const positionOptionList = useMemo(
    () => allPositions.map((item) => ({ value: item.id, label: item.name })),
    [allPositions]
  );

  const formInitValues = editingUser
    ? {
        username: editingUser.username,
        nickname: editingUser.nickname,
        email: editingUser.email,
        departmentId: editingUser.departmentId ?? undefined,
        positionIds: editingUser.positionIds ?? editingUser.positions?.map((item) => item.id) ?? [],
        roleIds: editingUser.roles.map((r) => r.id),
        status: editingUser.status,
      }
    : {
        positionIds: [],
        roleIds: [],
        status: 'active',
      };

  const fetchUsers = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.timeRange
          ? {
              startTime: params.timeRange[0].toISOString(),
              endTime: params.timeRange[1].toISOString(),
            }
          : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<User>>(`/api/users?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
        setPageSize(res.data.pageSize);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  function handleSearch() {
    setPage(1);
    void fetchUsers(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchUsers(1, pageSize, defaultSearchParams);
  }

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current?.validate();
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');

    const payload = {
      ...values,
      departmentId: values.departmentId ?? null,
      positionIds: values.positionIds ?? [],
      roleIds: values.roleIds ?? [],
    };

    const res = editingUser
      ? await request.put(`/api/users/${editingUser.id}`, payload)
      : await request.post('/api/users', payload);
    if (res.code === 0) {
      Toast.success(editingUser ? '更新成功' : '创建成功');
      setModalVisible(false);
      setEditingUser(null);
      void fetchUsers();
    } else {
      throw new Error(res.message);
    }
  };

  const handlePasswordModalOk = async () => {
    let values;
    try {
      values = await passwordFormApi.current?.validate();
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');

    if (values.password !== values.confirmPassword) {
      Toast.error('两次密码输入不一致');
      throw new Error('password_not_match');
    }

    if (!passwordUser) {
      throw new Error('missing_user');
    }

    const res = await request.put(`/api/users/${passwordUser.id}/password`, { password: values.password });
    if (res.code === 0) {
      Toast.success('密码修改成功');
      setPasswordModalVisible(false);
      setPasswordUser(null);
    } else {
      throw new Error(res.message);
    }
  };

  const handleImportTemplate = async () => {
    try {
      await request.download('/api/users/import-template', 'user_import_template.xlsx');
    } catch {
      Toast.error('模板下载失败');
    }
  };

  const handleImportSubmit = async () => {
    if (!importFileRef.current) {
      Toast.warning('请先选择文件');
      return;
    }
    setImportLoading(true);
    const formData = new FormData();
    formData.append('file', importFileRef.current);
    try {
      const res = await request.postForm<ImportResult>('/api/users/import', formData);
      if (res.code === 0) {
        setImportResult(res.data);
        if (res.data.success > 0) void fetchUsers();
      } else {
        Toast.error(res.message);
      }
    } catch {
      Toast.error('导入请求失败');
    } finally {
      setImportLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/users/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchUsers();
    }
  };

  const handleUnlock = async (id: number) => {
    const res = await request.post(`/api/users/${id}/unlock`, {});
    if (res.code === 0) {
      Toast.success('解锁成功');
    }
  };

  const columns: ColumnProps<User>[] = [
    {
      title: '用户',
      dataIndex: 'nickname',
      width: 260,
      ellipsis: { showTitle: false },
      render: (_: unknown, record: User) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Avatar size="extra-small" color="blue" style={{ fontSize: 11 }}>
            {record.nickname?.charAt(0)?.toUpperCase() || 'U'}
          </Avatar>
          <span className="table-cell-ellipsis" title={`${record.nickname}（${record.username}）`}>
            {record.nickname}（{record.username}）
          </span>
        </div>
      ),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 220,
      ellipsis: true,
    },
    {
      title: '部门',
      dataIndex: 'departmentName',
      width: 160,
      ellipsis: true,
      render: (value: string | null | undefined) => value || '—',
    },
    {
      title: '岗位',
      dataIndex: 'positions',
      width: 220,
      render: (positions: Position[] | undefined) => {
        const list = positions ?? [];
        return (
          <Space spacing={4} wrap>
            {list.length === 0 ? <Tag color="grey">无岗位</Tag> : list.map((item) => (
              <Tag key={item.id} color="purple">{item.name}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 180,
      render: (roles: Role[]) => (
        <Space spacing={4} wrap>
          {roles.length === 0 ? <Tag color="grey">无角色</Tag> : roles.map((r) => (
            <Tag key={r.id} color="blue">{r.name}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => <DictTag dictCode="common_status" value={status} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      ellipsis: true,
      render: (t: string) => formatDateTime(t),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 280,
      render: (_: unknown, record: User) => (
        <Space>
          {hasPermission('system:user:update') && <Button
            theme="borderless"
            size="small"
            onClick={() => {
              setPasswordUser(record);
              setPasswordModalVisible(true);
            }}
          >修改密码</Button>}
          {hasPermission('system:user:update') && <Button
            theme="borderless"
            size="small"
            onClick={() => handleUnlock(record.id)}
          >解锁</Button>}
          {hasPermission('system:user:update') && <Button
            theme="borderless"
            size="small"
            onClick={() => {
              setEditingUser(record);
              setModalVisible(true);
            }}
          >编辑</Button>}
          {hasPermission('system:user:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => {
            Modal.confirm({
              title: '确定要删除该用户吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
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
            placeholder="搜索用户名/昵称/邮箱"
            value={searchParams.keyword}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
            onEnterPress={handleSearch}
            style={{ width: 260 }}
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
          {selectedRowKeys.length > 0 && hasPermission('system:user:delete') && (
            <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
              批量删除 ({selectedRowKeys.length})
            </Button>
          )}
          <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/users/export', '用户列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          {hasPermission('system:user:import') && (
            <Button
              type="secondary"
              icon={<FileUp size={14} />}
              onClick={() => { setImportModalVisible(true); setImportResult(null); importFileRef.current = null; }}
            >导入</Button>
          )}
          {hasPermission('system:user:create') && <Button
            type="secondary"
            icon={<Plus size={14} />}
            onClick={() => {
              setEditingUser(null);
              setModalVisible(true);
            }}
          >
            新增
          </Button>}
        </Space>}
      />

      <Table
        className="admin-table-nowrap"
        bordered
        columns={columns}
        dataSource={data?.list || []}
        loading={loading}
        pagination={{
          currentPage: page,
          pageSize,
          total: data?.total || 0,
          onPageChange: (currentPage) => { void fetchUsers(currentPage, pageSize); },
          onPageSizeChange: (size) => { void fetchUsers(1, size); },
          showTotal: true,
          showSizeChanger: true,
        }}
        rowKey="id"
        size="small"
        empty="暂无数据"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        }}
      />

      <Modal
        title={editingUser ? '编辑用户' : '新增用户'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingUser(null);
        }}
        onOk={handleModalOk}
        width={520}
        closeOnEsc
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          key={editingUser?.id ?? 'new-user'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={80}
        >
          {!editingUser && (
            <Form.Input field="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]} />
          )}
          <Form.Input field="nickname" label="昵称" rules={[{ required: true, message: '请输入昵称' }]} />
          <Form.Input field="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }]} />
          {!editingUser && (
            <Form.Input
              field="password"
              label="密码"
              type="password"
              rules={[{ required: true, message: '请输入密码' }]}
              helpText={formatPasswordPolicyHint(passwordPolicy)}
            />
          )}
          <Form.TreeSelect
            field="departmentId"
            label="所属部门"
            style={{ width: '100%' }}
            treeData={departmentTreeData}
            placeholder="请选择所属部门"
            filterTreeNode
            expandAll
            showClear
          />
          <Form.Select
            field="positionIds"
            label="岗位"
            style={{ width: '100%' }}
            multiple
            filter
            showClear
            optionList={positionOptionList}
          />
          <Form.Select
            field="roleIds"
            label="角色"
            style={{ width: '100%' }}
            multiple
            filter
            optionList={allRoles.map((r) => ({ value: r.id, label: r.name }))}
          />
          <Form.Select
            field="status"
            label="状态"
            style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
          />
        </Form>
      </Modal>

      <Modal
        title={passwordUser ? `修改密码 - ${passwordUser.nickname}` : '修改密码'}
        visible={passwordModalVisible}
        onCancel={() => {
          setPasswordModalVisible(false);
          setPasswordUser(null);
        }}
        onOk={handlePasswordModalOk}
        width={420}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          key={passwordUser?.id ?? 'password-form'}
          getFormApi={(api) => { passwordFormApi.current = api; }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input
            field="password"
            label="新密码"
            mode="password"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少 6 个字符' },
            ]}
          />
          <Form.Input
            field="confirmPassword"
            label="确认密码"
            mode="password"
            rules={[{ required: true, message: '请确认新密码' }]}
          />
        </Form>
      </Modal>

      <Modal
        title="批量导入用户"
        visible={importModalVisible}
        onCancel={() => setImportModalVisible(false)}
        footer={
          importResult ? (
            <Button onClick={() => setImportModalVisible(false)}>关闭</Button>
          ) : (
            <Space>
              <Button onClick={() => setImportModalVisible(false)}>取消</Button>
              <Button type="primary" loading={importLoading} onClick={handleImportSubmit}>开始导入</Button>
            </Space>
          )
        }
        width={560}
      >
        {!importResult ? (
          <div style={{ padding: '16px 0' }}>
            <div style={{ marginBottom: 12 }}>
              <Button type="tertiary" icon={<Download size={14} />} onClick={handleImportTemplate}>下载导入模板</Button>
              <Typography.Text type="tertiary" style={{ marginLeft: 8, fontSize: 12 }}>请先下载模板，按格式填写后上传</Typography.Text>
            </div>
            <Upload
              accept=".xlsx,.xls"
              limit={1}
              action=""
              beforeUpload={({ file }) => {
                importFileRef.current = file.fileInstance ?? null;
                return false;
              }}
              onRemove={() => { importFileRef.current = null; }}
            >
              <Button icon={<FileUp size={14} />}>选择文件</Button>
            </Upload>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Space>
                <Tag color="green">成功: {importResult.success}</Tag>
                <Tag color="red">失败: {importResult.failed}</Tag>
                <Tag color="grey">共: {importResult.total}</Tag>
              </Space>
            </div>
            {importResult.errors.length > 0 && (
              <Table
                size="small"
                columns={[
                  { title: '行号', dataIndex: 'row', width: 80 },
                  { title: '错误信息', dataIndex: 'message' },
                ]}
                dataSource={importResult.errors}
                pagination={false}
                rowKey="row"
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
