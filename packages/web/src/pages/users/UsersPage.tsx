import { useState, useEffect, useCallback } from 'react';
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
import { Search, Plus, RefreshCw } from 'lucide-react';
import type { User, Role, PaginatedResponse, CreateUserInput, UpdateUserInput } from '@zenith/shared';
import { request } from '../../utils/request';
import DictTag from '../../components/DictTag';
import { useDictItems } from '../../hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import './UsersPage.css';

export default function UsersPage() {
  const [data, setData] = useState<PaginatedResponse<User> | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
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
      render: (t: string) => new Date(t).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 140,
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
      <Card className="users-card" bodyStyle={{ padding: 0 }}>
        <div className="users-toolbar">
          <Space>
            <Input
              prefix={<Search />}
              placeholder="搜索用户名/昵称/邮箱"
              value={keyword}
              onChange={setKeyword}
              onEnterPress={() => { setPage(1); fetchUsers(); }}
              style={{ width: 260 }}
              showClear
            />
          </Space>
          <Space>
            <Button icon={<RefreshCw />} onClick={fetchUsers}>刷新</Button>
            <Button
              type="primary"
              theme="solid"
              icon={<Plus />}
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
          className="admin-table-nowrap"
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
          initValues={formInitValues}
          onSubmit={(values) => editingUser ? handleUpdate(values as UpdateUserInput) : handleCreate(values as CreateUserInput)}
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
