import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Toast,
} from '@douyinfe/semi-ui';
import { Search, Plus, RotateCcw, Download } from 'lucide-react';
import type { Position } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import DictTag from '../../../components/DictTag';
import { useDictItems } from '../../../hooks/useDictItems';
import { request } from '../../../utils/request';
import { formatDateTime } from '../../../utils/date';
import { usePermission } from '../../../hooks/usePermission';

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
  const formApi = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [data, setData] = useState<Position[]>([]);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const { items: statusItems } = useDictItems('common_status');

  const fetchPositions = useCallback(async (params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.timeRange
          ? {
              startTime: params.timeRange[0].toISOString(),
              endTime: params.timeRange[1].toISOString(),
            }
          : {}),
      }).toString();
      const res = await request.get<Position[]>(query ? `/api/positions?${query}` : '/api/positions');
      if (res.code === 0) {
        setData(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void fetchPositions();
  }, []);

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
        status: 'active',
      };

  const handleSearch = () => {
    void fetchPositions();
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    void fetchPositions(defaultSearchParams);
  };

  const handleModalOk = async () => {
    let values: any;
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
      Toast.error(res.message);
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/positions/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchPositions();
    } else {
      Toast.error(res.message);
    }
  };

  const columns: ColumnProps<Position>[] = [
    { title: '岗位名称', dataIndex: 'name', width: 200, ellipsis: true },
    { title: '岗位编码', dataIndex: 'code', width: 180, ellipsis: true },
    { title: '排序', dataIndex: 'sort', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => <DictTag dictCode="common_status" value={value} />,
    },
    {
      title: '备注',
      dataIndex: 'remark',
      ellipsis: true,
      render: (value: string | undefined) => value || '—',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      ellipsis: true,
      render: (value: string) => formatDateTime(value),
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
            onClick={() => {
              setEditingPosition(record);
              setModalVisible(true);
            }}
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
      <div className="search-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Space wrap>
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
          </Space>
          <Space>
            <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/positions/export', '岗位列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
            {hasPermission('system:position:create') && <Button
              type="secondary"
              icon={<Plus size={14} />}
              onClick={() => {
                setEditingPosition(null);
                setModalVisible(true);
              }}
            >
              新增
            </Button>}
          </Space>
        </div>
      </div>

      <Table
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        pagination={false}
        empty="暂无数据"
      />

      <Modal
        title={editingPosition ? '编辑岗位' : '新增岗位'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingPosition(null);
        }}
        onOk={handleModalOk}
        width={520}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          key={editingPosition?.id ?? 'new-position'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="岗位名称" rules={[{ required: true, message: '请输入岗位名称' }]} />
          <Form.Input field="code" label="岗位编码" rules={[{ required: true, message: '请输入岗位编码' }]} />
          <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
          <Form.Select
            field="status"
            label="状态"
            optionList={statusItems.map((item) => ({ value: item.value, label: item.label }))}
            style={{ width: '100%' }}
          />
          <Form.TextArea field="remark" label="备注" maxCount={256} />
        </Form>
      </Modal>
    </div>
  );
}
