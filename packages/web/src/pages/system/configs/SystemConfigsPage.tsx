import { useEffect, useState } from 'react';
import { Form, JsonViewer, Spin, Toast } from '@douyinfe/semi-ui';
import { CONFIG_TYPES, type CreateSystemConfigInput, type SystemConfig } from '@zenith/shared/platform';
import { enumValueOf } from '@zenith/shared/core';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import DictTag from '@/components/DictTag';
import { useDictItems } from '@/hooks/useDictItems';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  systemConfigKeys,
  useDeleteSystemConfigs,
  useSaveSystemConfig,
  useSystemConfigDetail,
  useSystemConfigList,
} from '@/hooks/queries/system-configs';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';

interface SearchParams {
  keyword: string;
  configType?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', configType: undefined };

/** JSON 文本美化；解析失败时原样返回，避免用户输入被吞掉 */
function prettyJson(raw: string): string {
  const text = (raw ?? '').trim();
  if (!text) return '{}';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export default function SystemConfigsPage() {
  const { hasPermission } = usePermission();
  const { items: configTypeItems, loading: configTypeLoading } = useDictItems('system_config_type');
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: systemConfigKeys.lists });
  // json 类型改用 JsonViewer 编辑：jsonSeed 是非受控初始值兼 remount key，jsonText 由 onChange 实时同步供提交读取
  const [configType, setConfigType] = useState<string>('string');
  const [jsonSeed, setJsonSeed] = useState<string>('{}');
  const [jsonText, setJsonText] = useState<string>('{}');

  const seedJsonEditor = (raw: string) => {
    const pretty = prettyJson(raw);
    setJsonSeed(pretty);
    setJsonText(pretty);
  };

  const listQuery = useSystemConfigList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    configType: enumValueOf(CONFIG_TYPES, submittedParams.configType),
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const saveMutation = useSaveSystemConfig();
  const modal = useEditModal<SystemConfig, Partial<CreateSystemConfigInput>>({
    entityName: '配置',
    save: saveMutation,
    useDetail: useSystemConfigDetail,
    defaults: { configType: 'string' },
    toValues: (config) => ({
      configKey: config.configKey,
      configName: config.configName,
      configValue: config.configValue,
      configType: config.configType,
      description: config.description,
    }),
    beforeSave: (values) => {
      if (values.configType === 'json') {
        const raw = jsonText.trim();
        if (!raw) {
          Toast.error('请输入配置值');
          abortSubmit();
        }
        try {
          JSON.parse(raw);
        } catch {
          Toast.error('配置值 JSON 格式有误，请检查后重试');
          abortSubmit();
        }
        return { ...values, configValue: raw };
      }
      return values;
    },
  });
  const deleteMutation = useDeleteSystemConfigs();

  // 弹窗打开（或详情回填）时同步编辑器状态：类型决定用哪种控件，json 需要美化后的初始文本
  const editingKey = modal.editing ? `${modal.editing.id}:${modal.editing.updatedAt}` : 'new';
  useEffect(() => {
    if (!modal.visible) return;
    setConfigType(modal.editing?.configType ?? 'string');
    seedJsonEditor(modal.editing?.configType === 'json' ? modal.editing.configValue : '{}');
    // editingKey 已覆盖 editing 的身份变化，避免对象引用抖动导致重复重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal.visible, editingKey]);

  /** 类型切换时在 Input 与 JsonViewer 之间搬运当前值，避免切来切去把内容丢掉 */
  const handleTypeChange = (values: Record<string, unknown>) => {
    const next = (values.configType as string) ?? 'string';
    if (next === configType) return;
    if (next === 'json') {
      seedJsonEditor((values.configValue as string) ?? '');
    } else if (configType === 'json') {
      modal.formApi.current?.setValue('configValue', jsonText);
    }
    setConfigType(next);
  };

  const openEdit = (record: SystemConfig) => {
    modal.openEdit(record);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  };

  const buildExportQuery = () => ({
    ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
    ...(submittedParams.configType ? { configType: submittedParams.configType } : {}),
  });

  const configTypeOptions = configTypeItems.map((item) => ({ value: item.value, label: item.label }));

  const columns: ColumnProps<SystemConfig>[] = [
    { title: '配置键', dataIndex: 'configKey', width: 220, render: renderEllipsis },
    { title: '配置名称', dataIndex: 'configName', width: 160, render: renderEllipsis },
    { title: '配置值', dataIndex: 'configValue', width: 140, render: renderEllipsis },
    {
      title: '类型',
      dataIndex: 'configType',
      width: 90,
      render: (v: string) => <DictTag dictCode="system_config_type" value={v} />,
    },
    { title: '描述', dataIndex: 'description', minWidth: 300, render: renderEllipsis },
    dateTimeColumn('更新时间', 'updatedAt'),
    createOperationColumn<SystemConfig>({
      width: 150,
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
            confirmDelete({
              title: '确定要删除此配置吗？',
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
          <KeywordInput placeholder="搜索配置键/名称/描述" value={draftParams.keyword} onChange={(value) => setDraftParams((p) => ({ ...p, keyword: value }))} onSearch={handleSearch} width={240} />
          <FilterSelect
            placeholder="全部配置类型"
            items={configTypeItems}
            value={draftParams.configType}
            onChange={(v) => setDraftParams((p) => ({ ...p, configType: v }))}
            width={140}
            loading={configTypeLoading}
          />
          <SearchButton onClick={handleSearch} />
          <ResetButton onClick={handleReset} />
          </>
        )}
        actions={(
          <>
          <ExportButton entity="system.configs" query={buildExportQuery()} />
          {hasPermission('system:config:create') && (
            <CreateButton onClick={modal.openCreate} />
          )}
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索配置键/名称/描述" value={draftParams.keyword} onChange={(value) => setDraftParams((p) => ({ ...p, keyword: value }))} onSearch={handleSearch} width={240} />
            <SearchButton onClick={handleSearch} />
            {hasPermission('system:config:create') && (
              <CreateButton onClick={modal.openCreate} />
            )}
          </>
        )}
        mobileFilters={(
          <FilterSelect
            placeholder="全部配置类型"
            items={configTypeItems}
            value={draftParams.configType}
            onChange={(v) => setDraftParams((p) => ({ ...p, configType: v }))}
            width={140}
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
        {...modal.modalProps}
        width={configType === 'json' ? 720 : 520}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={modal.formKey} {...modal.formProps}
          onValueChange={handleTypeChange}
        >
          <Form.Input
            field="configKey"
            label="配置键"
            rules={[{ required: true, message: '请输入配置键' }]}
            disabled={modal.isEdit}
          />
          <Form.Input
            field="configName"
            label="配置名称"
            placeholder="请输入配置名称"
            rules={[{ required: true, message: '请输入配置名称' }]}
          />
          {configType === 'json' ? (
            <Form.Slot label={{ text: '配置值' }}>
              <JsonViewer
                key={jsonSeed}
                value={jsonSeed}
                onChange={setJsonText}
                height={260}
                width="100%"
              />
            </Form.Slot>
          ) : (
            <Form.Input field="configValue" label="配置值" placeholder="请输入配置值" rules={[{ required: true, message: '请输入配置值' }]} />
          )}
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
