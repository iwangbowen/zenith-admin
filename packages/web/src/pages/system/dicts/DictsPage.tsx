import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Button,
  Dropdown,
  List as SemiList,
  Input,
  Select,
  Tag,
  Space,
  Modal,
  Form,
  Pagination,
  Spin,
  Toast,
  TreeSelect,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, MoreHorizontal, BookOpen, ChevronsDownUp, ChevronsUpDown, RefreshCw, Download, Pencil, Trash2 } from 'lucide-react';
import type { Dict, DictItem, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { usePermission } from '@/hooks/usePermission';
import './DictsPage.css';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';

export default function DictsPage() {
  const { hasPermission } = usePermission();
  const dictFormApi = useRef<FormApi | null>(null);
  const itemFormApi = useRef<FormApi | null>(null);

  // ─── 字典列表 ──────────────────────────────────────────────────────────────
  const [dicts, setDicts] = useState<Dict[]>([]);
  const [dictsLoading, setDictsLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const { page, pageSize, setPage, setPageSize } = usePagination();
  const [total, setTotal] = useState(0);
  const [dictModalVisible, setDictModalVisible] = useState(false);
  const [editingDict, setEditingDict] = useState<Dict | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);

  // ─── 字典项列表 ────────────────────────────────────────────────────────────
  const [selectedDict, setSelectedDict] = useState<Dict | null>(null);
  const [items, setItems] = useState<DictItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<DictItem | null>(null);
  const [pendingItemKeyword, setPendingItemKeyword] = useState('');
  const [pendingItemStatus, setPendingItemStatus] = useState('');
  const [itemKeyword, setItemKeyword] = useState('');
  const [itemStatusFilter, setItemStatusFilter] = useState('');  const [expandedRowKeys, setExpandedRowKeys] = useState<(string | number)[]>([]);
  const [itemParentId, setItemParentId] = useState<number | null>(null);
  const { items: statusItems } = useDictItems('common_status');

  // ─── 数据获取 ──────────────────────────────────────────────────────────────
  const fetchItems = useCallback(async (dictId: number) => {
    setItemsLoading(true);
    try {
      const res = await request.get<DictItem[]>(`/api/dicts/${dictId}/items`);
      if (res.code === 0) {
        setItems(res.data);
        // 默认展开所有节点
        setExpandedRowKeys(res.data.map((i) => i.id));
      }
    } finally {
      setItemsLoading(false);
    }
  }, []);

  const fetchDicts = useCallback(async () => {
    setDictsLoading(true);
    try {
      const params = new URLSearchParams();
      if (submittedKeyword) params.set('keyword', submittedKeyword);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await request.get<PaginatedResponse<Dict>>(`/api/dicts?${params.toString()}`);
      if (res.code === 0) {
        const nextList = res.data.list;
        setDicts(nextList);
        setTotal(res.data.total);
        setSelectedDict((prev) => {
          if (nextList.length === 0) {
            setItems([]);
            return null;
          }
          const current = prev ? nextList.find((d) => d.id === prev.id) : null;
          if (current) return current;
          void fetchItems(nextList[0].id);
          return nextList[0];
        });
      }
    } finally {
      setDictsLoading(false);
    }
  }, [submittedKeyword, page, pageSize, fetchItems]);

  const refreshCurrentItems = useCallback(() => {
    if (selectedDict) {
      void fetchItems(selectedDict.id);
    } else {
      setItems([]);
    }
  }, [fetchItems, selectedDict]);

  const handleExport = async () => {
    setExportLoading(true);
    try {
      await request.download('/api/dicts/export', '字典列表.xlsx');
    } finally {
      setExportLoading(false);
    }
  };

  const handleDictPageChange = (nextPage: number) => {
    setPage(nextPage);
  };

  const handleDictPageSizeChange = (nextPageSize: number) => {
    setPage(1);
    setPageSize(nextPageSize);
  };

  const selectDict = useCallback((dict: Dict) => {
    setSelectedDict(dict);
    void fetchItems(dict.id);
    setPendingItemKeyword('');
    setPendingItemStatus('');
    setItemKeyword('');
    setItemStatusFilter('');
  }, [fetchItems]);

  const allItemIds = useMemo(() => items.map((i) => i.id), [items]);
  const isAllExpanded = allItemIds.length > 0 && expandedRowKeys.length >= allItemIds.length;
  function toggleExpandAll() {
    setExpandedRowKeys(isAllExpanded ? [] : allItemIds);
  }

  useEffect(() => { void fetchDicts(); }, [fetchDicts]);

  function handleItemSearch() {
    setItemKeyword(pendingItemKeyword);
    setItemStatusFilter(pendingItemStatus);
    refreshCurrentItems();
  }

  function handleItemReset() {
    setPendingItemKeyword('');
    setPendingItemStatus('');
    setItemKeyword('');
    setItemStatusFilter('');
    refreshCurrentItems();
  }

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(keyword);
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
    const res = editingDict
      ? await request.put(`/api/dicts/${editingDict.id}`, values)
      : await request.post('/api/dicts', values);
    if (res.code === 0) {
      Toast.success(editingDict ? '更新成功' : '创建成功');
      setDictModalVisible(false);
      void fetchDicts();
    } else {
      throw new Error(res.message);
    }
  };

  const openEditDict = async (row: Dict) => {
    setEditingDict(row);
    setDictModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<Dict>(`/api/dicts/${row.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingDict(res.data);
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  };

  const handleDictDelete = async (id: number) => {
    const res = await request.delete(`/api/dicts/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      if (selectedDict?.id === id) {
        setSelectedDict(null);
        setItems([]);
      }
      void fetchDicts();
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
    const payload = { ...values, parentId: itemParentId ?? undefined };
    const res = editingItem
      ? await request.put(`/api/dicts/${selectedDict.id}/items/${editingItem.id}`, payload)
      : await request.post(`/api/dicts/${selectedDict.id}/items`, payload);
    if (res.code === 0) {
      Toast.success(editingItem ? '更新成功' : '创建成功');
      setItemModalVisible(false);
      void fetchItems(selectedDict.id);
    } else {
      throw new Error(res.message);
    }
  };

  const handleItemDelete = async (id: number) => {
    if (!selectedDict) return;
    const res = await request.delete(`/api/dicts/${selectedDict.id}/items/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchItems(selectedDict.id);
    }
  };

  const renderDictListItem = (dict: Dict) => {
    const active = selectedDict?.id === dict.id;
    return (
      <SemiList.Item
        className={`dict-list-item${active ? ' dict-list-item--active' : ''}`}
        onClick={() => selectDict(dict)}
        main={
          <div className="dict-list-item-main">
            <div className="dict-list-item-row1" title={`${dict.name} · ${dict.code}`}>
              <span className="dict-list-item-title">{dict.name}</span>
              <span className="dict-list-item-sep">·</span>
              <span className="dict-list-item-code">{dict.code}</span>
            </div>
            <div className="dict-list-item-date">{formatDateTime(dict.createdAt)}</div>
          </div>
        }
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
    <div className="dict-master">
      <div className="dict-master-header">
        <span className="dict-master-title">字典列表</span>
        <Dropdown
          trigger="click"
          position="bottomRight"
          clickToHide
          render={
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => void fetchDicts()}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <RefreshCw size={14} /> 刷新
                </span>
              </Dropdown.Item>
              {hasPermission('system:dict:create') && (
                <Dropdown.Item onClick={() => { setEditingDict(null); setDictModalVisible(true); }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Plus size={14} /> 新增字典
                  </span>
                </Dropdown.Item>
              )}
              <Dropdown.Item onClick={() => void handleExport()}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Download size={14} /> 导出字典
                </span>
              </Dropdown.Item>
            </Dropdown.Menu>
          }
        >
          <Button
            theme="borderless"
            size="small"
            icon={<MoreHorizontal size={14} />}
            loading={exportLoading}
          />
        </Dropdown>
      </div>
      <div className="dict-master-list">
        <SemiList<Dict>
          className="dict-list"
          size="small"
          split={false}
          loading={dictsLoading}
          dataSource={dicts}
          emptyContent={<div className="dict-empty">暂无字典</div>}
          header={
            <Input
              prefix={<Search size={14} />}
              placeholder="名称/编码"
              value={keyword}
              onChange={(v) => setKeyword(v)}
              onEnterPress={handleSearch}
              showClear
            />
          }
          footer={
            <div className="dict-list-pagination">
              <Pagination
                size="small"
                total={total}
                currentPage={page}
                pageSize={pageSize}
                pageSizeOpts={[10, 20, 50]}
                showSizeChanger
                showTotal
                onPageChange={handleDictPageChange}
                onPageSizeChange={handleDictPageSizeChange}
              />
            </div>
          }
          renderItem={renderDictListItem}
        />
      </div>
    </div>
  );

  const itemColumns: ColumnProps<DictItem>[] = [
    { title: '标签', dataIndex: 'label', width: 160, render: renderEllipsis },
    { title: '键值', dataIndex: 'value', width: 160, render: renderEllipsis },
    { title: '排序', dataIndex: 'sort', width: 70, align: 'center' },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      align: 'center',
      fixed: 'right',
      render: (v: string) => <DictTag dictCode="common_status" value={v} />,
    },
    {
      title: '操作',
      fixed: 'right',
      width: 180,
      align: 'center',
      render: (_v, row) => (
        <Space>
          {hasPermission('system:dict:item') && <Button
            theme="borderless"
            size="small"
            onClick={() => { setEditingItem(row); setItemParentId(row.parentId ?? null); setItemModalVisible(true); }}
          >
            编辑
          </Button>}
          {hasPermission('system:dict:item') && <Button theme="borderless" size="small" type="danger" onClick={() => {
            Modal.confirm({
              title: '确认删除此字典项？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleItemDelete(row.id),
            });
          }}>删除</Button>}
        </Space>
      ),
    },
  ];

  const dictDetail = (
    <div className="dict-detail">
      <div className="dict-detail-header">
        {selectedDict ? (
          <>
            <div className="dict-detail-title">
              <BookOpen size={16} />
              <span title={selectedDict.name}>{selectedDict.name}</span>
            </div>
            <Tag size="small" color="blue">{selectedDict.code}</Tag>
            <DictTag dictCode="common_status" value={selectedDict.status} />
          </>
        ) : (
          <span className="dict-detail-placeholder">请选择字典</span>
        )}
      </div>
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="标签/键值"
          showClear
          value={pendingItemKeyword}
          onChange={(v) => setPendingItemKeyword(v)}
          onEnterPress={handleItemSearch}
          style={{ width: 180 }}
          disabled={!selectedDict}
        />
        <Select
          placeholder="状态"
          showClear
          value={pendingItemStatus || undefined}
          onChange={(val) => setPendingItemStatus((val as string) ?? '')}
          style={{ width: 120 }}
          disabled={!selectedDict}
        >
          {statusItems.map((i) => (
            <Select.Option key={i.value} value={i.value}>{i.label}</Select.Option>
          ))}
        </Select>
        <Button type="primary" icon={<Search size={14} />} onClick={handleItemSearch} disabled={!selectedDict}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleItemReset} disabled={!selectedDict}>重置</Button>
        {allItemIds.length > 0 && (
          <Button
            type="primary"
            icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            onClick={toggleExpandAll}
            disabled={!selectedDict}
          >
            {isAllExpanded ? '全部折叠' : '全部展开'}
          </Button>
        )}
        {hasPermission('system:dict:item') && (
          <Button
            type="primary"
            icon={<Plus size={14} />}
            onClick={() => { setEditingItem(null); setItemParentId(null); setItemModalVisible(true); }}
            disabled={!selectedDict}
          >
            新增
          </Button>
        )}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={itemColumns}
        dataSource={treeItems}
        rowKey="id"
        loading={itemsLoading}
        onRefresh={selectedDict ? () => void fetchItems(selectedDict.id) : undefined}
        refreshLoading={itemsLoading}
        pagination={false}
        size="small"
        empty={selectedDict ? '暂无数据' : '请选择字典'}
        childrenRecordName="children"
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={(rows) =>
          setExpandedRowKeys((rows ?? []).filter((r): r is DictItem => 'id' in (r as object)).map((r) => (r as DictItem).id))
        }
      />
    </div>
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
      <Modal
        title={editingDict ? '编辑字典' : '新增字典'}
        visible={dictModalVisible}
        onCancel={() => { setDictModalVisible(false); setModalDetailLoading(false); }}
        onOk={handleDictModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={480}

      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
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
      </Modal>

      {/* 字典项创建/编辑 Modal */}
      <Modal
        title={editingItem ? '编辑字典项' : '新增字典项'}
        visible={itemModalVisible}
        onCancel={() => setItemModalVisible(false)}
        onOk={handleItemModalOk}
        width={480}

      >
        <Form
          getFormApi={(api) => itemFormApi.current = api}
          key={editingItem?.id ?? 'new-item'}
          allowEmpty
          initValues={editingItem ?? { status: 'enabled', sort: 0 }}
          labelPosition="left"
          labelWidth={80}
        >
          <Form.Input field="label" label="标签" placeholder="请输入标签" style={{ width: '100%' }} rules={[{ required: true, message: '请输入标签' }]} />
          <Form.Input field="value" label="键值" placeholder="请输入键值" style={{ width: '100%' }} rules={[{ required: true, message: '请输入键值' }]} />
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
          <Form.InputNumber field="sort" label="排序" placeholder="请输入排序" min={0} style={{ width: '100%' }} />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
            placeholder="请选择状态"
          />
          <Form.Input field="remark" label="备注" placeholder="请输入备注" style={{ width: '100%' }} />
        </Form>
      </Modal>
    </div>
  );
}
