import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Toast,
  SideSheet,
  Transfer,
  Empty,
  Typography,
  Tag,
  Row,
  Col,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Trash2, Users } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { UserGroup, PaginatedResponse, User, Department } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';

interface SearchParams {
  keyword: string;
  status: string;
}

interface SimpleUser {
  id: number;
  username: string;
  nickname: string;
  email?: string | null;
  departmentName?: string | null;
}

interface GroupMember extends SimpleUser {
  joinedAt: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function UserGroupsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UserGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<UserGroup | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  // 选项数据
  const [allUsers, setAllUsers] = useState<SimpleUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  // 成员管理
  const [memberSheetVisible, setMemberSheetVisible] = useState(false);
  const [memberGroup, setMemberGroup] = useState<UserGroup | null>(null);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [memberSaving, setMemberSaving] = useState(false);

  const fetchList = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<UserGroup>>(`/api/user-groups?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  useEffect(() => {
    void (async () => {
      const [uRes, dRes] = await Promise.all([
        request.get<{ code: number; message: string; data: User[] }>('/api/users/all'),
        request.get<Department[]>('/api/departments'),
      ]);
      if (uRes.code === 0) {
        setAllUsers(uRes.data.map(u => ({
          id: u.id, username: u.username, nickname: u.nickname,
          email: u.email, departmentName: (u as User & { departmentName?: string }).departmentName,
        })));
      }
      if (dRes.code === 0) setDepartments(Array.isArray(dRes.data) ? dRes.data : []);
    })();
  }, []);

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize); };
  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  };

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current?.validate();
    } catch {
      throw new Error('validation');
    }
    const res = editing
      ? await request.put(`/api/user-groups/${editing.id}`, values)
      : await request.post('/api/user-groups', values);
    if (res.code === 0) {
      Toast.success(editing ? '更新成功' : '创建成功');
      setModalVisible(false);
      setEditing(null);
      void fetchList();
    } else {
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/user-groups/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchList();
    }
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个用户组？`,
      content: '删除后无法恢复，请确认操作',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>('/api/user-groups/batch', { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success(res.message ?? '删除成功');
          setSelectedRowKeys([]);
          void fetchList();
        }
      },
    });
  };

  const openMembers = async (group: UserGroup) => {
    setMemberGroup(group);
    setMemberSheetVisible(true);
    const res = await request.get<GroupMember[]>(`/api/user-groups/${group.id}/members`);
    if (res.code === 0) {
      setMemberIds((res.data || []).map(m => m.id));
    }
  };

  const handleSaveMembers = async () => {
    if (!memberGroup) return;
    setMemberSaving(true);
    try {
      const res = await request.put(`/api/user-groups/${memberGroup.id}/members`, { userIds: memberIds });
      if (res.code === 0) {
        Toast.success('保存成功');
        setMemberSheetVisible(false);
        void fetchList();
      }
    } finally {
      setMemberSaving(false);
    }
  };

  const columns: ColumnProps<UserGroup>[] = [
    { title: '用户组名称', dataIndex: 'name', width: 200, render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
    { title: '编码', dataIndex: 'code', width: 180, render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
    {
      title: '描述', dataIndex: 'description',
      render: (v: string | null | undefined) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v || '—'}</Typography.Text>,
    },
    {
      title: '负责人', dataIndex: 'ownerName', width: 120,
      render: (v: string | null | undefined) => v || '—',
    },
    {
      title: '所属部门', dataIndex: 'departmentName', width: 140,
      render: (v: string | null | undefined) => v || '—',
    },
    {
      title: '成员数', dataIndex: 'memberCount', width: 90,
      render: (v: number) => <Tag color="blue">{v ?? 0}</Tag>,
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: 180,
      render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{formatDateTime(v)}</Typography.Text>,
    },
    {
      title: '状态', dataIndex: 'status', width: 100, fixed: 'right',
      render: (v: string) =>
        v === 'enabled'
          ? <Tag color="green">启用</Tag>
          : <Tag color="grey">禁用</Tag>,
    },
    {
      title: '操作', fixed: 'right', width: 220,
      render: (_: unknown, record: UserGroup) => (
        <Space>
          {hasPermission('system:user-groups:assign') && (
            <Button theme="borderless" size="small" onClick={() => openMembers(record)}>成员</Button>
          )}
          {hasPermission('system:user-groups:update') && (
            <Button theme="borderless" size="small" onClick={() => { setEditing(record); setModalVisible(true); }}>编辑</Button>
          )}
          {hasPermission('system:user-groups:delete') && (
            <Button theme="borderless" type="danger" size="small" onClick={() => {
              Modal.confirm({
                title: '确定要删除该用户组吗？',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => handleDelete(record.id),
              });
            }}>删除</Button>
          )}
        </Space>
      ),
    },
  ];

  const formInitValues = editing
    ? {
        name: editing.name,
        code: editing.code,
        description: editing.description ?? undefined,
        ownerId: editing.ownerId ?? undefined,
        departmentId: editing.departmentId ?? undefined,
        status: editing.status,
      }
    : { status: 'enabled' };

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索名称/编码"
          value={searchParams.keyword}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
          onEnterPress={handleSearch}
          style={{ width: 240 }}
          showClear
        />
        <Select
          placeholder="请选择状态"
          value={searchParams.status || undefined}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
          style={{ width: 140 }}
          optionList={[
            { value: '', label: '全部状态' },
            { value: 'enabled', label: '启用' },
            { value: 'disabled', label: '禁用' },
          ]}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {selectedRowKeys.length > 0 && hasPermission('system:user-groups:delete') && (
          <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
            批量删除 ({selectedRowKeys.length})
          </Button>
        )}
        {hasPermission('system:user-groups:create') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditing(null); setModalVisible(true); }}>新增</Button>
        )}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: (p) => { setPage(p); void fetchList(p, pageSize); },
          onPageSizeChange: (size) => { setPageSize(size); void fetchList(1, size); },
          showSizeChanger: true,
        }}
        empty="暂无数据"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        }}
      />

      <Modal
        title={editing ? '编辑用户组' : '新增用户组'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditing(null); }}
        onOk={handleModalOk}
        width={660}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          key={editing?.id ?? 'new-group'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="名称" placeholder="请输入用户组名称" rules={[{ required: true, message: '请输入用户组名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="编码" placeholder="字母数字下划线" rules={[
                { required: true, message: '请输入用户组编码' },
                { pattern: /^\w+$/, message: '编码只能包含字母、数字和下划线' },
              ]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="ownerId" label="负责人" placeholder="请选择负责人（可选）"
                style={{ width: '100%' }} filter showClear
                optionList={allUsers.map(u => ({ value: u.id, label: `${u.nickname} (${u.username})` }))}
              />
            </Col>
            <Col span={12}>
              <Form.Select
                field="departmentId" label="所属部门" placeholder="请选择部门（可选）"
                style={{ width: '100%' }} filter showClear
                optionList={departments.map(d => ({ value: d.id, label: d.name }))}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="status" label="状态" style={{ width: '100%' }}
                optionList={[
                  { value: 'enabled', label: '启用' },
                  { value: 'disabled', label: '禁用' },
                ]}
              />
            </Col>
          </Row>
          <Form.TextArea field="description" label="描述" placeholder="请输入描述（可选）" maxCount={256} />
        </Form>
      </Modal>

      <SideSheet
        title={
          <Space>
            <Users size={16} />
            <span>成员管理 - {memberGroup?.name}</span>
          </Space>
        }
        visible={memberSheetVisible}
        onCancel={() => setMemberSheetVisible(false)}
        width={720}
        footer={
          <Space>
            <Button onClick={() => setMemberSheetVisible(false)}>取消</Button>
            <Button type="primary" loading={memberSaving} onClick={handleSaveMembers}>保存</Button>
          </Space>
        }
      >
        {allUsers.length === 0 ? (
          <Empty title="暂无用户" description="请先创建用户" />
        ) : (
          <Transfer
            style={{ width: '100%' }}
            dataSource={allUsers.map(u => ({
              key: String(u.id),
              value: u.id,
              label: `${u.nickname} (${u.username})`,
              disabled: false,
            }))}
            value={memberIds}
            onChange={(values) => setMemberIds((values as number[]) || [])}
            inputProps={{ placeholder: '搜索用户' }}
            emptyContent={{ left: '暂无可选', right: '暂无成员', search: '无匹配' }}
          />
        )}
      </SideSheet>
    </div>
  );
}
