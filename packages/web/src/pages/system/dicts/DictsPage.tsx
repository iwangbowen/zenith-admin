import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dropdown,
  Select,
  Tag,
  Form,
  Pagination,
  Spin,
  Toast,
  TreeSelect,
  JsonViewer,
  Row,
  Col,
  Space,
  Switch,
} from '@douyinfe/semi-ui';
import { Plus, MoreHorizontal, BookOpen, ChevronsDownUp, ChevronsUpDown, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import type { CreateDictInput, CreateDictItemInput, Dict, DictItem } from '@zenith/shared/platform';
import { formatDateTime } from '@/utils/date';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { useTreeExpansion } from '@/hooks/useTreeExpansion';
import { useUrlSelectionState } from '@/hooks/useUrlSelectionState';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { usePermission } from '@/hooks/usePermission';
import './DictsPage.css';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import {
  dictKeys,
  useCreateDictItem,
  useDeleteDictItem,
  useDeleteDicts,
  useDictDetail,
  useDictItemDetail,
  useDictItemsById,
  useDictList,
  useSaveDict,
  useUpdateDictItem,
} from '@/hooks/queries/dicts';
import { CreateButton } from '@/components/toolbar-controls';
import { confirmDelete, confirmDangerAsync } from '@/utils/confirm';
import { deleteAction, ListSearchToolbar, useStatusToggle } from '@/components/list-page';
import { abortSubmit } from '@/lib/abort-submit';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { compactParams } from '@/lib/query';

/** 字典项详情按 (dictId, itemId) 取数；useEditModal 只传 itemId，所属字典从打开弹窗时的行记录取 */
function useDictItemModalDetail(id: number | undefined, enabled?: boolean, record?: DictItem) {
  return useDictItemDetail(record?.dictId, id, enabled);
}

export default function DictsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonViewerRef = useRef<any>(null);

  // ─── 字典列表 ──────────────────────────────────────────────────────────────
  const [dicts, setDicts] = useState<Dict[]>([]);
  const {
    page, pageSize, setPage, setPageSize,
    draftParams, setField, submittedParams, handleSearch,
  } = useListSearch<{ keyword: string }>({ defaults: { keyword: '' }, listKey: dictKeys.lists });
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
  }), [submittedParams]);
  // ─── 字典项列表 ────────────────────────────────────────────────────────────
  // 显式选中的字典以 `?dict=` 同步到 URL（深链/刷新/页签直达）；选中对象按 key 派生
  const [selectedDictKey, setSelectedDictKey] = useUrlSelectionState('dict');
  const [pendingItemKeyword, setPendingItemKeyword] = useState('');
  const [pendingItemStatus, setPendingItemStatus] = useState<string | undefined>();
  const [itemKeyword, setItemKeyword] = useState('');
  const [itemStatusFilter, setItemStatusFilter] = useState<string | undefined>();
  const [itemParentId, setItemParentId] = useState<number | null>(null);
  const [itemColor, setItemColor] = useState<string | null>(null);
  // metadataStr 仅用于 JsonViewer 的初始值（非受控），提交时通过 ref.getValue() 读取
  const [metadataStr, setMetadataStr] = useState<string>('{}');
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');
  const tagColor = (color: string) => color as ComponentProps<typeof Tag>['color'];

  // 单栏（窄屏）下 showDetail 由 selectedDict 驱动，若沿用桌面端「默认选中第一项」
  // 会直接落到字典项详情，字典列表反而要点返回才能看到。布局形态参与选中派生，故用 state。
  const [isNarrowLayout, setIsNarrowLayout] = useState(false);

  // ─── 数据获取 ──────────────────────────────────────────────────────────────
  const dictListQuery = useDictList({
    page,
    pageSize,
    ...filterQuery,
  });
  const total = dictListQuery.data?.total ?? 0;

  // 选中派生：URL 深链值优先；无深链时桌面端回退首项（默认选中不入 URL），窄屏不自动选中。
  // 深链目标可能不在当前页/当前筛选（列表分页），成员资格不可当存在性判据，
  // 不在页内时按 id 拉详情兜底，仅确认无效（非法 id / 404）才清参回退
  const explicitId = selectedDictKey !== null ? Number(selectedDictKey) : undefined;
  const explicitIdValid = explicitId !== undefined && Number.isInteger(explicitId) && explicitId > 0;
  const dictInPage = explicitIdValid ? dicts.find((d) => d.id === explicitId) ?? null : null;
  const dictFallbackQuery = useDictDetail(explicitId, explicitIdValid && !dictInPage);
  const explicitDict = dictInPage
    ?? (dictFallbackQuery.data && dictFallbackQuery.data.id === explicitId ? dictFallbackQuery.data : null);
  const selectedDict = explicitDict ?? (isNarrowLayout ? null : dicts[0] ?? null);

  useEffect(() => {
    if (selectedDictKey === null) return;
    if (!explicitIdValid || dictFallbackQuery.isError) setSelectedDictKey(null);
  }, [selectedDictKey, explicitIdValid, dictFallbackQuery.isError, setSelectedDictKey]);

  const itemsQuery = useDictItemsById(selectedDict?.id);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);

  const saveDictMutation = useSaveDict();
  const dictModal = useEditModal<Dict, Partial<CreateDictInput>>({
    entityName: '字典',
    save: saveDictMutation,
    useDetail: useDictDetail,
    defaults: { status: 'enabled' },
  });
  const toggleDictStatusMutation = useSaveDict();
  const deleteDictMutation = useDeleteDicts();
  const createItemMutation = useCreateDictItem();
  const updateItemMutation = useUpdateDictItem();
  const toggleItemStatusMutation = useUpdateDictItem();
  const deleteItemMutation = useDeleteDictItem();
  const togglingDictStatusId = toggleDictStatusMutation.isPending ? (toggleDictStatusMutation.variables?.id ?? null) : null;

  // 字典项是所选字典的子资源：创建 / 更新契约都绑定 dictId，由 save 适配层按是否有 id 分派；
  // 父级 / 颜色 / 元数据不在 Semi 表单内（Form.Slot 受控控件），在 beforeSave 合入载荷
  const itemModal = useEditModal<DictItem, Partial<CreateDictItemInput>, CreateDictItemInput>({
    entityName: '字典项',
    save: {
      mutateAsync: ({ id, values }) => {
        if (!selectedDict) abortSubmit('validation');
        return id === undefined
          ? createItemMutation.mutateAsync({ params: { id: selectedDict.id }, body: values })
          : updateItemMutation.mutateAsync({ params: { id: selectedDict.id, itemId: id }, body: values });
      },
      isPending: createItemMutation.isPending || updateItemMutation.isPending,
    },
    useDetail: useDictItemModalDetail,
    defaults: { status: 'enabled', sort: 0 },
    toValues: (item) => ({ label: item.label, value: item.value, sort: item.sort, status: item.status, remark: item.remark ?? undefined }),
    beforeSave: (values) => {
      let metadata: Record<string, unknown> | null = null;
      const currentJson = (jsonViewerRef.current?.getValue() ?? metadataStr).trim();
      if (currentJson && currentJson !== '{}') {
        try {
          metadata = JSON.parse(currentJson) as Record<string, unknown>;
        } catch {
          Toast.error('元数据 JSON 格式有误，请检查后重试');
          abortSubmit();
        }
      }
      // 表单值来自 Semi validate()，形状由表单字段决定；label / value 必填由表单 rules 保证
      return { ...values, parentId: itemParentId ?? undefined, color: itemColor ?? null, metadata } as CreateDictItemInput;
    },
    labelWidth: 72,
  });
  const editingItem = itemModal.editing;

  useEffect(() => {
    if (!dictListQuery.data) return;
    setDicts(dictListQuery.data.list);
  }, [dictListQuery.data]);

  // 每个字典的条目首次加载完成时默认全展开；同一字典内（数据刷新 / keepAlive 页签切回）保持用户展开/折叠状态
  const expandInitedDictIdRef = useRef<number | null>(null);

  // 打开瞬间先按列表行占位，详情到达后（editing 切换为详情对象）用服务端值覆盖表单外的父级 / 颜色 / 元数据
  useEffect(() => {
    if (!editingItem) return;
    setItemParentId(editingItem.parentId ?? null);
    setItemColor(editingItem.color ?? null);
    setMetadataStr(editingItem.metadata ? JSON.stringify(editingItem.metadata, null, 2) : '{}');
  }, [editingItem]);

  const handleDictPageChange = (nextPage: number) => {
    setPage(nextPage);
  };

  const handleDictPageSizeChange = (nextPageSize: number) => {
    setPage(1);
    setPageSize(nextPageSize);
  };

  const selectDict = (dict: Dict) => {
    setSelectedDictKey(String(dict.id));
    setPendingItemKeyword('');
    setPendingItemStatus(undefined);
    setItemKeyword('');
    setItemStatusFilter(undefined);
  };

  function handleItemSearch() {
    setItemKeyword(pendingItemKeyword);
    setItemStatusFilter(pendingItemStatus);
    if (selectedDict) void queryClient.invalidateQueries({ queryKey: dictKeys.items(selectedDict.id) });
  }

  function handleItemReset() {
    setPendingItemKeyword('');
    setPendingItemStatus(undefined);
    setItemKeyword('');
    setItemStatusFilter(undefined);
    if (selectedDict) void queryClient.invalidateQueries({ queryKey: dictKeys.items(selectedDict.id) });
  }

  const filteredItems = useMemo(() => {
    const flat = items.filter((item) => {
      if (itemKeyword && !item.label.includes(itemKeyword) && !item.value.includes(itemKeyword)) return false;
      if (itemStatusFilter && item.status !== itemStatusFilter) return false;
      return true;
    });
    return flat;
  }, [items, itemKeyword, itemStatusFilter]);

  // 将扁平列表递归转为树结构，用于表格展示
  const treeItems = useMemo(() => {
    const filteredIds = new Set(filteredItems.map((i) => i.id));
    const buildChildren = (id: number): DictItem[] =>
      filteredItems
        .filter((c) => c.parentId === id)
        .map((c) => {
          const grandchildren = buildChildren(c.id);
          return grandchildren.length > 0 ? { ...c, children: grandchildren } : c;
        });
    return filteredItems
      .filter((i) => !i.parentId || !filteredIds.has(i.parentId))
      .map((item) => {
        const children = buildChildren(item.id);
        return children.length > 0 ? { ...item, children } : item;
      });
  }, [filteredItems]);

  const {
    expandedRowKeys, setExpandedRowKeys, allRowKeys,
    isAllExpanded, toggleExpandAll, onExpandedRowsChange,
  } = useTreeExpansion(treeItems);

  useEffect(() => {
    if (!selectedDict || itemsQuery.data === undefined) return;
    if (expandInitedDictIdRef.current === selectedDict.id) return;
    expandInitedDictIdRef.current = selectedDict.id;
    setExpandedRowKeys(allRowKeys);
  }, [selectedDict, itemsQuery.data, allRowKeys, setExpandedRowKeys]);

  // 编辑项的子孙节点 id 集合（父级选择器中禁用，避免循环引用）
  const editingSubtreeIds = useMemo(() => {
    if (!editingItem) return new Set<number>();
    const result = new Set<number>([editingItem.id]);
    const addDescendants = (id: number) => {
      items.filter((i) => i.parentId === id).forEach((child) => {
        result.add(child.id);
        addDescendants(child.id);
      });
    };
    addDescendants(editingItem.id);
    return result;
  }, [editingItem, items]);

  // 父级选择器的树形数据（递归构建，排除编辑项及其子孙）
  const parentSelectorTreeData = useMemo(() => {
    type SNode = { label: string; value: number; key: string; disabled?: boolean; children?: SNode[] };
    const buildTree = (parentId: number | null): SNode[] =>
      items
        .filter((i) => (i.parentId ?? null) === parentId)
        .map((item) => ({
          label: item.label,
          value: item.id,
          key: String(item.id),
          disabled: editingSubtreeIds.has(item.id),
          children: buildTree(item.id),
        }));
    return [
      { label: '无（根项目）', value: 0, key: '0' },
      ...buildTree(null),
    ];
  }, [items, editingSubtreeIds]);

  // ─── 字典 CRUD ─────────────────────────────────────────────────────────────
  const openEditDict = (row: Dict) => {
    dictModal.openEdit(row);
  };

  const handleDictDelete = async (id: number) => {
    await deleteDictMutation.mutateAsync([id]);
    Toast.success('删除成功');
    if (selectedDictKey === String(id)) {
      setSelectedDictKey(null);
    }
  };

  // ─── 字典项 CRUD ───────────────────────────────────────────────────────────
  const handleItemDelete = async (id: number) => {
    if (!selectedDict) return;
    await deleteItemMutation.mutateAsync({ params: { id: selectedDict.id, itemId: id } });
    Toast.success('删除成功');
  };

  const openCreateItem = (parentId: number | null = null) => {
    setItemParentId(parentId);
    setItemColor(null);
    setMetadataStr('{}');
    itemModal.openCreate();
  };

  const openCreateChildItem = (row: DictItem) => openCreateItem(row.id);

  const openEditItem = (row: DictItem) => {
    if (!selectedDict) return;
    setItemParentId(row.parentId ?? null);
    setItemColor(row.color ?? null);
    setMetadataStr(row.metadata ? JSON.stringify(row.metadata, null, 2) : '{}');
    itemModal.openEdit(row);
  };

  const itemStatus = useStatusToggle<DictItem>({
    toggle: (item, enabled) => {
      if (!selectedDict) return Promise.resolve();
      return toggleItemStatusMutation.mutateAsync({ params: { id: selectedDict.id, itemId: item.id }, body: { status: enabled ? 'enabled' : 'disabled' } });
    },
    confirmDisable: (item) => ({ danger: true, title: `确认禁用字典项「${item.label}」？`, okText: '确认禁用' }),
    disabled: !selectedDict || !hasPermission('system:dict:item'),
  });

  const handleToggleDictStatus = async (dict: Dict, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await confirmDangerAsync({
        title: `确认禁用字典「${dict.name}」？`,
        okText: '确认禁用',
      });
      if (!confirmed) return;
    }
    await toggleDictStatusMutation.mutateAsync({ id: dict.id, values: { status: newStatus } });
    Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
  };

  const renderDictListItem = (dict: Dict) => {
    const active = selectedDict?.id === dict.id;
    return (
      <NavListItem
        key={dict.id}
        active={active}
        onClick={() => selectDict(dict)}
        primary={dict.name}
        secondary={dict.code}
        meta={dict.status === 'disabled'
          ? <span style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>{formatDateTime(dict.createdAt)}</span><Tag size="small" color="grey">停用</Tag></span>
          : formatDateTime(dict.createdAt)
        }
        style={dict.status === 'disabled' ? { opacity: 0.55 } : undefined}
        extra={
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                {hasPermission('system:dict:update') && (
                  <Dropdown.Item onClick={() => void openEditDict(dict)}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Pencil size={14} /> 编辑
                    </span>
                  </Dropdown.Item>
                )}
                {hasPermission('system:dict:delete') && (
                  <Dropdown.Item
                    type="danger"
                    onClick={() => {
                      confirmDelete({
                        title: '确认删除此字典？',
                        content: '字典下的所有字典项也将一并删除',
                        onOk: () => handleDictDelete(dict.id),
                      });
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Trash2 size={14} /> 删除
                    </span>
                  </Dropdown.Item>
                )}
              </Dropdown.Menu>
            }
          >
            <Button
              theme="borderless"
              size="small"
              icon={<MoreHorizontal size={14} />}
              onClick={(e) => e.stopPropagation()}
            />
          </Dropdown>
        }
      />
    );
  };

  const dictMaster = (
    <NavListPanel
      title="字典列表"
      headerExtra={
        <Space spacing={6}>
          <ExportButton entity="system.dicts" query={filterQuery} />
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => void dictListQuery.refetch()}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RefreshCw size={14} /> 刷新
                  </span>
                </Dropdown.Item>
                {hasPermission('system:dict:create') && (
                  <Dropdown.Item onClick={dictModal.openCreate}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={14} /> 新增字典
                    </span>
                  </Dropdown.Item>
                )}
              </Dropdown.Menu>
            }
          >
            <Button
              theme="borderless"
              size="small"
              icon={<MoreHorizontal size={14} />}
            />
          </Dropdown>
        </Space>
      }
      search={{
        value: draftParams.keyword,
        onChange: setField('keyword'),
        placeholder: '名称/编码',
        onEnterPress: handleSearch,
      }}
      loading={dictListQuery.isFetching}
      emptyText="暂无字典"
      footer={
        <Pagination
          size="small"
          total={total}
          currentPage={page}
          pageSize={pageSize}
          pageSizeOpts={[10, 20, 50, 100]}
          showSizeChanger
          showTotal
          onPageChange={handleDictPageChange}
          onPageSizeChange={handleDictPageSizeChange}
        />
      }
      dataSource={dicts}
      renderItem={renderDictListItem}
    />
  );

  const itemColumns: ColumnProps<DictItem>[] = [
    { title: '标签', dataIndex: 'label', width: 160, render: (v: string, record: DictItem) =>
      record.color ? <Tag color={tagColor(record.color)} size="small">{v}</Tag> : renderEllipsis(v)
    },
    { title: '键值', dataIndex: 'value', width: 160, render: renderEllipsis },
    { title: '排序', dataIndex: 'sort', width: 70, align: 'center' },
    { title: '备注', dataIndex: 'remark', minWidth: 200, render: renderEllipsis },
    createdAtColumn,
    itemStatus.column(),
    createOperationColumn<DictItem>({
      width: 210,
      desktopInlineKeys: ['child', 'edit', 'delete'],
      actions: (row) => [
        {
          key: 'child',
          label: '子项',
          hidden: !hasPermission('system:dict:item'),
          onClick: () => openCreateChildItem(row),
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:dict:item'),
          onClick: () => openEditItem(row),
        },
        deleteAction({
          hidden: !hasPermission('system:dict:item'),
          title: '确认删除此字典项？',
          run: () => handleItemDelete(row.id),
        }),
      ],
    }),
  ];

  const renderItemExpandButton = () => allRowKeys.length > 0 ? (
    <Button
      type="primary"
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
      disabled={!selectedDict}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  ) : null;

  const dictDetail = (
    <>
      <MasterDetailLayout.Header>
        {selectedDict ? (
          <>
            <div className="dict-detail-title">
              <BookOpen size={16} />
              <span title={selectedDict.name}>{selectedDict.name}</span>
            </div>
            <Tag size="small" color="blue">{selectedDict.code}</Tag>
            <Switch
              size="small"
              checked={selectedDict.status === 'enabled'}
              loading={togglingDictStatusId === selectedDict.id}
              disabled={!hasPermission('system:dict:update')}
              onChange={(checked: boolean) => void handleToggleDictStatus(selectedDict, checked ? 'enabled' : 'disabled')}
            />
          </>
        ) : (
          <span className="dict-detail-placeholder">请选择字典</span>
        )}
      </MasterDetailLayout.Header>
      <MasterDetailLayout.Body>
        <ListSearchToolbar
          keyword={(
            <KeywordInput
              placeholder="标签/键值"
              value={pendingItemKeyword}
              onChange={setPendingItemKeyword}
              onSearch={handleItemSearch}
              width={180}
              disabled={!selectedDict}
            />
          )}
          filters={(
            <StatusSelect
              items={statusItems}
              value={pendingItemStatus}
              onChange={setPendingItemStatus}
              disabled={!selectedDict}
            />
          )}
          onSearch={handleItemSearch}
          onReset={handleItemReset}
          create={(
            hasPermission('system:dict:item') ? (
              <CreateButton onClick={() => openCreateItem()} disabled={!selectedDict} />
            ) : null
          )}
          actions={renderItemExpandButton()}
          mobileActions={renderItemExpandButton()}
          filterTitle="字典项筛选"
          actionTitle="字典项操作"
        />
        <ConfigurableTable
          bordered
          columns={itemColumns}
          dataSource={treeItems}
          rowKey="id"
          loading={itemsQuery.isFetching}
          onRefresh={selectedDict ? () => void itemsQuery.refetch() : undefined}
          refreshLoading={itemsQuery.isFetching}
          pagination={false}
          size="small"
          empty={selectedDict ? '暂无数据' : '请选择字典'}
          childrenRecordName="children"
          expandedRowKeys={expandedRowKeys}
          onExpandedRowsChange={onExpandedRowsChange}
        />
      </MasterDetailLayout.Body>
    </>
  );

  return (
    <div className="page-container page-container--stretch">
      <MasterDetailLayout
        master={dictMaster}
        detail={dictDetail}
        defaultSize={300}
        minSize={260}
        maxSize={420}
        persistKey="dicts"
        showDetail={!!selectedDict}
        onBack={() => setSelectedDictKey(null)}
        onResponsiveChange={setIsNarrowLayout}
        style={{ flex: 1, overflow: 'hidden' }}
      />

      {/* 字典创建/编辑 Modal */}
      <AppModal
        {...dictModal.modalProps}
        width={480}

      >
        <Spin spinning={dictModal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={dictModal.formKey} {...dictModal.formProps}
        >
          <Form.Input field="name" label="字典名称" placeholder="请输入字典名称" style={{ width: '100%' }} rules={[{ required: true, message: '请输入字典名称' }]} />
          <Form.Input field="code" label="字典编码" placeholder="请输入字典编码" style={{ width: '100%' }} rules={[{ required: true, message: '请输入字典编码' }]} />
          <Form.Input field="description" label="描述" placeholder="请输入描述" style={{ width: '100%' }} />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusOptions}
            placeholder="请选择状态"
          />
        </Form>
        </Spin>
      </AppModal>

      {/* 字典项创建/编辑 Modal */}
      <AppModal {...itemModal.modalProps} width={600}>
        <Spin spinning={itemModal.detailLoading}>
          <Form key={itemModal.formKey} {...itemModal.formProps}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="label" label="标签" placeholder="请输入标签" style={{ width: '100%' }} rules={[{ required: true, message: '请输入标签' }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="value" label="键值" placeholder="请输入键值" style={{ width: '100%' }} rules={[{ required: true, message: '请输入键值' }]} />
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="sort" label="排序" placeholder="请输入排序" min={0} style={{ width: '100%' }} />
              </Col>
              <Col span={12}>
                <Form.Select
                  field="status"
                  label="状态"
                  style={{ width: '100%' }}
                  optionList={statusOptions}
                  placeholder="请选择状态"
                />
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Slot label={{ text: '父级' }}>
                  <TreeSelect
                    treeData={parentSelectorTreeData}
                    value={itemParentId ?? 0}
                    onChange={(val) => setItemParentId(val === 0 ? null : (val as number))}
                    style={{ width: '100%' }}
                    filterTreeNode
                    expandAll
                  />
                </Form.Slot>
              </Col>
              <Col span={12}>
                <Form.Slot label={{ text: '颜色' }}>
                  {(() => {
                    const TAG_COLORS = ['amber', 'blue', 'cyan', 'green', 'grey', 'indigo', 'light-blue', 'light-green', 'lime', 'orange', 'pink', 'purple', 'red', 'teal', 'violet', 'yellow', 'white'];
                    const COLOR_LABELS: Record<string, string> = {
                      amber: '琥珀', blue: '蓝色', cyan: '青色', green: '绿色', grey: '灰色',
                      indigo: '靛蓝', 'light-blue': '浅蓝', 'light-green': '浅绿', lime: '柠绿',
                      orange: '橙色', pink: '粉色', purple: '紫色', red: '红色', teal: '蓝绿',
                      violet: '紫罗兰', yellow: '黄色', white: '白色',
                    };
                    return (
                      <Select
                        value={itemColor ?? undefined}
                        onChange={(val) => setItemColor((val as string) ?? null)}
                        placeholder="无颜色"
                        showClear
                        onClear={() => setItemColor(null)}
                        style={{ width: '100%' }}
                        renderSelectedItem={(option: { value?: unknown; label?: unknown }) => (
                          <Tag color={tagColor(option.value as string)} size="small" style={{ margin: '2px 0' }}>
                            {option.label as string}
                          </Tag>
                        )}
                        renderOptionItem={({ selected, style, onClick, value, label }) => (
                          <button
                            type="button"
                            onClick={onClick}
                            style={{
                              ...style,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '6px 12px',
                              cursor: 'pointer',
                              width: '100%',
                              border: 'none',
                              background: selected ? 'var(--semi-color-primary-light-default)' : 'transparent',
                              textAlign: 'left',
                            }}
                          >
                            <Tag color={tagColor(value as string)} size="small">{label as string}</Tag>
                          </button>
                        )}
                      >
                        {TAG_COLORS.map((c) => (
                          <Select.Option key={c} value={c} label={COLOR_LABELS[c] ?? c}>
                            <Tag color={tagColor(c)} size="small">{COLOR_LABELS[c] ?? c}</Tag>
                          </Select.Option>
                        ))}
                      </Select>
                    );
                  })()}
                </Form.Slot>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={24}>
                <Form.Input field="remark" label="备注" placeholder="请输入备注" style={{ width: '100%' }} />
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={24}>
                <Form.Slot label={{ text: '元数据' }}>
                  <JsonViewer
                    key={metadataStr}
                    ref={jsonViewerRef}
                    value={metadataStr}
                    height={200}
                    width="100%"
                  />
                </Form.Slot>
              </Col>
            </Row>
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
