import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Toast,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw } from 'lucide-react';
import type { SystemConfig, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { renderEllipsis } from '../../../utils/table-columns';

interface SearchParams {
  keyword: string;
  configType: string;
}

const defaultSearchParams: SearchParams = { keyword: '', configType: '' };

export default function SystemConfigsPage() {
  const { hasPermission } = usePermission();
  const { items: configTypeItems, loading: configTypeLoading } = useDictItems('system_config_type');
  const formApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SystemConfig[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SystemConfig | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const activeParams = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(activeParams.keyword ? { keyword: activeParams.keyword } : {}),
        ...(activeParams.configType ? { configType: activeParams.configType } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<SystemConfig>>(`/api/system-configs?${query}`);
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
    void fetchData();
  }, [fetchData]);

  const handleSearch = () => { setPage(1); void fetchData(1); };
  const handleReset = () => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, pageSize, defaultSearchParams); };

  const handleModalOk = async () => {
    let values;
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
      throw new Error(res.message);
    }
  };

  const openEdit = async (record: SystemConfig) => {
    setEditingConfig(record);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<SystemConfig>(`/api/system-configs/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingConfig(res.data);
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/system-configs/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchData();
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

  const configTypeFilterOptions = [
    { value: '', label: '全部类型' },
    ...configTypeItems.map((item) => ({ value: item.value, label: item.label })),
  ];
  const buildExportQuery = () => ({
    ...(searchParams.keyword ? { keyword: searchParams.keyword } : {}),
    ...(searchParams.configType ? { configType: searchParams.configType } : {}),
  });

  const configTypeOptions = configTypeItems.map((item) => ({ value: item.value, label: item.label }));

  const columns: ColumnProps<SystemConfig>[] = [
    { title: '配置键', dataIndex: 'configKey', width: 220, render: renderEllipsis },
    { title: '配置値', dataIndex: 'configValue', width: 140, render: renderEllipsis },
    {
      title: '类型',
      dataIndex: 'configType',
      width: 80,
      render: (v: string) => <DictTag dictCode="system_config_type" value={v} />,
    },
    { title: '描述', dataIndex: 'description', width: 300, render: renderEllipsis },
    {
      title: '更新时间', dataIndex: 'updatedAt', width: 180,
      render: (v: string) => formatDateTime(v),
    },
    createOperationColumn<SystemConfig>({
      width: 160,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:config:update'),
          onClick: () => { void openEdit(record); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:config:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定要删除此配置吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
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
            optionList={configTypeFilterOptions}
            loading={configTypeLoading}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        actions={(
          <>
          <ExportButton entity="system.configs" query={buildExportQuery()} />
          {hasPermission('system:config:create') && (
            <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingConfig(null); setModalVisible(true); }}>新增</Button>
          )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索配置键/描述"
              value={searchParams.keyword}
              onChange={(value) => setSearchParams((p) => ({ ...p, keyword: value }))}
              onEnterPress={handleSearch}
              style={{ width: 240 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {hasPermission('system:config:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingConfig(null); setModalVisible(true); }}>新增</Button>
            )}
          </>
        )}
        mobileFilters={(
          <Select
            placeholder="配置类型"
            value={searchParams.configType || undefined}
            onChange={(v) => setSearchParams((p) => ({ ...p, configType: (v as string) ?? '' }))}
            style={{ width: 140 }}
            optionList={configTypeFilterOptions}
            loading={configTypeLoading}
          />
        )}
        mobileActions={(
          <ExportButton entity="system.configs" query={buildExportQuery()} variant="flat" />
        )}
        filterTitle="配置筛选"
        actionTitle="配置操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        onRefresh={fetchData}
        refreshLoading={loading}
        rowKey="id"
        pagination={buildPagination(total, fetchData)}
        empty="暂无数据"
      />

      <AppModal
        title={editingConfig ? '编辑配置' : '新增配置'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingConfig(null); setModalDetailLoading(false); }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={520}
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editingConfig?.id ?? 'new-config'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
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
          <Form.Input field="configValue" label="配置值" placeholder="请输入配置值" rules={[{ required: true, message: '请输入配置值' }]} />
          <Form.Select
            field="configType"
            label="类型"
            optionList={configTypeOptions}
            style={{ width: '100%' }}
            loading={configTypeLoading}
            placeholder="请选择类型"
          />
          <Form.TextArea field="description" label="描述" placeholder="请输入描述" maxCount={256} />
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
