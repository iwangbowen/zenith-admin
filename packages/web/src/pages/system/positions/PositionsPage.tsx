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
  SplitButtonGroup,
  Dropdown,
  Switch,
  Toast,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download, Trash2, ChevronDown } from 'lucide-react';
import type { Position, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';

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
  const [exportCsvLoading, setExportCsvLoading] = useState(false);
  const [data, setData] = useState<Position[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const { items: statusItems } = useDictItems('common_status');

  const fetchPositions = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const activeParams = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(activeParams.keyword ? { keyword: activeParams.keyword } : {}),
        ...(activeParams.status ? { status: activeParams.status } : {}),
        ...(activeParams.timeRange
          ? {
              startTime: formatDateTimeForApi(activeParams.timeRange[0]),
              endTime: formatDateTimeForApi(activeParams.timeRange[1]),
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

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

  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null);

  const handleToggleStatus = useCallback(async (pos: Position, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认停用岗位「${pos.name}」？`,
          content: '停用后该岗位将不可选择。',
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认停用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    setTogglingStatusId(pos.id);
    try {
      const res = await request.put(`/api/positions/${pos.id}`, { status: newStatus });
      if (res.code === 0) {
        Toast.success(newStatus === 'enabled' ? '已启用' : '已停用');
        void fetchPositions();
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setTogglingStatusId(null);
    }
  }, [fetchPositions]);

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
    { title: '岗位名称', dataIndex: 'name', width: 200, render: renderEllipsis },
    { title: '岗位编码', dataIndex: 'code', width: 180, render: renderEllipsis },
    { title: '排序', dataIndex: 'sort', width: 90 },
    {
      title: '备注',
      dataIndex: 'remark',
      render: renderEllipsis,
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: string, record: Position) => (
        <Switch
          size="small"
          checked={value === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('system:position:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
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
          <SplitButtonGroup>
            <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/positions/export', '岗位列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
            <Dropdown
              trigger="click"
              position="bottomRight"
              clickToHide
              render={(
                <Dropdown.Menu>
                  <Dropdown.Item onClick={async () => { setExportLoading(true); try { await request.download('/api/positions/export', '岗位列表.xlsx'); } finally { setExportLoading(false); } }}>导出 Excel</Dropdown.Item>
                  <Dropdown.Item onClick={async () => { setExportCsvLoading(true); try { await request.download('/api/positions/export/csv', '岗位列表.csv'); } finally { setExportCsvLoading(false); } }}>导出 CSV</Dropdown.Item>
                </Dropdown.Menu>
              )}
            >
              <Button type="primary" icon={<ChevronDown size={14} />} loading={exportCsvLoading} />
            </Dropdown>
          </SplitButtonGroup>
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
        onRefresh={fetchPositions}
        refreshLoading={loading}
        rowKey="id"
        pagination={buildPagination(total, fetchPositions)}
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
