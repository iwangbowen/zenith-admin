import { useState } from 'react';
import { Button, Form, Spin, Toast, Switch, Modal, Row, Col, Typography, Tag, Empty } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import type { WorkflowDataSource, WorkflowDataSourceOption } from '@zenith/shared/workflow';
import {
  useDeleteWorkflowDataSources,
  useSaveWorkflowDataSource,
  useTestWorkflowDataSource,
  useWorkflowDataSourceList,
  workflowDataSourceKeys,
} from '@/hooks/queries/workflow-data-sources';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';

interface SearchParams { keyword: string; status?: string }
const defaultSearchParams: SearchParams = { keyword: '', status: '' };

interface DataSourceFormValues {
  name: string;
  method: 'GET' | 'POST';
  url: string;
  valueField: string;
  labelField: string;
  itemsPath?: string;
  keywordParam?: string;
  status: 'enabled' | 'disabled';
  headersText?: string;
  remark?: string;
}

export default function WorkflowDataSourcesPage() {
  const { items: statusItems } = useDictItems('common_status');
  const STATUS_OPTIONS = statusItems.map((i) => ({ value: i.value, label: i.label }));
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: workflowDataSourceKeys.lists });
  const listQuery = useWorkflowDataSourceList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });
  const data = listQuery.data ?? null;

  const saveMutation = useSaveWorkflowDataSource();
  const toggleStatusMutation = useSaveWorkflowDataSource();
  const deleteMutation = useDeleteWorkflowDataSources();
  const testMutation = useTestWorkflowDataSource();

  // 测试拉取结果
  const [testVisible, setTestVisible] = useState(false);
  const [testSource, setTestSource] = useState<WorkflowDataSource | null>(null);
  const [testOptions, setTestOptions] = useState<WorkflowDataSourceOption[]>([]);
  const [testError, setTestError] = useState('');

  const dataSourceModal = useEditModal<WorkflowDataSource, DataSourceFormValues, Record<string, unknown>>({
    entityName: '数据源',
    save: saveMutation,
    defaults: { name: '', method: 'GET', url: '', valueField: '', labelField: '', status: 'enabled' },
    toValues: (record) => ({
      name: record.name, method: record.method, url: record.url, valueField: record.valueField, labelField: record.labelField,
      itemsPath: record.itemsPath ?? '', keywordParam: record.keywordParam ?? '', status: record.status,
      headersText: record.headers && Object.keys(record.headers).length > 0 ? JSON.stringify(record.headers, null, 2) : '',
      remark: record.remark ?? '',
    }),
    beforeSave: (values) => {
    let headers: Record<string, string> | undefined;
    if (values.headersText?.trim()) {
      try {
        const parsed = JSON.parse(values.headersText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) headers = parsed as Record<string, string>;
        else throw new Error('not object');
      } catch {
        Toast.error('请求头需为合法的 JSON 对象');
        abortSubmit('headers');
      }
    }
    const payload = {
      name: values.name,
      method: values.method,
      url: values.url,
      valueField: values.valueField,
      labelField: values.labelField,
      itemsPath: values.itemsPath?.trim() || undefined,
      keywordParam: values.keywordParam?.trim() || undefined,
      status: values.status,
      headers,
      remark: values.remark?.trim() || undefined,
    };
    return payload;
    },
    labelWidth: 96,
  });

  function openCreate() { dataSourceModal.openCreate(); }
  function openEdit(record: WorkflowDataSource) { dataSourceModal.openEdit(record); }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  }

  function handleToggleStatus(record: WorkflowDataSource, checked: boolean) {
    const doToggle = async () => {
      await toggleStatusMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } });
      Toast.success(checked ? '已启用' : '已停用');
    };
    if (checked) void doToggle();
    else Modal.confirm({ title: '确认停用', content: `停用后「${record.name}」将不再可被表单字段使用，确认停用？`, onOk: () => void doToggle() });
  }

  async function handleTest(record: WorkflowDataSource) {
    setTestSource(record);
    setTestVisible(true);
    setTestError('');
    setTestOptions([]);
    try {
      const options = await testMutation.mutateAsync({ params: { id: record.id }, query: {} });
      setTestOptions(options);
    } catch (err) {
      setTestError((err as Error).message || '拉取失败');
    }
  }

  const columns: ColumnProps<WorkflowDataSource>[] = [
    { title: '名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    { title: '方法', dataIndex: 'method', width: 80, render: (m: string) => <Tag size="small" color={m === 'POST' ? 'orange' : 'blue'}>{m}</Tag> },
    { title: '接口地址', dataIndex: 'url', minWidth: 280, render: renderEllipsis },
    { title: '取值/显示字段', dataIndex: 'valueField', width: 150, render: (_: unknown, r: WorkflowDataSource) => `${r.valueField} / ${r.labelField}` },
    { title: '备注', dataIndex: 'remark', width: 160, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, record: WorkflowDataSource) => (
        <Switch
          checked={record.status === 'enabled'}
          loading={toggleStatusMutation.isPending && toggleStatusMutation.variables?.id === record.id}
          disabled={!hasPermission('workflow:datasource:update')}
          onChange={(checked) => handleToggleStatus(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<WorkflowDataSource>({
      width: 210,
      desktopInlineKeys: ['test', 'edit', 'delete'],
      actions: (record) => [
        { key: 'test', label: '测试', onClick: () => void handleTest(record) },
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('workflow:datasource:update'),
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('workflow:datasource:delete'),
          onClick: () => {
            confirmDelete({
              content: '删除后引用该数据源的表单字段将无法加载选项',
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索名称 / 地址..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );

  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );

  const renderCreateButton = () => hasPermission('workflow:datasource:create') ? (
    <CreateButton onClick={openCreate} />
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={renderStatusFilter()}
        filterTitle="数据源筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无数据"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        {...dataSourceModal.modalProps}
        width={660}
        closeOnEsc
      >
        <Form
          key={dataSourceModal.formKey} {...dataSourceModal.formProps}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="名称" placeholder="请输入名称" rules={[{ required: true, message: '名称不能为空' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="method" label="请求方法" style={{ width: '100%' }} optionList={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]} rules={[{ required: true, message: '请选择请求方法' }]} />
            </Col>
          </Row>
          <Form.Input field="url" label="接口地址" placeholder="https://..." rules={[{ required: true, message: 'URL 不能为空' }, { pattern: /^https?:\/\/.+/i, message: 'URL 需以 http:// 或 https:// 开头' }]} />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="valueField" label="取值字段" placeholder="如 id" rules={[{ required: true, message: '取值字段不能为空' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="labelField" label="显示字段" placeholder="如 name" rules={[{ required: true, message: '显示字段不能为空' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="itemsPath" label="数组路径" placeholder="如 data.list（留空=根为数组）" />
            </Col>
            <Col span={12}>
              <Form.Input field="keywordParam" label="搜索参数名" placeholder="留空=不支持远程搜索" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={STATUS_OPTIONS} rules={[{ required: true, message: '请选择状态' }]} />
            </Col>
          </Row>
          <Form.TextArea field="headersText" label="请求头(JSON)" placeholder='可选，如 {"Authorization":"Bearer xxx"}' autosize={{ minRows: 2, maxRows: 5 }} />
          <Form.TextArea field="remark" label="备注" placeholder="可选" autosize={{ minRows: 1, maxRows: 3 }} />
        </Form>
      </AppModal>

      <AppModal
        title={`测试拉取 · ${testSource?.name ?? ''}`}
        visible={testVisible}
        onCancel={() => setTestVisible(false)}
        footer={<Button type="primary" onClick={() => setTestVisible(false)}>关闭</Button>}
        width={480}
        closeOnEsc
      >
        <Spin spinning={testMutation.isPending} wrapperClassName="modal-spin-wrapper">
          {testError ? (
            <Typography.Text type="danger">{testError}</Typography.Text>
          ) : testOptions.length === 0 ? (
            <Empty description={testMutation.isPending ? '拉取中...' : '无选项'} />
          ) : (
            <div>
              <Typography.Paragraph type="tertiary" size="small" style={{ marginBottom: 8 }}>
                共 {testOptions.length} 项，预览前 50 项（value / label）：
              </Typography.Paragraph>
              <div style={{ maxHeight: '50vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {testOptions.slice(0, 50).map((o) => (
                  <div key={o.value} style={{ display: 'flex', gap: 8, padding: '4px 8px', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-small)' }}>
                    <Typography.Text type="tertiary" size="small" style={{ width: 140, flexShrink: 0 }} ellipsis={{ showTooltip: true }}>{o.value}</Typography.Text>
                    <Typography.Text size="small" ellipsis={{ showTooltip: true }}>{o.label}</Typography.Text>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Spin>
      </AppModal>
    </div>
  );
}
