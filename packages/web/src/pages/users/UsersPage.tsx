import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Tag,
  Space,
  Modal,
  Form,
  Toast,
  Popconfirm,
  Select,
  Avatar,
} from '@douyinfe/semi-ui';
import { IconSearch, IconPlus, IconEdit, IconDelete, IconRefresh } from '@douyinfe/semi-icons';
import type { User, PaginatedResponse, CreateUserInput } from '@zenith/shared';
import { request } from '../../utils/request';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import './UsersPage.css';

export default function UsersPage() {
  const [data, setData] = useState<PaginatedResponse<User> | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<PaginatedResponse<User>>(
        `/api/users?page=${page}&pageSize=10&keyword=${encodeURIComponent(keyword)}`
      );
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [page, keyword]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreate = async (values: CreateUserInput) => {
    const res = await request.post('/api/users', values);
    if (res.code === 0) {
      Toast.success('创建成功');
      setModalVisible(false);
      fetchUsers();
    } else {
      Toast.error(res.message);
    }
  };

  const handleUpdate = async (values: Partial<CreateUserInput>) => {
    if (!editingUser) return;
    const res = await request.put(`/api/users/${editingUser.id}`, values);
    if (res.code === 0) {
      Toast.success('更新成功');
      setEditingUser(null);
      setModalVisible(false);
      fetchUsers();
    } else {
      Toast.error(res.message);
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
      render: (_: unknown, record: User) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Avatar size="extra-small" color="blue" style={{ fontSize: 11 }}>
            {record.nickname?.charAt(0)?.toUpperCase() || 'U'}
          </Avatar>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{record.nickname}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{record.username}</div>
          </div>
        </div>
      ),
    },
    { title: '邮箱', dataIndex: 'email', width: 220 },
    {
      title: '角色',
      dataIndex: 'role',
      width: 100,
      render: (role: string) => (
        <Tag size="small" color={role === 'admin' ? 'blue' : 'grey'} style={{ borderRadius: 4 }}>
          {role === 'admin' ? '管理员' : '用户'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => (
        <Tag size="small" type={status === 'active' ? 'light' : 'solid'} color={status === 'active' ? 'green' : 'red'} style={{ borderRadius: 4 }}>
          {status === 'active' ? '正常' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (t: string) => new Date(t).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, record: User) => (
        <Space>
          <Button
            theme="borderless"
            icon={<IconEdit />}
            size="small"
            onClick={() => {
              setEditingUser(record);
              setModalVisible(true);
            }}
          />
          <Popconfirm title="确定要删除该用户吗？" onConfirm={() => handleDelete(record.id)}>
            <Button theme="borderless" type="danger" icon={<IconDelete />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <Card className="users-card" bodyStyle={{ padding: 0 }}>
        <div className="users-toolbar">
          <Space>
            <Input
              prefix={<IconSearch />}
              placeholder="搜索用户名/昵称/邮箱"
              value={keyword}
              onChange={setKeyword}
              onEnterPress={() => { setPage(1); fetchUsers(); }}
              style={{ width: 260 }}
              showClear
            />
          </Space>
          <Space>
            <Button icon={<IconRefresh />} onClick={fetchUsers}>刷新</Button>
            <Button
              type="primary"
              theme="solid"
              icon={<IconPlus />}
              onClick={() => {
                setEditingUser(null);
                setModalVisible(true);
              }}
            >
              新增用户
            </Button>
          </Space>
        </div>
        <Table
          columns={columns}
          dataSource={data?.list || []}
          loading={loading}
          pagination={{
            currentPage: page,
            pageSize: 10,
            total: data?.total || 0,
            onPageChange: setPage,
            showTotal: true,
            showSizeChanger: false,
            style: { padding: '12px 16px 16px' },
          }}
          rowKey="id"
          size="small"
          empty="暂无数据"
        />
      </Card>

      <Modal
        title={editingUser ? '编辑用户' : '新增用户'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingUser(null); }}
        footer={null}
        width={440}
        closeOnEsc
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          initValues={
            editingUser
              ? { username: editingUser.username, nickname: editingUser.nickname, email: editingUser.email, role: editingUser.role, status: editingUser.status }
              : { role: 'user', status: 'active' }
          }
          onSubmit={(values) => editingUser ? handleUpdate(values) : handleCreate(values)}
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
          <Form.Select field="role" label="角色" style={{ width: '100%' }}>
            <Select.Option value="admin">管理员</Select.Option>
            <Select.Option value="user">用户</Select.Option>
          </Form.Select>
          <Form.Select field="status" label="状态" style={{ width: '100%' }}>
            <Select.Option value="active">正常</Select.Option>
            <Select.Option value="disabled">禁用</Select.Option>
          </Form.Select>
          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <Space>
              <Button onClick={() => { setModalVisible(false); setEditingUser(null); }}>取消</Button>
              <Button htmlType="submit" type="primary" theme="solid">保存</Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
