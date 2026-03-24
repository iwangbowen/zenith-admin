import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Toast,
} from '@douyinfe/semi-ui';
import { Search, Plus, RotateCcw, Download } from 'lucide-react';
import type { SystemConfig, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '../../../utils/request';
import { formatDateTime } from '../../../utils/date';
import { usePermission } from '../../../hooks/usePermission';

interface SearchParams {
  keyword: string;
  configType: string;
}

const defaultSearchParams: SearchParams = { keyword: '', configType: '' };

const configTypeOptions = [
  { value: '', label: '全部类型' },
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔值' },
  { value: 'json', label: 'JSON' },
];

export default function SystemConfigsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SystemConfig[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SystemConfig | null>(null);

  const fetchData = useCallback(async (p = page, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.configType ? { configType: params.configType } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<SystemConfig>>(`/api/system-configs?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  useEffect(() => {
    void fetchData();
  }, []);

  const handleSearch = () => { setPage(1); void fetchData(1); };
  const handleReset = () => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, defaultSearchParams); };

  const handlePageChange = (p: number) => { setPage(p); void fetchData(p); };

  const handleExport = async () => {
    try {
      await request.download('/api/system-configs/export', '系统配置.xlsx');
      Toast.success('导出成功');
    } catch { Toast.error('导出失败'); }
  };

  const handleModalOk = async () => {
    let values: any;
    try { values = await formApi.current?.validate(); } catch { throw new Error('validation'); }

    const res = editingConfig
      ? await request.put(`/api/system-configs/${editingConfig.id}`, values)
      : await request.post('/api/system-configs', values);

    if (res.code === 0) {
      Toast.success(editingConfig ? '更新成功' : '创建成功');
      setModalVisible(false);
      setEditingConfig(null);
      void fetchData();
    } else {
      Toast.error(res.message);
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/system-configs/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchData();
    } else {
      Toast.error(res.message);
    }
  };

  const formInitValues = editingConfig
    ? {
        configKey: editingConfig.configKey,
        configValue: editingConfig.configValue,
        configType: editingConfig.configType,
        description: editingConfig.description,
      }
    : { configType: 'string' };

  const columns: ColumnProps<SystemConfig>[] = [
    { title: '配置键', dataIndex: 'configKey', width: 220, ellipsis: true },
    { title: '配置值', dataIndex: 'configValue', width: 260, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'configType',
      width: 100,
      render: (v: string) => configTypeOptions.find((o) => o.value === v)?.label ?? v,
    },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '更新时间', dataIndex: 'updatedAt', width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 160,
      render: (_: unknown, record: SystemConfig) => (
        <Space>
          {hasPermission('system:config:update') && (
            <Button theme="borderless" size="small" onClick={() => { setEditingConfig(record); setModalVisible(true); }}>
              编辑
            </Button>
          )}
          {hasPermission('system:config:delete') && (
            <Button theme="borderless" type="danger" size="small" onClick={() => {
              Modal.confirm({ title: '确定要删除此配置吗？', onOk: () => handleDelete(record.id) });
            }}>
              删除
            </Button>
          )}
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
              placeholder="搜索配置键/描述"
              value={searchParams.keyword}
              onChange={(value) => setSearchParams((p) => ({ ...p, keyword: value }))}
              onEnterPress={handleSearch}
              style={{ width: 240 }}
              showClear
            />
            <Select
              placeholder="配置类型"
              value={searchParams.configType || undefined}
              onChange={(v) => setSearchParams((p) => ({ ...p, configType: (v as string) ?? '' }))}
              style={{ width: 140 }}
              optionList={configTypeOptions}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </Space>
          <Space>
            <Button icon={<Download size={14} />} onClick={handleExport}>导出</Button>
            {hasPermission('system:config:create') && (
              <Button type="secondary" icon={<Plus size={14} />} onClick={() => { setEditingConfig(null); setModalVisible(true); }}>新增</Button>
            )}
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
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: handlePageChange,
        }}
        empty="暂无数据"
      />

      <Modal
        title={editingConfig ? '编辑配置' : '新增配置'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingConfig(null); }}
        onOk={handleModalOk}
        width={520}
      >
        <Form
          key={editingConfig?.id ?? 'new-config'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input
            field="configKey"
            label="配置键"
            rules={[{ required: true, message: '请输入配置键' }]}
            disabled={!!editingConfig}
          />
          <Form.Input field="configValue" label="配置值" rules={[{ required: true, message: '请输入配置值' }]} />
          <Form.Select
            field="configType"
            label="类型"
            optionList={configTypeOptions.filter((o) => o.value !== '')}
            style={{ width: '100%' }}
          />
          <Form.TextArea field="description" label="描述" maxCount={256} />
        </Form>
      </Modal>
    </div>
  );
}
