import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Button,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Radio,
  Toast,
  Typography,
  TreeSelect,
  Row,
  Col,
  Spin,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Plus, ChevronsDownUp, ChevronsUpDown, Search, RotateCcw } from 'lucide-react';
import type { Menu } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
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
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [parentId, setParentId] = useState<number | null>(null);
  const [iconValue, setIconValue] = useState('');
  const [menuType, setMenuType] = useState<string>('menu');

  const [expandedRowKeys, setExpandedRowKeys] = useState<(string | number)[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [pendingKeyword, setPendingKeyword] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string>('');

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

  // 递归过滤树节点
  const filterTree = useCallback((items: Menu[], kw: string, st: string): Menu[] => {
    return items.reduce<Menu[]>((acc, item) => {
      const filteredChildren = item.children?.length ? filterTree(item.children, kw, st) : [];
      const titleMatch = !kw || item.title.toLowerCase().includes(kw.toLowerCase());
      const statusMatch = !st || item.status === st;
      let mergedChildren: Menu[] | undefined;
      if (filteredChildren.length > 0) {
        mergedChildren = filteredChildren;
      } else if (item.children?.length) {
        mergedChildren = [];
      }
      if ((titleMatch && statusMatch) || filteredChildren.length > 0) {
        acc.push({ ...item, children: mergedChildren });
      }
      return acc;
    }, []);
  }, []);

  const filteredData = useMemo(
    () => (keyword || statusFilter ? filterTree(data, keyword, statusFilter) : data),
    [data, keyword, statusFilter, filterTree]
  );

  const handleSearch = () => {
    setKeyword(pendingKeyword);
    setStatusFilter(pendingStatus);
  };

  const handleReset = () => {
    setPendingKeyword('');
    setPendingStatus('');
    setKeyword('');
    setStatusFilter('');
  };

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

  const openEdit = async (menu: Menu) => {
    setEditingMenu(menu);
    setParentId(menu.parentId ?? 0);
    setIconValue(menu.icon ?? '');
    setMenuType(menu.type);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<Menu>(`/api/menus/${menu.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingMenu(res.data);
      setParentId(res.data.parentId ?? 0);
      setIconValue(res.data.icon ?? '');
      setMenuType(res.data.type);
    } else {
      Toast.error(res.message || '获取菜单信息失败');
    }
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
      render: (val: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{val || '—'}</Typography.Text>,
    },
    {
      title: '组件路径',
      dataIndex: 'component',
      width: 250,
      render: (val: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{val || '—'}</Typography.Text>,
    },
    {
      title: '权限标识',
      dataIndex: 'permission',
      width: 200,
      render: (val: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{val || '—'}</Typography.Text>,
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 70,
      align: 'center',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      align: 'center',
      fixed: 'right',
      render: (val: string) => <DictTag dictCode="common_status" value={val} />,
    },
    {
      title: '显示',
      dataIndex: 'visible',
      width: 80,
      align: 'center',
      fixed: 'right',
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
      <SearchToolbar>
          <Input
            prefix={<Search size={14} />}
            placeholder="菜单名称"
            showClear
            value={pendingKeyword}
            onChange={(val) => setPendingKeyword(val)}
            onEnterPress={handleSearch}
            style={{ width: 200 }}
          />
          <Select
            placeholder="状态"
            showClear
            value={pendingStatus || undefined}
            onChange={(val) => setPendingStatus((val as string) ?? '')}
            style={{ width: 120 }}
          >
            {statusItems.map((i) => (
              <Select.Option key={i.value} value={i.value}>{i.label}</Select.Option>
            ))}
          </Select>
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          <Button
            type="primary"
            icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            onClick={toggleExpandAll}
          >
            {isAllExpanded ? '全部折叠' : '全部展开'}
          </Button>
          {hasPermission('system:menu:create') && <Button type="primary" icon={<Plus size={14} />} onClick={() => openCreate()}>新增</Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={filteredData}
        rowKey="id"
        loading={loading}
        pagination={false}
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={(rows) => setExpandedRowKeys(rows?.filter((r): r is Menu => 'id' in r).map((r) => r.id) ?? [])}
      />

      <Modal
        title={editingMenu ? '编辑菜单' : '新增菜单'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingMenu(null); setModalDetailLoading(false); }}
        onOk={handleMenuModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={680}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          getFormApi={(api) => formApi.current = api}
          allowEmpty
          key={editingMenu ? `edit-${editingMenu.id}` : 'create'}
          initValues={
            editingMenu
              ? { ...editingMenu, visible: editingMenu.visible ? 'show' : 'hidden' }
                : { type: 'menu', status: 'enabled', visible: 'show', sort: 0, parentId: parentId ?? 0 }
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
            />
          </Form.Slot>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="title" label="菜单名称" placeholder="请输入菜单名称" rules={[{ required: true, message: '请输入菜单名称' }]} />
            </Col>
            {(menuType === 'menu' || menuType === 'directory') && (
              <Col span={12}>
                <Form.Input
                  field="path"
                  label="路由路径"
                  placeholder="请输入路由路径"
                  rules={menuType === 'menu' ? [{ required: true, message: '请输入路由路径' }] : undefined}
                />
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
                <Form.Input field="permission" label="权限标识" placeholder="请输入权限标识" rules={[{ required: true, message: '请输入权限标识' }]} />
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
              <Form.InputNumber field="sort" label="排序" placeholder="请输入排序" initValue={0} min={0} style={{ width: '100%' }} />
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
        </Spin>
      </Modal>
    </div>
  );
}
