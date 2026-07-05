import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dropdown,
  Input,
  Select,
  Tag,
  Modal,
  Form,
  Pagination,
  Spin,
  Toast,
  TreeSelect,
  JsonViewer,
  Row,
  Col,
  Switch,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, MoreHorizontal, BookOpen, ChevronsDownUp, ChevronsUpDown, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import type { Dict, DictItem } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
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
  useDeleteDict,
  useDeleteDictItem,
  useDictDetail,
  useDictItemDetail,
  useDictItemsById,
  useDictList,
  useSaveDict,
  useSaveDictItem,
} from '@/hooks/queries/dicts';

export default function DictsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const dictFormApi = useRef<FormApi | null>(null);
  const itemFormApi = useRef<FormApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonViewerRef = useRef<any>(null);

  // ─── 字典列表 ──────────────────────────────────────────────────────────────
  const [dicts, setDicts] = useState<Dict[]>([]);
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const { page, pageSize, setPage, setPageSize } = usePagination();
  const [dictModalVisible, setDictModalVisible] = useState(false);
  const [editingDictRecord, setEditingDictRecord] = useState<Dict | null>(null);

  // ─── 字典项列表 ────────────────────────────────────────────────────────────
  const [selectedDict, setSelectedDict] = useState<Dict | null>(null);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItemRecord, setEditingItemRecord] = useState<DictItem | null>(null);
  const [pendingItemKeyword, setPendingItemKeyword] = useState('');
  const [pendingItemStatus, setPendingItemStatus] = useState('');
  const [itemKeyword, setItemKeyword] = useState('');
  const [itemStatusFilter, setItemStatusFilter] = useState('');  const [expandedRowKeys, setExpandedRowKeys] = useState<(string | number)[]>([]);
  const [itemParentId, setItemParentId] = useState<number | null>(null);
  const [itemColor, setItemColor] = useState<string | null>(null);
  // metadataStr 仅用于 JsonViewer 的初始值（非受控），提交时通过 ref.getValue() 读取
  const [metadataStr, setMetadataStr] = useState<string>('{}');
  const { items: statusItems } = useDictItems('common_status');
  const tagColor = (color: string) => color as ComponentProps<typeof Tag>['color'];

  // ─── 数据获取 ──────────────────────────────────────────────────────────────
  const dictListQuery = useDictList({
    page,
    pageSize,
    keyword: submittedKeyword || undefined,
  });
  const total = dictListQuery.data?.total ?? 0;
  const dictDetailQuery = useDictDetail(editingDictRecord?.id, dictModalVisible);
  const editingDict = editingDictRecord ? (dictDetailQuery.data ?? editingDictRecord) : null;
  const itemsQuery = useDictItemsById(selectedDict?.id);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const itemDetailQuery = useDictItemDetail(selectedDict?.id, editingItemRecord?.id, itemModalVisible);
  const editingItem = editingItemRecord ? (itemDetailQuery.data ?? editingItemRecord) : null;

  const saveDictMutation = useSaveDict();
  const toggleDictStatusMutation = useSaveDict();
  const deleteDictMutation = useDeleteDict();
  const saveItemMutation = useSaveDictItem();
  const toggleItemStatusMutation = useSaveDictItem();
  const deleteItemMutation = useDeleteDictItem();
  const togglingItemStatusId = toggleItemStatusMutation.isPending ? (toggleItemStatusMutation.variables?.itemId ?? null) : null;
  const togglingDictStatusId = toggleDictStatusMutation.isPending ? (toggleDictStatusMutation.variables?.id ?? null) : null;

  useEffect(() => {
    const nextList = dictListQuery.data?.list ?? [];
    setDicts(nextList);
    setSelectedDict((prev) => {
      if (nextList.length === 0) return null;
      const current = prev ? nextList.find((d) => d.id === prev.id) : null;
      return current ?? nextList[0];
    });
  }, [dictListQuery.data]);

  // 每个字典的条目首次加载完成时默认全展开；同一字典内（数据刷新 / keepAlive 页签切回）保持用户展开/折叠状态
  const expandInitedDictIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedDict || itemsQuery.data === undefined) return;
    if (expandInitedDictIdRef.current === selectedDict.id) return;
    expandInitedDictIdRef.current = selectedDict.id;
    setExpandedRowKeys(items.map((i) => i.id));
  }, [selectedDict, items, itemsQuery.data]);

  useEffect(() => {
    if (!itemModalVisible || !itemDetailQuery.data) return;
    setItemParentId(itemDetailQuery.data.parentId ?? null);
    setItemColor(itemDetailQuery.data.color ?? null);
    setMetadataStr(itemDetailQuery.data.metadata ? JSON.stringify(itemDetailQuery.data.metadata, null, 2) : '{}');
  }, [itemModalVisible, itemDetailQuery.data]);

  const handleDictPageChange = (nextPage: number) => {
    setPage(nextPage);
  };

  const handleDictPageSizeChange = (nextPageSize: number) => {
    setPage(1);
    setPageSize(nextPageSize);
  };

  const selectDict = (dict: Dict) => {
    setSelectedDict(dict);
    setPendingItemKeyword('');
    setPendingItemStatus('');
    setItemKeyword('');
    setItemStatusFilter('');
  };

  const allItemIds = useMemo(() => items.map((i) => i.id), [items]);
  const isAllExpanded = allItemIds.length > 0 && expandedRowKeys.length >= allItemIds.length;
  function toggleExpandAll() {
    setExpandedRowKeys(isAllExpanded ? [] : allItemIds);
  }

  function handleItemSearch() {
    setItemKeyword(pendingItemKeyword);
    setItemStatusFilter(pendingItemStatus);
    if (selectedDict) void queryClient.invalidateQueries({ queryKey: dictKeys.items(selectedDict.id) });
  }

  function handleItemReset() {
    setPendingItemKeyword('');
    setPendingItemStatus('');
    setItemKeyword('');
    setItemStatusFilter('');
    if (selectedDict) void queryClient.invalidateQueries({ queryKey: dictKeys.items(selectedDict.id) });
  }

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(keyword);
    void queryClient.invalidateQueries({ queryKey: dictKeys.lists });
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
  const handleDictModalOk = async () => {
    let values;
    try {
      values = await dictFormApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    await saveDictMutation.mutateAsync({ id: editingDictRecord?.id, values });
    Toast.success(editingDictRecord ? '更新成功' : '创建成功');
    setDictModalVisible(false);
    setEditingDictRecord(null);
  };

  const openEditDict = (row: Dict) => {
    setEditingDictRecord(row);
    setDictModalVisible(true);
  };

  const handleDictDelete = async (id: number) => {
    await deleteDictMutation.mutateAsync(id);
    Toast.success('删除成功');
    if (selectedDict?.id === id) {
      setSelectedDict(null);
    }
  };

  // ─── 字典项 CRUD ───────────────────────────────────────────────────────────
  const handleItemModalOk = async () => {
    if (!selectedDict) return;
    let values;
    try {
      values = await itemFormApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    let metadata: Record<string, unknown> | null = null;
    const currentJson = (jsonViewerRef.current?.getValue() ?? metadataStr).trim();
    if (currentJson && currentJson !== '{}') {
      try {
        metadata = JSON.parse(currentJson) as Record<string, unknown>;
      } catch {
        Toast.error('元数据 JSON 格式有误，请检查后重试');
        throw new Error('invalid metadata json');
      }
    }
    const payload = { ...values, parentId: itemParentId ?? undefined, color: itemColor ?? null, metadata };
    await saveItemMutation.mutateAsync({ dictId: selectedDict.id, itemId: editingItemRecord?.id, values: payload as Partial<DictItem> });
    Toast.success(editingItemRecord ? '更新成功' : '创建成功');
    setItemModalVisible(false);
    setEditingItemRecord(null);
  };

  const handleItemDelete = async (id: number) => {
    if (!selectedDict) return;
    await deleteItemMutation.mutateAsync({ dictId: selectedDict.id, itemId: id });
    Toast.success('删除成功');
  };

  const openCreateChildItem = (row: DictItem) => {
    setEditingItemRecord(null);
    setItemParentId(row.id);
    setItemColor(null);
    setMetadataStr('{}');
    setItemModalVisible(true);
  };

  const openEditItem = (row: DictItem) => {
    if (!selectedDict) return;
    setEditingItemRecord(row);
    setItemParentId(row.parentId ?? null);
    setItemColor(row.color ?? null);
    setMetadataStr(row.metadata ? JSON.stringify(row.metadata, null, 2) : '{}');
    setItemModalVisible(true);
  };

  const handleToggleItemStatus = async (item: DictItem, newStatus: 'enabled' | 'disabled') => {
    if (!selectedDict) return;
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用字典项「${item.label}」？`,
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    await toggleItemStatusMutation.mutateAsync({ dictId: selectedDict.id, itemId: item.id, values: { status: newStatus } });
    Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
  };

  const handleToggleDictStatus = async (dict: Dict, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用字典「${dict.name}」？`,
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
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
                      Modal.confirm({
                        title: '确认删除此字典？',
                        content: '字典下的所有字典项也将一并删除',
                        okButtonProps: { type: 'danger', theme: 'solid' },
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ExportButton entity="system.dicts" query={submittedKeyword ? { keyword: submittedKeyword } : {}} />
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
                  <Dropdown.Item onClick={() => { setEditingDictRecord(null); setDictModalVisible(true); }}>
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
        </span>
      }
      search={{
        value: keyword,
        onChange: (v) => setKeyword(v),
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
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      fixed: 'right',
      render: (v: string, record: DictItem) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingItemStatusId === record.id}
          disabled={!hasPermission('system:dict:item')}
          onChange={(checked: boolean) => void handleToggleItemStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<DictItem>({
      width: 220,
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
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:dict:item'),
          onClick: () => {
            Modal.confirm({
              title: '确认删除此字典项？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleItemDelete(row.id),
            });
          },
        },
      ],
    }),
  ];

  const renderItemKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="标签/键值"
      showClear
      value={pendingItemKeyword}
      onChange={(v) => setPendingItemKeyword(v)}
      onEnterPress={handleItemSearch}
      style={{ width: 180, maxWidth: '100%' }}
      disabled={!selectedDict}
    />
  );

  const renderItemStatusFilter = () => (
    <Select
      placeholder="状态"
      showClear
      value={pendingItemStatus || undefined}
      onChange={(val) => setPendingItemStatus((val as string) ?? '')}
      style={{ width: 120, maxWidth: '100%' }}
      disabled={!selectedDict}
    >
      {statusItems.map((i) => (
        <Select.Option key={i.value} value={i.value}>{i.label}</Select.Option>
      ))}
    </Select>
  );

  const renderItemSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleItemSearch} disabled={!selectedDict}>查询</Button>
  );

  const renderItemResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleItemReset} disabled={!selectedDict}>重置</Button>
  );

  const renderItemExpandButton = () => allItemIds.length > 0 ? (
    <Button
      type="primary"
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
      disabled={!selectedDict}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  ) : null;

  const renderItemCreateButton = () => hasPermission('system:dict:item') ? (
    <Button
      type="primary"
      icon={<Plus size={14} />}
      onClick={() => { setEditingItemRecord(null); setItemParentId(null); setItemColor(null); setMetadataStr('{}'); setItemModalVisible(true); }}
      disabled={!selectedDict}
    >
      新增
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
        <SearchToolbar
          primary={(
            <>
              {renderItemKeywordSearch()}
              {renderItemStatusFilter()}
              {renderItemSearchButton()}
              {renderItemResetButton()}
              {renderItemExpandButton()}
              {renderItemCreateButton()}
            </>
          )}
          mobilePrimary={(
            <>
              {renderItemKeywordSearch()}
              {renderItemSearchButton()}
              {renderItemCreateButton()}
            </>
          )}
          mobileFilters={renderItemStatusFilter()}
          mobileActions={renderItemExpandButton()}
          filterTitle="字典项筛选"
          actionTitle="字典项操作"
          onFilterApply={handleItemSearch}
          onFilterReset={handleItemReset}
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
          onExpandedRowsChange={(rows) =>
            setExpandedRowKeys((rows ?? []).filter((r): r is DictItem => 'id' in (r as object)).map((r) => r.id))
          }
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
        onBack={() => setSelectedDict(null)}
        style={{ flex: 1, overflow: 'hidden' }}
      />

      {/* 字典创建/编辑 Modal */}
      <AppModal
        title={editingDict ? '编辑字典' : '新增字典'}
        visible={dictModalVisible}
        onCancel={() => { setDictModalVisible(false); setEditingDictRecord(null); }}
        onOk={handleDictModalOk}
        okButtonProps={{ disabled: !!editingDictRecord && dictDetailQuery.isFetching }}
        width={480}

      >
        <Spin spinning={!!editingDictRecord && dictDetailQuery.isFetching} wrapperClassName="modal-spin-wrapper">
        <Form
          getFormApi={(api) => dictFormApi.current = api}
          key={editingDict?.id ?? 'new-dict'}
          allowEmpty
          initValues={editingDict ?? { status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="字典名称" placeholder="请输入字典名称" style={{ width: '100%' }} rules={[{ required: true, message: '请输入字典名称' }]} />
          <Form.Input field="code" label="字典编码" placeholder="请输入字典编码" style={{ width: '100%' }} rules={[{ required: true, message: '请输入字典编码' }]} />
          <Form.Input field="description" label="描述" placeholder="请输入描述" style={{ width: '100%' }} />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
            placeholder="请选择状态"
          />
        </Form>
        </Spin>
      </AppModal>

      {/* 字典项创建/编辑 Modal */}
      <AppModal
        title={editingItem ? '编辑字典项' : '新增字典项'}
        visible={itemModalVisible}
        onCancel={() => setItemModalVisible(false)}
        onOk={handleItemModalOk}
        width={600}
      >
        <Spin spinning={!!editingItemRecord && itemDetailQuery.isFetching}>
          <Form
            getFormApi={(api) => itemFormApi.current = api}
            key={editingItem?.id ?? 'new-item'}
            allowEmpty
            initValues={editingItem ?? { status: 'enabled', sort: 0 }}
            labelPosition="left"
            labelWidth={72}
          >
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
                  optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
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
