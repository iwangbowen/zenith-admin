import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Space,
  Modal,
  Form,
  Toast,
  Popconfirm,
  Avatar,
  Tag,
} from '@douyinfe/semi-ui';
import { Search, Plus, RotateCcw } from 'lucide-react';
import type { User, Role, PaginatedResponse } from '@zenith/shared';
import { request } from '../../utils/request';
import { formatDateTime } from '../../utils/date';
import DictTag from '../../components/DictTag';
import { useDictItems } from '../../hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import './UsersPage.css';

export default function UsersPage() {
  const formApi = useRef<any>(null);
  const [data, setData] = useState<PaginatedResponse<User> | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);

  const { items: statusItems } = useDictItems('common_status');

  useEffect(() => {
    request.get<Role[]>('/api/roles').then((res) => {
      if (res.code === 0) setAllRoles(res.data);
    });
  }, []);

  const formInitValues = editingUser
    ? {
        username: editingUser.username,
        nickname: editingUser.nickname,
        email: editingUser.email,
        roleIds: editingUser.roles.map((r) => r.id),
        status: editingUser.status,
      }
    : {
        roleIds: [],
        status: 'active',
      };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<PaginatedResponse<User>>(
        `/api/users?page=${page}&pageSize=${pageSize}&keyword=${encodeURIComponent(submittedKeyword)}`
      );
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, submittedKeyword]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function handleSearch() {
    setSubmittedKeyword(keyword);
    if (page !== 1) setPage(1);
  }

  function handleReset() {
    setKeyword('');
    setSubmittedKeyword('');
    if (page !== 1) setPage(1);
  }

  const handleModalOk = async () => {
    let values: any;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    const res = editingUser
      ? await request.put(`/api/users/${editingUser.id}`, values)
      : await request.post('/api/users', values);
    if (res.code === 0) {
      Toast.success(editingUser ? '更新成功' : '创建成功');
      setModalVisible(false);
      setEditingUser(null);
      fetchUsers();
    } else {
      Toast.error(res.message);
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/users/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchUsers();
    } else {
      Toast.error(res.message);
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
      title: '角色',
      dataIndex: 'roles',
      width: 160,
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
      width: 180,
      render: (_: unknown, record: User) => (
        <Space>
          <Button
            theme="borderless"
            size="small"
            onClick={() => {
              setEditingUser(record);
              setModalVisible(true);
            }}
          >编辑</Button>
          <Popconfirm title="确定要删除该用户吗？" onConfirm={() => handleDelete(record.id)}>
            <Button theme="borderless" type="danger" size="small">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="search-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索用户名/昵称/邮箱"
              value={keyword}
              onChange={setKeyword}
              onEnterPress={handleSearch}
              style={{ width: 260 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </Space>
          <Space>
            <Button
              type="secondary"
              icon={<Plus size={14} />}
              onClick={() => {
                setEditingUser(null);
                setModalVisible(true);
              }}
            >
              新增
            </Button>
          </Space>
        </div>
      </div>

      <Table
        className="admin-table-nowrap"
        bordered
        columns={columns}
        dataSource={data?.list || []}
        loading={loading}
        pagination={{
          currentPage: page,
          pageSize: pageSize,
          total: data?.total || 0,
          onPageChange: setPage,
          onPageSizeChange: (size) => {
            setPageSize(size);
            setPage(1);
          },
          showTotal: true,
          showSizeChanger: true,
        }}
        rowKey="id"
        size="small"
        empty="暂无数据"
      />

      <Modal
        title={editingUser ? '编辑用户' : '新增用户'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingUser(null); }}
        onOk={handleModalOk}
        width={440}
        closeOnEsc
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          getFormApi={(api) => formApi.current = api}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={70}
        >
          {!editingUser && (
            <Form.Input field="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]} />
          )}
          <Form.Input field="nickname" label="昵称" rules={[{ required: true, message: '请输入昵称' }]} />
          <Form.Input field="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }]} />
          {!editingUser && (
            <Form.Input field="password" label="密码" type="password" rules={[{ required: true, message: '请输入密码' }]} />
          )}
          <Form.Select
            field="roleIds"
            label="角色"
            style={{ width: '100%' }}
            multiple
            filter
            optionList={allRoles.map((r) => ({ value: r.id, label: r.name }))}
          />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
          />
        </Form>
      </Modal>
    </div>
  );
}
