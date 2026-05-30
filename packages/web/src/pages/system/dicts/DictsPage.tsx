import { useState, useEffect, useCallback, useRef, useMemo, useTransition } from 'react';
import {
  Table,
  Button,
  Input,
  Select,
  DatePicker,
  Tag,
  Space,
  Modal,
  Form,
  Spin,
  Toast,
  SideSheet,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, List, RotateCcw, Download } from 'lucide-react';
import type { Dict, DictItem, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateForApi } from '@/utils/date';
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
  const [isDictsPending, startDictsTransition] = useTransition();
  const [exportLoading, setExportLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [submittedStatus, setSubmittedStatus] = useState('');
  const [timeRange, setTimeRange] = useState<[Date, Date] | null>(null);
  const [submittedTimeRange, setSubmittedTimeRange] = useState<[Date, Date] | null>(null);  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);  const [dictModalVisible, setDictModalVisible] = useState(false);
  const [editingDict, setEditingDict] = useState<Dict | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);

  // ─── 字典项列表 ────────────────────────────────────────────────────────────
  const [selectedDict, setSelectedDict] = useState<Dict | null>(null);
  const [sideSheetVisible, setSideSheetVisible] = useState(false);
  const [items, setItems] = useState<DictItem[]>([]);
  const [isItemsPending, startItemsTransition] = useTransition();
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<DictItem | null>(null);
  const [itemKeyword, setItemKeyword] = useState('');
  const [itemStatusFilter, setItemStatusFilter] = useState('');
  const { items: statusItems } = useDictItems('common_status');

  // ─── 数据获取 ──────────────────────────────────────────────────────────────
  const fetchDicts = useCallback(() => {
    startDictsTransition(async () => {
      const params = new URLSearchParams();
      if (submittedKeyword) params.set('keyword', submittedKeyword);
      if (submittedStatus) params.set('status', submittedStatus);
      if (submittedTimeRange) {
        params.set('startDate', formatDateForApi(submittedTimeRange[0]));
        params.set('endDate', formatDateForApi(submittedTimeRange[1]));
      }
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await request.get<PaginatedResponse<Dict>>(`/api/dicts?${params.toString()}`);
      if (res.code === 0) {
        setDicts(res.data.list);
        setTotal(res.data.total);
        if (selectedDict && !res.data.list.some((d) => d.id === selectedDict.id)) {
          setSelectedDict(null);
          setItems([]);
        }
      }
    });
  }, [submittedKeyword, submittedStatus, submittedTimeRange, selectedDict, page, pageSize]);

  const fetchItems = useCallback((dictId: number) => {
    startItemsTransition(async () => {
      const res = await request.get<DictItem[]>(`/api/dicts/${dictId}/items`);
      if (res.code === 0) setItems(res.data);
    });
  }, []);

  useEffect(() => { fetchDicts(); }, [fetchDicts]);

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(keyword);
    setSubmittedStatus(statusFilter);
    setSubmittedTimeRange(timeRange);
  }

  function handleReset() {
    setPage(1);
    setKeyword('');
    setSubmittedKeyword('');
    setStatusFilter('');
    setSubmittedStatus('');
    setTimeRange(null);
    setSubmittedTimeRange(null);
  }

  const selectDict = (dict: Dict) => {
    setSelectedDict(dict);
    fetchItems(dict.id);
    setItemKeyword('');
    setItemStatusFilter('');
    setSideSheetVisible(true);
  };

  const filteredItems = useMemo(() => items.filter((item) => {
    if (itemKeyword && !item.label.includes(itemKeyword) && !item.value.includes(itemKeyword)) return false;
    if (itemStatusFilter && item.status !== itemStatusFilter) return false;
    return true;
  }), [items, itemKeyword, itemStatusFilter]);

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
      fetchDicts();
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
      fetchDicts();
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
    const res = editingItem
      ? await request.put(`/api/dicts/${selectedDict.id}/items/${editingItem.id}`, values)
      : await request.post(`/api/dicts/${selectedDict.id}/items`, values);
    if (res.code === 0) {
      Toast.success(editingItem ? '更新成功' : '创建成功');
      setItemModalVisible(false);
      fetchItems(selectedDict.id);
    } else {
      throw new Error(res.message);
    }
  };

  const handleItemDelete = async (id: number) => {
    if (!selectedDict) return;
    const res = await request.delete(`/api/dicts/${selectedDict.id}/items/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchItems(selectedDict.id);
    }
  };

  // ─── 表格列定义 ────────────────────────────────────────────────────────────
  const dictColumns: ColumnProps<Dict>[] = [
    {
      title: '字典名称',
      dataIndex: 'name',
      width: 220,
      ellipsis: { showTitle: false },
      render: (v, row) => (
        <button
          type="button"
          className={`dict-name-cell${selectedDict?.id === row.id ? ' dict-name-cell--active' : ''}`}
          onClick={() => selectDict(row)}
        >
          <List style={{ marginRight: 6, flexShrink: 0 }} />
          <span className="table-cell-ellipsis" title={String(v)}>{v}</span>
        </button>
      ),
    },
    { title: '字典编码', dataIndex: 'code', width: 160, render: renderEllipsis },
    { title: '描述', dataIndex: 'description', render: renderEllipsis },
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
      width: 220,
      align: 'center',
      render: (_v, row) => (
        <Space>
          {hasPermission('system:dict:item') && <Button
            theme="borderless"
            size="small"
            onClick={(e) => { e.stopPropagation(); selectDict(row); }}
          >
            字典项
          </Button>}
          {hasPermission('system:dict:update') && <Button
            theme="borderless"
            size="small"
            onClick={(e) => { e.stopPropagation(); void openEditDict(row); }}
          >
            编辑
          </Button>}
          {hasPermission('system:dict:delete') && <Button theme="borderless" size="small" type="danger" onClick={(e) => { e.stopPropagation(); Modal.confirm({ title: '确认删除此字典？', content: '字典下的所有字典项也将一并删除', okButtonProps: { type: 'danger', theme: 'solid' }, onOk: () => handleDictDelete(row.id) }); }}>删除</Button>}
        </Space>
      ),
    },
  ];

  const itemColumns: ColumnProps<DictItem>[] = [
    { title: '标签', dataIndex: 'label', width: 160, render: renderEllipsis },
    { title: '键値', dataIndex: 'value', width: 160, render: renderEllipsis },
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
            onClick={() => { setEditingItem(row); setItemModalVisible(true); }}
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

  return (
    <div className="page-container">
      <SearchToolbar>
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索字典名称/编码"
            value={keyword}
            onChange={(v) => setKeyword(v)}
            onEnterPress={handleSearch}
            showClear
            style={{ width: 220 }}
          />
          <Select
            placeholder="状态"
            showClear
            value={statusFilter || undefined}
            onChange={(val) => setStatusFilter((val as string) ?? '')}
            style={{ width: 120 }}
          >
            {statusItems.map((i) => (
              <Select.Option key={i.value} value={i.value}>{i.label}</Select.Option>
            ))}
          </Select>
          <DatePicker
            type="dateRange"
            placeholder={['开始日期', '结束日期']}
            value={timeRange ?? undefined}
            onChange={(val) => setTimeRange(val as [Date, Date] | null)}
            style={{ width: 240 }}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/dicts/export', '字典列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          {hasPermission('system:dict:create') && <Button
            type="primary"
            icon={<Plus size={14} />}
            onClick={() => { setEditingDict(null); setDictModalVisible(true); }}
          >
            新增
          </Button>}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={dictColumns}
        dataSource={dicts}
        rowKey="id"
        loading={isDictsPending}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: (p) => setPage(p),
          onPageSizeChange: (s) => { setPage(1); setPageSize(s); },
          showSizeChanger: true,
        }}
        size="small"
        onRow={(row) => ({
          onClick: () => row && selectDict(row),
          style: { cursor: 'pointer' },
        })}
      />

      {/* 字典项 SideSheet */}
      <SideSheet
        title={
          selectedDict ? (
            <span>
              字典项：{selectedDict.name}
              <Tag size="small" color="blue" style={{ marginLeft: 8 }}>{selectedDict.code}</Tag>
            </span>
          ) : '字典项'
        }
        visible={sideSheetVisible}
        onCancel={() => setSideSheetVisible(false)}
        width={900}
        bodyStyle={{ padding: '16px 24px' }}
        headerStyle={{ borderBottom: '1px solid var(--semi-color-border)' }}
        footer={
          hasPermission('system:dict:item') ? (
            <div style={{ textAlign: 'right' }}>
              <Button
                type="primary"
                icon={<Plus size={14} />}
                onClick={() => { setEditingItem(null); setItemModalVisible(true); }}
              >
                新增字典项
              </Button>
            </div>
          ) : null
        }
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <Input
            prefix={<Search size={14} />}
            placeholder="标签/键值"
            showClear
            value={itemKeyword}
            onChange={(v) => setItemKeyword(v)}
            style={{ width: 180 }}
          />
          <Select
            placeholder="状态"
            showClear
            value={itemStatusFilter || undefined}
            onChange={(val) => setItemStatusFilter((val as string) ?? '')}
            style={{ width: 120 }}
          >
            {statusItems.map((i) => (
              <Select.Option key={i.value} value={i.value}>{i.label}</Select.Option>
            ))}
          </Select>
        </Space>
        <Table
          bordered
          columns={itemColumns}
          dataSource={filteredItems}
          rowKey="id"
          loading={isItemsPending}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          size="small"
        />
      </SideSheet>

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
