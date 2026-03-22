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
  Tree,
  Spin,
} from '@douyinfe/semi-ui';
import { IconSearch, IconPlus, IconEdit, IconDelete, IconRefresh, IconTreeTriangleRight } from '@douyinfe/semi-icons';
import type { Role, Menu } from '@zenith/shared';
import { request } from '../../../utils/request';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import './RolesPage.css';

export default function RolesPage() {
  const [data, setData] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [menuRole, setMenuRole] = useState<Role | null>(null);
  const [allMenus, setAllMenus] = useState<Menu[]>([]);
  const [checkedMenuIds, setCheckedMenuIds] = useState<number[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<Role[]>(`/api/roles?keyword=${encodeURIComponent(keyword)}`);
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

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
    const res = await request.post(`/api/roles/${menuRole.id}/menus`, { menuIds: checkedMenuIds });
    if (res.code === 0) {
      Toast.success('菜单权限已更新');
      setMenuModalVisible(false);
    } else {
      Toast.error(res.message);
    }
  };

  const handleSubmit = async (values: Partial<Role>) => {
    const res = editingRole
      ? await request.put(`/api/roles/${editingRole.id}`, values)
      : await request.post('/api/roles', values);
    if (res.code === 0) {
      Toast.success(editingRole ? '更新成功' : '创建成功');
      setModalVisible(false);
      fetchRoles();
    } else {
      Toast.error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/roles/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchRoles();
    } else {
      Toast.error(res.message);
    }
  };

  const columns: ColumnProps<Role>[] = [
    { title: '角色名称', dataIndex: 'name', width: 160 },
    { title: '角色编码', dataIndex: 'code', width: 160 },
    { title: '描述', dataIndex: 'description', render: (v) => v || '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      render: (v) => (
        <Tag color={v === 'active' ? 'green' : 'grey'} size="small">
          {v === 'active' ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 220,
      align: 'center',
      render: (_v, row) => (
        <Space>
          <Button size="small" icon={<IconTreeTriangleRight />} onClick={() => openMenuModal(row)}>
            菜单权限
          </Button>
          <Button
            size="small"
            icon={<IconEdit />}
            onClick={() => { setEditingRole(row); setModalVisible(true); }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除此角色？"
            okText="删除"
            okButtonProps={{ type: 'danger', theme: 'solid' }}
            onConfirm={() => handleDelete(row.id)}
          >
            <Button size="small" type="danger" icon={<IconDelete />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const filtered = data.filter(
    (r) =>
      !keyword ||
      r.name.includes(keyword) ||
      r.code.includes(keyword),
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">角色管理</h2>
          <p className="page-desc">管理系统角色及其菜单权限</p>
        </div>
        <Space>
          <Input
            prefix={<IconSearch />}
            placeholder="搜索角色名称/编码"
            value={keyword}
            onChange={(v) => setKeyword(v)}
            style={{ width: 220 }}
            showClear
          />
          <Button icon={<IconRefresh />} onClick={fetchRoles}>刷新</Button>
          <Button
            type="primary"
            icon={<IconPlus />}
            onClick={() => { setEditingRole(null); setModalVisible(true); }}
          >
            新增角色
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      </Card>

      {/* 创建/编辑 Modal */}
      <Modal
        title={editingRole ? '编辑角色' : '新增角色'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={480}
      >
        <Form
          initValues={editingRole ?? { status: 'active' }}
          onSubmit={handleSubmit}
          labelPosition="left"
          labelWidth={80}
        >
          <Form.Input field="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]} />
          <Form.Input field="code" label="角色编码" rules={[{ required: true, message: '请输入角色编码' }]} />
          <Form.Input field="description" label="描述" />
          <Form.Select field="status" label="状态">
            <Select.Option value="active">启用</Select.Option>
            <Select.Option value="disabled">禁用</Select.Option>
          </Form.Select>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setModalVisible(false)}>取消</Button>
            <Button htmlType="submit" type="primary">确认</Button>
          </div>
        </Form>
      </Modal>

      {/* 菜单权限 Modal */}
      <Modal
        title={`分配菜单权限 — ${menuRole?.name}`}
        visible={menuModalVisible}
        onCancel={() => setMenuModalVisible(false)}
        onOk={handleAssignMenus}
        okText="保存"
        cancelText="取消"
        width={480}
      >
        {menuLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <Tree
            treeData={menusToTreeData(allMenus)}
            multiple
            value={checkedMenuIds.map(String)}
            onChange={(keys) => setCheckedMenuIds((keys as string[]).map(Number))}
            style={{ maxHeight: 400, overflow: 'auto' }}
          />
        )}
      </Modal>
    </div>
  );
}
