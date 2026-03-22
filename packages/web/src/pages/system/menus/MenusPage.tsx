import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Toast,
  Popconfirm,
  Tag,
  Select,
  InputNumber,
} from '@douyinfe/semi-ui';
import { IconPlus, IconEdit, IconDelete, IconRefresh } from '@douyinfe/semi-icons';
import type { Menu, MenuType } from '@zenith/shared';
import { request } from '../../../utils/request';
import { renderLucideIcon } from '../../../utils/icons';
import IconPicker from '../../../components/IconPicker';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import './MenusPage.css';

const menuTypeMap = {
  directory: { label: '目录', color: 'blue' },
  menu: { label: '菜单', color: 'green' },
  button: { label: '按钮', color: 'orange' },
} as const satisfies Record<MenuType, { label: string; color: string }>;

export default function MenusPage() {
  const [data, setData] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);
  const [iconValue, setIconValue] = useState('');

  const fetchMenus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<Menu[]>('/api/menus');
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMenus(); }, [fetchMenus]);

  // 展开树结构为平铺列表（带层级缩进信息）
  function flattenTree(items: Menu[], depth = 0): (Menu & { depth: number })[] {
    return items.flatMap((item) => [
      { ...item, depth },
      ...(item.children ? flattenTree(item.children, depth + 1) : []),
    ]);
  }

  const flatData = flattenTree(data);

  // 所有目录/菜单（供父级选择）
  const allDirs = [
    { value: 0, label: '顶级' },
    ...flatData
      .filter((m) => m.type !== 'button')
      .map((m) => ({ value: m.id, label: '\u00a0'.repeat(m.depth * 4) + m.title })),
  ];

  const openCreate = (pid?: number) => {
    setEditingMenu(null);
    setParentId(pid ?? null);
    setIconValue('');
    setModalVisible(true);
  };

  const openEdit = (menu: Menu) => {
    setEditingMenu(menu);
    setParentId(null);
    setIconValue(menu.icon ?? '');
    setModalVisible(true);
  };

  const handleSubmit = async (values: Partial<Menu> & { parentId: number }) => {
    const payload = { ...values, parentId: values.parentId ?? 0, icon: iconValue || undefined };
    const res = editingMenu
      ? await request.put(`/api/menus/${editingMenu.id}`, payload)
      : await request.post('/api/menus', payload);
    if (res.code === 0) {
      Toast.success(editingMenu ? '更新成功' : '创建成功');
      setModalVisible(false);
      fetchMenus();
    } else {
      Toast.error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/menus/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchMenus();
    } else {
      Toast.error(res.message);
    }
  };

  const columns: ColumnProps<Menu & { depth: number }>[] = [
    {
      title: '菜单名称',
      dataIndex: 'title',
      width: 280,
      ellipsis: { showTitle: false },
      render: (val, row) => (
        <span style={{ paddingLeft: row.depth * 20, display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {row.icon && (
            <span style={{ marginRight: 6, display: 'flex', alignItems: 'center', color: 'var(--semi-color-text-1)', flexShrink: 0 }}>
              {renderLucideIcon(row.icon, 15)}
            </span>
          )}
          <span className="table-cell-ellipsis" title={String(val)}>{val}</span>
        </span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (val: MenuType) => (
        <Tag color={menuTypeMap[val].color} size="small">{menuTypeMap[val].label}</Tag>
      ),
    },
    {
      title: '路由路径',
      dataIndex: 'path',
      width: 180,
      ellipsis: true,
      render: (val) => val || '—',
    },
    {
      title: '权限标识',
      dataIndex: 'permission',
      width: 200,
      ellipsis: true,
      render: (val) => val || '—',
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 70,
      align: 'center',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      align: 'center',
      render: (val) => (
        <Tag color={val === 'active' ? 'green' : 'grey'} size="small">
          {val === 'active' ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      width: 180,
      align: 'center',
      render: (_val, row) => (
        <Space>
          {row.type !== 'button' && (
            <Button size="small" icon={<IconPlus />} onClick={() => openCreate(row.id)}>
              子项
            </Button>
          )}
          <Button size="small" icon={<IconEdit />} onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm
            title="确认删除此菜单？"
            content="子菜单也将一并删除"
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

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">菜单管理</h2>
          <p className="page-desc">管理系统菜单和按钮权限</p>
        </div>
        <Space>
          <Button icon={<IconRefresh />} onClick={fetchMenus}>刷新</Button>
          <Button type="primary" icon={<IconPlus />} onClick={() => openCreate()}>新增菜单</Button>
        </Space>
      </div>

      <Card>
        <Table
          className="admin-table-nowrap"
          columns={columns}
          dataSource={flatData}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      </Card>

      <Modal
        title={editingMenu ? '编辑菜单' : '新增菜单'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={560}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          initValues={
            editingMenu
              ? { ...editingMenu }
              : { type: 'menu', status: 'active', visible: true, sort: 0, parentId: parentId ?? 0 }
          }
          onSubmit={handleSubmit}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Select field="parentId" label="父级菜单" style={{ width: '100%' }}>
            {allDirs.map((d) => (
              <Select.Option key={d.value} value={d.value}>{d.label}</Select.Option>
            ))}
          </Form.Select>
          <Form.Select field="type" label="菜单类型" rules={[{ required: true }]}>
            <Select.Option value="directory">目录</Select.Option>
            <Select.Option value="menu">菜单</Select.Option>
            <Select.Option value="button">按钮</Select.Option>
          </Form.Select>
          <Form.Input field="title" label="菜单名称" rules={[{ required: true, message: '请输入菜单名称' }]} />
          <Form.Input field="name" label="组件名" />
          <Form.Input field="path" label="路由路径" />
          <Form.Slot label={{ text: '图标' }}>
            <IconPicker value={iconValue} onChange={setIconValue} />
          </Form.Slot>
          <Form.Input field="permission" label="权限标识" />
          <Form.InputNumber field="sort" label="排序" initValue={0} min={0} />
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
    </div>
  );
}
