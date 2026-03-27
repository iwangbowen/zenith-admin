import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Radio,
  Toast,
  TreeSelect,
  Row,
  Col,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Plus, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { Menu } from '@zenith/shared';
import { request } from '@/utils/request';
import { renderLucideIcon } from '@/utils/icons';
import IconPicker from '@/components/IconPicker';
import { usePermission } from '@/hooks/usePermission';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';

export default function MenusPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);
  const [iconValue, setIconValue] = useState('');
  const [menuType, setMenuType] = useState<string>('menu');

  const [expandedRowKeys, setExpandedRowKeys] = useState<(string | number)[]>([]);

  const { items: menuTypeItems } = useDictItems('menu_type');
  const { items: statusItems } = useDictItems('common_status');
  const { items: menuVisibleItems } = useDictItems('menu_visible');

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

  // 递归收集所有节点 ID
  const allRowKeys = useMemo(() => {
    const keys: number[] = [];
    function collect(items: Menu[]) {
      for (const item of items) {
        keys.push(item.id);
        if (item.children?.length) collect(item.children);
      }
    }
    collect(data);
    return keys;
  }, [data]);

  const isAllExpanded = expandedRowKeys.length > 0 && expandedRowKeys.length >= allRowKeys.length;

  function toggleExpandAll() {
    setExpandedRowKeys(isAllExpanded ? [] : allRowKeys);
  }

  // Semi Table 原生支持 children 字段树形展示，无需手动 flatten

  // 递归构建 TreeSelect 数据（过滤掉按钮类型）
  function buildTreeSelectData(items: Menu[]): TreeNodeData[] {
    return items
      .filter((m) => m.type !== 'button')
      .map((m) => ({
        label: m.title,
        value: m.id,
        key: String(m.id),
        children: m.children?.length ? buildTreeSelectData(m.children) : undefined,
      }));
  }

  const parentTreeData: TreeNodeData[] = [
    { label: '顶级', value: 0, key: '0' },
    ...buildTreeSelectData(data),
  ];

  const openCreate = (pid?: number) => {
    setEditingMenu(null);
    setParentId(pid ?? 0);
    setIconValue('');
    setMenuType('menu');
    setModalVisible(true);
  };

  const openEdit = (menu: Menu) => {
    setEditingMenu(menu);
    setParentId(menu.parentId ?? 0);
    setIconValue(menu.icon ?? '');
    setMenuType(menu.type);
    setModalVisible(true);
  };

  const handleMenuModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    const payload = {
      ...values,
      parentId: parentId ?? 0,
      icon: iconValue || undefined,
      visible: values.visible === undefined ? true : values.visible === 'show',
    };
    const res = editingMenu
      ? await request.put(`/api/menus/${editingMenu.id}`, payload)
      : await request.post('/api/menus', payload);
    if (res.code === 0) {
      Toast.success(editingMenu ? '更新成功' : '创建成功');
      setModalVisible(false);
      fetchMenus();
    } else {
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/menus/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchMenus();
    }
  };

  const columns: ColumnProps<Menu>[] = [
    {
      title: '菜单名称',
      dataIndex: 'title',
      width: 280,
      useFullRender: true,
      render: (val, row, _index, options) => {
        const expandIcon = options?.expandIcon;
        const indentText = options?.indentText;
        return (
          <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {indentText}
            {expandIcon}
            {row.icon && (
              <span style={{ marginRight: 6, marginLeft: 4, display: 'flex', alignItems: 'center', color: 'var(--semi-color-text-1)', flexShrink: 0 }}>
                {renderLucideIcon(row.icon, 15)}
              </span>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(val)}>{val}</span>
          </span>
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (val: string) => <DictTag dictCode="menu_type" value={val} />,
    },
    {
      title: '路由路径',
      dataIndex: 'path',
      width: 180,
      ellipsis: true,
      render: (val) => val || '—',
    },
    {
      title: '组件路径',
      dataIndex: 'component',
      width: 250,
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
      render: (val: string) => <DictTag dictCode="common_status" value={val} />,
    },
    {
      title: '显示',
      dataIndex: 'visible',
      width: 80,
      align: 'center',
      render: (val: boolean, row: Menu) => row.type === 'button' ? '—' : <DictTag dictCode="menu_visible" value={val ? 'show' : 'hidden'} />,
    },
    {
      title: '操作',
      fixed: 'right',
      width: 260,
      align: 'center',
      render: (_val, row) => (
        <Space>
          {row.type !== 'button' && hasPermission('system:menu:create') && (
            <Button theme="borderless" size="small" onClick={() => openCreate(row.id)}>
              子项
            </Button>
          )}
          {hasPermission('system:menu:update') && <Button theme="borderless" size="small" onClick={() => openEdit(row)}>编辑</Button>}
          {hasPermission('system:menu:delete') && <Button theme="borderless" size="small" type="danger" onClick={() => {
            Modal.confirm({
              title: '确认删除此菜单？',
              content: '子菜单也将一并删除',
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
      <div className="search-area">
        <div className="responsive-toolbar">
          <div className="responsive-toolbar__left">
            <Space wrap>
              {hasPermission('system:menu:create') && <Button type="secondary" icon={<Plus size={14} />} onClick={() => openCreate()}>新增</Button>}
            </Space>
          </div>
          <div className="responsive-toolbar__right">
            <Button
              type="tertiary"
              icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
              onClick={toggleExpandAll}
            >
              {isAllExpanded ? '全部折叠' : '全部展开'}
            </Button>
          </div>
        </div>
      </div>

      <div>
        <Table
          bordered
          className="admin-table-nowrap"
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          expandedRowKeys={expandedRowKeys}
          onExpandedRowsChange={(rows) => setExpandedRowKeys(rows?.map((r: Menu) => r.id) ?? [])}
        />
      </div>

      <Modal
        title={editingMenu ? '编辑菜单' : '新增菜单'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleMenuModalOk}
        width={680}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          getFormApi={(api) => formApi.current = api}
          key={editingMenu ? `edit-${editingMenu.id}` : 'create'}
          initValues={
            editingMenu
              ? { ...editingMenu, visible: editingMenu.visible ? 'show' : 'hidden' }
              : { type: 'menu', status: 'active', visible: 'show', sort: 0, parentId: parentId ?? 0 }
          }
          labelPosition="left"
          labelWidth={90}
        >
          <Form.RadioGroup
            field="type"
            label="菜单类型"
            rules={[{ required: true }]}
            onChange={(e) => setMenuType((e.target as HTMLInputElement).value)}
            type="button"
          >
            {menuTypeItems.map((i) => (
              <Radio key={i.value} value={i.value}>{i.label}</Radio>
            ))}
          </Form.RadioGroup>

          <Form.Slot label={{ text: '父级菜单' }}>
            <TreeSelect
              treeData={parentTreeData}
              value={parentId ?? 0}
              onChange={(val) => setParentId(val as number)}
              style={{ width: '100%' }}
              placeholder="请选择父级菜单"
              filterTreeNode
              expandAll
            />
          </Form.Slot>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="title" label="菜单名称" rules={[{ required: true, message: '请输入菜单名称' }]} />
            </Col>
            {(menuType === 'menu' || menuType === 'directory') && (
              <Col span={12}>
                <Form.Input field="path" label="路由路径" rules={[{ required: true, message: '请输入路由路径' }]} />
              </Col>
            )}
            {menuType === 'menu' && (
              <Col span={12}>
                <Form.Input field="component" label="组件路径" placeholder="例如: users/UsersPage" rules={[{ required: true, message: '请输入组件路径' }]} />
              </Col>
            )}
            {menuType === 'menu' && (
              <Col span={12}>
                <Form.Input field="name" label="组件名" placeholder="前端组件Name" />
              </Col>
            )}
            {menuType === 'button' && (
              <Col span={12}>
                <Form.Input field="permission" label="权限标识" rules={[{ required: true, message: '请输入权限标识' }]} />
              </Col>
            )}
            {menuType !== 'button' && (
              <Col span={12}>
                <Form.Slot label={{ text: '图标' }}>
                  <IconPicker value={iconValue} onChange={setIconValue} />
                </Form.Slot>
              </Col>
            )}
            <Col span={12}>
              <Form.InputNumber field="sort" label="排序" initValue={0} min={0} style={{ width: '100%' }} />
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.RadioGroup field="status" label="状态" type="button" rules={[{ required: true }]}>
                {statusItems.map((i) => (
                  <Radio key={i.value} value={i.value}>{i.label}</Radio>
                ))}
              </Form.RadioGroup>
            </Col>
            {menuType !== 'button' && (
              <Col span={12}>
                <Form.RadioGroup field="visible" label="显示状态" type="button" rules={[{ required: true }]}>
                  {menuVisibleItems.map((i) => (
                    <Radio key={i.value} value={i.value}>{i.label}</Radio>
                  ))}
                </Form.RadioGroup>
              </Col>
            )}
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
