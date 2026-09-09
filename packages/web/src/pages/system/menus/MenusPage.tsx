import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Radio, TreeSelect, Row, Col, Spin, Tooltip, Banner } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { Menu } from '@zenith/shared/identity';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { renderLucideIcon } from '@/utils/icons';
import IconPicker from '@/components/IconPicker';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useElementSize } from '@/hooks/useElementSize';
import { useTreeExpansion } from '@/hooks/useTreeExpansion';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { menuKeys, useDeleteMenu, useMenuDetail, useMenuTree, useSaveMenu, type MenuFormValues } from '@/hooks/queries/menus';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, useStatusToggle } from '@/components/list-page';

export default function MenusPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const createParentIdRef = useRef<number>(0);
  const [parentId, setParentId] = useState<number | null>(null);
  const [iconValue, setIconValue] = useState('');
  const [menuType, setMenuType] = useState<string>('menu');
  const [isExternalVal, setIsExternalVal] = useState<boolean>(false);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [pendingKeyword, setPendingKeyword] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string | undefined>();
  const { ref: tableWrapperRef, height: tableHeight } = useElementSize<HTMLDivElement>({ height: 500 });

  const { items: menuTypeItems } = useDictItems('menu_type');
  const { items: statusItems } = useDictItems('common_status');
  const { items: menuVisibleItems } = useDictItems('menu_visible');

  const menuTreeQuery = useMenuTree();
  const data = useMemo(() => menuTreeQuery.data ?? [], [menuTreeQuery.data]);
  const saveMutation = useSaveMenu();
  const menuModal = useEditModal<Menu, Record<string, unknown>, MenuFormValues>({
    entityName: '菜单',
    save: saveMutation,
    useDetail: useMenuDetail,
    defaults: () => ({
      type: 'menu',
      status: 'enabled',
      visible: 'show',
      sort: 0,
      parentId: createParentIdRef.current,
      isExternal: false,
      embed: false,
      keepAlive: false,
    }),
    toValues: (menu) => ({
      ...menu,
      visible: menu.visible ? 'show' : 'hidden',
      isExternal: menu.isExternal ?? false,
      embed: menu.embed ?? false,
      keepAlive: menu.keepAlive ?? false,
    }),
    // 表单以宽松键值对维护（visible 用 show/hidden 字典值），提交前收敛为创建入参形态
    beforeSave: (values): MenuFormValues => ({
      ...(values as MenuFormValues),
      parentId: parentId ?? 0,
      icon: iconValue || undefined,
      visible: values.visible === undefined ? true : values.visible === 'show',
      embed: values.isExternal ? ((values.embed as boolean | undefined) ?? false) : false,
    }),
  });
  const toggleStatusMutation = useSaveMenu();
  const deleteMutation = useDeleteMenu();

  useEffect(() => {
    const detail = menuModal.editing;
    if (!detail || !menuModal.visible) return;
    setParentId(detail.parentId ?? 0);
    setIconValue(detail.icon ?? '');
    setMenuType(detail.type);
    setIsExternalVal(detail.isExternal ?? false);
  }, [menuModal.editing, menuModal.visible]);

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

  // 展开态跟随**表格实际渲染的** filteredData：跟未筛选的全量树比较会让筛选后
  // 已全部展开的表格仍显示「全部展开」，点击后可见区域毫无变化
  const {
    expandedRowKeys, setExpandedRowKeys, allRowKeys,
    isAllExpanded, toggleExpandAll, onExpandedRowsChange,
  } = useTreeExpansion(filteredData);

  // 有过滤条件时，数据变化后自动展开匹配节点
  useEffect(() => {
    if (keyword || statusFilter) {
      setExpandedRowKeys(allRowKeys);
    }
  }, [keyword, statusFilter, allRowKeys, setExpandedRowKeys]);

  const handleSearch = () => {
    setKeyword(pendingKeyword);
    setStatusFilter(pendingStatus ?? '');
    void queryClient.invalidateQueries({ queryKey: menuKeys.tree });
  };

  const handleReset = () => {
    setPendingKeyword('');
    setPendingStatus(undefined);
    setKeyword('');
    setStatusFilter('');
    setExpandedRowKeys([]);
    void queryClient.invalidateQueries({ queryKey: menuKeys.tree });
  };

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
    const nextParentId = pid ?? 0;
    createParentIdRef.current = nextParentId;
    setParentId(nextParentId);
    setIconValue('');
    setMenuType('menu');
    setIsExternalVal(false);
    menuModal.openCreate();
  };

  const openEdit = (menu: Menu) => {
    setParentId(menu.parentId ?? 0);
    setIconValue(menu.icon ?? '');
    setMenuType(menu.type);
    setIsExternalVal(menu.isExternal ?? false);
    menuModal.openEdit(menu);
  };

  const status = useStatusToggle<Menu>({
    toggle: (menu, enabled) => toggleStatusMutation.mutateAsync({ id: menu.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (menu) => ({ danger: true, title: `确认禁用菜单「${menu.title}」？`, content: '禁用后该菜单将不可访问。', okText: '确认禁用' }),
    disabled: !hasPermission('system:menu:update'),
  });

  const columns: ColumnProps<Menu>[] = [
    {
      title: '菜单名称',
      dataIndex: 'title',
      minWidth: 280,
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
      fixed: 'right',
      render: (_val: string, row: Menu) => row.type === 'button' ? '—' : status.renderSwitch(row),
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
      width: 210,
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
        deleteAction({
          hidden: !hasPermission('system:menu:delete'),
          title: '确认删除此菜单？',
          content: '子菜单也将一并删除',
          run: () => deleteMutation.mutateAsync({ params: { id: row.id } }),
        }),
      ],
    }),
  ];

  const renderExpandButton = () => (
    <Button
      type="primary"
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  );

  return (
    <div className="page-container" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="菜单名称" value={pendingKeyword} onChange={setPendingKeyword} onSearch={handleSearch} width={200} />}
        filters={<StatusSelect items={statusItems} value={pendingStatus} onChange={setPendingStatus} />}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('system:menu:create') ? (
            <CreateButton onClick={() => openCreate()} />
          ) : null
        )}
        actions={renderExpandButton()}
        mobileActions={renderExpandButton()}
        filterTitle="菜单筛选"
        actionTitle="菜单操作"
      />

      {menuTreeQuery.isError && (
        <Banner
          fullMode={false}
          type="danger"
          bordered
          closeIcon={null}
          description="菜单数据加载失败，请检查网络后点击表格右上角刷新重试"
          style={{ marginBottom: 12 }}
        />
      )}

      <div ref={tableWrapperRef} style={{ flex: 1, minHeight: 0 }}>
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
          onExpandedRowsChange={onExpandedRowsChange}
          childrenRecordName="children"
          virtualized
          scroll={{ y: tableHeight }}
        />
      </div>

      <AppModal
        {...menuModal.modalProps}
        width={680}

      >
        <Spin spinning={menuModal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={menuModal.formKey} {...menuModal.formProps}>
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
              showFilteredOnly
              virtualize={{ height: 300, itemSize: 36 }}
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
                  onChange={(e) => setIsExternalVal((e.target as HTMLInputElement).value as unknown as boolean)}
                >
                  <Radio value={true}>是</Radio>
                  <Radio value={false}>否</Radio>
                </Form.RadioGroup>
              </Col>
            )}
            {(menuType === 'menu' || menuType === 'directory') && isExternalVal && (
              <Col span={12}>
                <Form.RadioGroup
                  field="embed"
                  label={<Tooltip content="内嵌：在系统内以 iframe 打开外链，保留侧边栏与页签；新窗口：浏览器新标签页打开">打开方式</Tooltip>}
                  type="button"
                >
                  <Radio value={false}>新窗口</Radio>
                  <Radio value={true}>内嵌</Radio>
                </Form.RadioGroup>
              </Col>
            )}
            {menuType === 'menu' && (
              <Col span={12}>
                <Form.RadioGroup
                  field="keepAlive"
                  label={<Tooltip content="开启后，多页签模式下切换页签保留该页面状态（搜索条件、滚动位置等），关闭页签时释放">页面缓存</Tooltip>}
                  type="button"
                >
                  <Radio value={true}>开启</Radio>
                  <Radio value={false}>关闭</Radio>
                </Form.RadioGroup>
              </Col>
            )}
            {menuType === 'button' && (
              <Col span={12}>
                <Form.Input field="permission" label="权限标识" placeholder="如：system:user:list" rules={[{ required: true, message: '请输入权限标识' }]} />
              </Col>
            )}
            <Col span={12}>
              <Form.InputNumber field="sort" label="排序" placeholder="请输入排序" min={0} style={{ width: '100%' }} />
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
