import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import type { SystemConfig } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
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
import {
  systemConfigKeys,
  useDeleteSystemConfig,
  useSaveSystemConfig,
  useSystemConfigDetail,
  useSystemConfigList,
} from '@/hooks/queries/system-configs';

interface SearchParams {
  keyword: string;
  configType: string;
}

const defaultSearchParams: SearchParams = { keyword: '', configType: '' };

export default function SystemConfigsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const { items: configTypeItems, loading: configTypeLoading } = useDictItems('system_config_type');
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SystemConfig | null>(null);

  const listQuery = useSystemConfigList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    configType: submittedParams.configType || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useSystemConfigDetail(editingConfig?.id, modalVisible);
  const editing = editingConfig ? (detailQuery.data ?? editingConfig) : null;
  const modalDetailLoading = !!editingConfig && detailQuery.isFetching;
  const saveMutation = useSaveSystemConfig();
  const deleteMutation = useDeleteSystemConfig();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: systemConfigKeys.lists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: systemConfigKeys.lists });
  };

  const handleModalOk = async () => {
    let values;
    try { values = await formApi.current!.validate(); } catch { throw new Error('validation'); }

    await saveMutation.mutateAsync({ id: editingConfig?.id, values });
    Toast.success(editingConfig ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingConfig(null);
  };

  const openEdit = (record: SystemConfig) => {
    setEditingConfig(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const formInitValues = editing
    ? {
        configKey: editing.configKey,
        configValue: editing.configValue,
        configType: editing.configType,
        description: editing.description,
      }
    : { configType: 'string' };

  const configTypeFilterOptions = [
    { value: '', label: '全部类型' },
    ...configTypeItems.map((item) => ({ value: item.value, label: item.label })),
  ];
  const buildExportQuery = () => ({
    ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
    ...(submittedParams.configType ? { configType: submittedParams.configType } : {}),
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
            value={draftParams.keyword}
            onChange={(value) => setDraftParams((p) => ({ ...p, keyword: value }))}
            onEnterPress={handleSearch}
            style={{ width: 240 }}
            showClear
          />
          <Select
            placeholder="配置类型"
            value={draftParams.configType || undefined}
            onChange={(v) => setDraftParams((p) => ({ ...p, configType: (v as string) ?? '' }))}
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
              value={draftParams.keyword}
              onChange={(value) => setDraftParams((p) => ({ ...p, keyword: value }))}
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
            value={draftParams.configType || undefined}
            onChange={(v) => setDraftParams((p) => ({ ...p, configType: (v as string) ?? '' }))}
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
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        pagination={buildPagination(total)}
        empty="暂无数据"
      />

      <AppModal
        title={editing ? '编辑配置' : '新增配置'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingConfig(null); }}
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
            disabled={!!editing}
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
