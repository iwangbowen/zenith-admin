import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Typography,
  Toast,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download, Trash2 } from 'lucide-react';
import type { Position, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';

interface SearchParams {
  keyword: string;
  status: string;
  timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = {
  keyword: '',
  status: '',
  timeRange: null,
};

export default function PositionsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [data, setData] = useState<Position[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const { items: statusItems } = useDictItems('common_status');

  const fetchPositions = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.timeRange
          ? {
              startTime: formatDateTimeForApi(params.timeRange[0]),
              endTime: formatDateTimeForApi(params.timeRange[1]),
            }
          : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<Position>>(`/api/positions?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  useEffect(() => {
    void fetchPositions();
  }, [fetchPositions]);

  const formInitValues = editingPosition
    ? {
        name: editingPosition.name,
        code: editingPosition.code,
        sort: editingPosition.sort,
        status: editingPosition.status,
        remark: editingPosition.remark,
      }
    : {
        sort: 0,
        status: 'enabled',
      };

  const handleSearch = () => {
    setPage(1);
    void fetchPositions(1, pageSize);
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchPositions(1, pageSize, defaultSearchParams);
  };

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current?.validate();
    } catch {
      throw new Error('validation');
    }

    const res = editingPosition
      ? await request.put(`/api/positions/${editingPosition.id}`, values)
      : await request.post('/api/positions', values);

    if (res.code === 0) {
      Toast.success(editingPosition ? '更新成功' : '创建成功');
      setModalVisible(false);
      setEditingPosition(null);
      void fetchPositions();
    } else {
      throw new Error(res.message);
    }
  };

  const openEdit = async (record: Position) => {
    setEditingPosition(record);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<Position>(`/api/positions/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingPosition(res.data);
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/positions/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchPositions();
    }
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个岗位？`,
      content: '删除后无法恢复，请确认操作',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>('/api/positions/batch', { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success(res.message ?? '删除成功');
          setSelectedRowKeys([]);
          void fetchPositions();
        }
      },
    });
  };

  const columns: ColumnProps<Position>[] = [
    { title: '岗位名称', dataIndex: 'name', width: 200, render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
    { title: '岗位编码', dataIndex: 'code', width: 180, render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
    { title: '排序', dataIndex: 'sort', width: 90 },
    {
      title: '备注',
      dataIndex: 'remark',
      render: (value: string | undefined) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{value || '—'}</Typography.Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (value: string) => <DictTag dictCode="common_status" value={value} />,
    },
    {
      title: '操作',
      fixed: 'right',
      width: 160,
      render: (_: unknown, record: Position) => (
        <Space>
          {hasPermission('system:position:update') && <Button
            theme="borderless"
            size="small"
            onClick={() => { void openEdit(record); }}
          >编辑</Button>}
          {hasPermission('system:position:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => {
            Modal.confirm({
              title: '确定要删除该岗位吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
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
            placeholder="搜索岗位名称/编码"
            value={searchParams.keyword}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
            onEnterPress={handleSearch}
            style={{ width: 240 }}
            showClear
          />
          <Select
            placeholder="请选择状态"
            value={searchParams.status || undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
            style={{ width: 140 }}
            optionList={[
              { value: '', label: '全部状态' },
              ...statusItems.map((item) => ({ value: item.value, label: item.label })),
            ]}
          />
          <DatePicker
            type="dateTimeRange"
            placeholder={['开始时间', '结束时间']}
            value={searchParams.timeRange ?? undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
            style={{ width: 360 }}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/positions/export', '岗位列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          {selectedRowKeys.length > 0 && hasPermission('system:position:delete') && (
            <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
              批量删除 ({selectedRowKeys.length})
            </Button>
          )}
          {hasPermission('system:position:create') && <Button
            type="primary"
            icon={<Plus size={14} />}
            onClick={() => {
              setEditingPosition(null);
              setModalVisible(true);
            }}
          >
            新增
          </Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: (p) => { setPage(p); void fetchPositions(p, pageSize); },
          onPageSizeChange: (size) => { setPageSize(size); void fetchPositions(1, size); },
          showSizeChanger: true,
        }}
        empty="暂无数据"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        }}
      />

      <Modal
        title={editingPosition ? '编辑岗位' : '新增岗位'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingPosition(null);
          setModalDetailLoading(false);
        }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={520}
       
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editingPosition?.id ?? 'new-position'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="岗位名称" placeholder="请输入岗位名称" rules={[{ required: true, message: '请输入岗位名称' }]} />
          <Form.Input field="code" label="岗位编码" placeholder="请输入岗位编码" rules={[{ required: true, message: '请输入岗位编码' }]} />
          <Form.InputNumber field="sort" label="排序" placeholder="请输入排序" min={0} style={{ width: '100%' }} />
          <Form.Select
            field="status"
            label="状态"
            optionList={statusItems.map((item) => ({ value: item.value, label: item.label }))}
            style={{ width: '100%' }}
            placeholder="请选择状态"
          />
          <Form.TextArea field="remark" label="备注" placeholder="请输入备注" maxCount={256} />
        </Form>
        </Spin>
      </Modal>
    </div>
  );
}
