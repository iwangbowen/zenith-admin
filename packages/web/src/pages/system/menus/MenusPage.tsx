import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Select,
  Modal,
  Form,
  Radio,
  Toast,
  TreeSelect,
  Row,
  Col,
  Spin,
  Switch,
  Tooltip,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { Plus, ChevronsDownUp, ChevronsUpDown, Search, RotateCcw } from 'lucide-react';
import type { Menu } from '@zenith/shared';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { renderLucideIcon } from '@/utils/icons';
import IconPicker from '@/components/IconPicker';
import { usePermission } from '@/hooks/usePermission';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { menuKeys, useDeleteMenu, useMenuDetail, useMenuTree, useSaveMenu } from '@/hooks/queries/menus';

export default function MenusPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);
  const [iconValue, setIconValue] = useState('');
  const [menuType, setMenuType] = useState<string>('menu');
  const [isExternalVal, setIsExternalVal] = useState<boolean>(false);

  const [expandedRowKeys, setExpandedRowKeys] = useState<(string | number)[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [pendingKeyword, setPendingKeyword] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string>('');

  const { items: menuTypeItems } = useDictItems('menu_type');
  const { items: statusItems } = useDictItems('common_status');
  const { items: menuVisibleItems } = useDictItems('menu_visible');

  const menuTreeQuery = useMenuTree();
  const data = useMemo(() => menuTreeQuery.data ?? [], [menuTreeQuery.data]);
  const detailQuery = useMenuDetail(editingMenu?.id, modalVisible && !!editingMenu);
  const modalDetailLoading = !!editingMenu && detailQuery.isFetching;
  const saveMutation = useSaveMenu();
  const toggleStatusMutation = useSaveMenu();
  const deleteMutation = useDeleteMenu();

  useEffect(() => {
    const detail = detailQuery.data;
    if (!detail || !modalVisible || !editingMenu || detail.id !== editingMenu.id) return;
    setEditingMenu(detail);
    setParentId(detail.parentId ?? 0);
    setIconValue(detail.icon ?? '');
    setMenuType(detail.type);
    setIsExternalVal(detail.isExternal ?? false);
  }, [detailQuery.data, editingMenu, modalVisible]);

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

  const collectKeys = useCallback((items: Menu[]): (string | number)[] => {
    const keys: (string | number)[] = [];
    function walk(list: Menu[]) {
      for (const item of list) {
        keys.push(item.id);
        if (item.children?.length) walk(item.children);
      }
    }
    walk(items);
    return keys;
  }, []);

  // 有过滤条件时，数据变化后自动展开匹配节点
  useEffect(() => {
    if (keyword || statusFilter) {
      const filtered = filterTree(data, keyword, statusFilter);
      setExpandedRowKeys(collectKeys(filtered));
    }
  }, [data, keyword, statusFilter, filterTree, collectKeys]);

  const handleSearch = () => {
    setKeyword(pendingKeyword);
    setStatusFilter(pendingStatus);
    void queryClient.invalidateQueries({ queryKey: menuKeys.tree });
  };

  const handleReset = () => {
    setPendingKeyword('');
    setPendingStatus('');
    setKeyword('');
    setStatusFilter('');
    setExpandedRowKeys([]);
    void queryClient.invalidateQueries({ queryKey: menuKeys.tree });
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
    setIsExternalVal(false);
    setModalVisible(true);
  };

  const openEdit = (menu: Menu) => {
    setEditingMenu(menu);
    setParentId(menu.parentId ?? 0);
    setIconValue(menu.icon ?? '');
    setMenuType(menu.type);
    setIsExternalVal(menu.isExternal ?? false);
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
    await saveMutation.mutateAsync({ id: editingMenu?.id, values: payload });
    Toast.success(editingMenu ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingMenu(null);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleToggleStatus = useCallback(async (menu: Menu, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用菜单「${menu.title}」？`,
          content: '禁用后该菜单将不可访问。',
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    toggleStatusMutation.mutate(
      { id: menu.id, values: { status: newStatus } },
      { onSuccess: () => Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用') },
    );
  }, [toggleStatusMutation]);

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
      render: renderEllipsis,
    },
    {
      title: '组件路径',
      dataIndex: 'component',
      width: 250,
      render: renderEllipsis,
    },
    {
      title: '权限标识',
      dataIndex: 'permission',
      width: 200,
      render: renderEllipsis,
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 70,
      align: 'center',
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      align: 'center',
      fixed: 'right',
      render: (val: string, row: Menu) => row.type === 'button' ? '—' : (
        <Switch
          size="small"
          checked={val === 'enabled'}
          loading={togglingStatusId === row.id}
          disabled={!hasPermission('system:menu:update')}
          onChange={(checked: boolean) => void handleToggleStatus(row, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    {
      title: '显示',
      dataIndex: 'visible',
      width: 80,
      align: 'center',
      fixed: 'right',
      render: (val: boolean, row: Menu) => row.type === 'button' ? '—' : <DictTag dictCode="menu_visible" value={val ? 'show' : 'hidden'} />,
    },
    createOperationColumn<Menu>({
      width: 260,
      desktopInlineKeys: ['child', 'edit', 'delete'],
      actions: (row) => [
        {
          key: 'child',
          label: '子项',
          hidden: row.type === 'button' || !hasPermission('system:menu:create'),
          onClick: () => openCreate(row.id),
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:menu:update'),
          onClick: () => openEdit(row),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:menu:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确认删除此菜单？',
              content: '子菜单也将一并删除',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(row.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="菜单名称"
      showClear
      value={pendingKeyword}
      onChange={(val) => setPendingKeyword(val)}
      onEnterPress={handleSearch}
      style={{ width: 200, maxWidth: '100%' }}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="状态"
      showClear
      value={pendingStatus || undefined}
      onChange={(val) => setPendingStatus((val as string) ?? '')}
      style={{ width: 120, maxWidth: '100%' }}
    >
      {statusItems.map((i) => (
        <Select.Option key={i.value} value={i.value}>{i.label}</Select.Option>
      ))}
    </Select>
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  const renderExpandButton = () => (
    <Button
      type="primary"
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  );

  const renderCreateButton = () => hasPermission('system:menu:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => openCreate()}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderExpandButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={renderStatusFilter()}
        mobileActions={renderExpandButton()}
        filterTitle="菜单筛选"
        actionTitle="菜单操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={filteredData}
        rowKey="id"
        loading={menuTreeQuery.isFetching}
        onRefresh={() => void menuTreeQuery.refetch()}
        refreshLoading={menuTreeQuery.isFetching}
        pagination={false}
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={(rows) => setExpandedRowKeys(rows?.filter((r): r is Menu => 'id' in r).map((r) => r.id) ?? [])}
      />

      <AppModal
        title={editingMenu ? '编辑菜单' : '新增菜单'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingMenu(null); }}
        onOk={handleMenuModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={680}

      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          getFormApi={(api) => formApi.current = api}
          allowEmpty
          key={editingMenu ? `edit-${editingMenu.id}` : 'create'}
          initValues={
            editingMenu
              ? { ...editingMenu, visible: editingMenu.visible ? 'show' : 'hidden', isExternal: editingMenu.isExternal ?? false }
                : { type: 'menu', status: 'enabled', visible: 'show', sort: 0, parentId: parentId ?? 0, isExternal: false }
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
            {menuType !== 'button' && (
              <Col span={12}>
                <Form.Slot label={{ text: '图标' }}>
                  <IconPicker value={iconValue} onChange={setIconValue} />
                </Form.Slot>
              </Col>
            )}
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
            {menuType === 'menu' && !isExternalVal && (
              <Col span={12}>
                <Form.Input field="component" label="组件路径" placeholder="例如: users/UsersPage" rules={[{ required: true, message: '请输入组件路径' }]} />
              </Col>
            )}
            {menuType === 'menu' && !isExternalVal && (
              <Col span={12}>
                <Form.Input field="name" label="组件名" placeholder="前端组件Name" />
              </Col>
            )}
            {(menuType === 'menu' || menuType === 'directory') && (
              <Col span={12}>
                <Form.Input
                  field="query"
                  label={<Tooltip content='访问路由的默认传递参数，如：{"id": 1, "name": "ry"}'>路由参数</Tooltip>}
                  placeholder='如：{"id": 1, "name": "ry"}'
                />
              </Col>
            )}
            {(menuType === 'menu' || menuType === 'directory') && (
              <Col span={12}>
                <Form.RadioGroup
                  field="isExternal"
                  label={<Tooltip content="选择是外链则路由地址需要以 http(s):// 开头">是否外链</Tooltip>}
                  type="button"
                  initValue={false}
                  onChange={(e) => setIsExternalVal((e.target as HTMLInputElement).value as unknown as boolean)}
                >
                  <Radio value={true}>是</Radio>
                  <Radio value={false}>否</Radio>
                </Form.RadioGroup>
              </Col>
            )}
            {menuType === 'button' && (
              <Col span={12}>
                <Form.Input field="permission" label="权限标识" placeholder="请输入权限标识" rules={[{ required: true, message: '请输入权限标识' }]} />
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
      </AppModal>
    </div>
  );
}
