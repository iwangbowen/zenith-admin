import { useState, useMemo } from 'react';
import { Button, Col, Form, Modal, Row, SideSheet, Switch, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import { FormTimezoneSelect } from '@/components/FormTimezoneSelect';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime } from '@/utils/date';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import {
  useAcknowledgeReportAlertRun,
  useBatchReportAlertEnabled,
  reportAlertKeys,
  useDeleteReportAlerts,
  useEvaluateReportAlert,
  useReportAlertHistory,
  useReportAlertList,
  useSaveReportAlert,
  useToggleReportAlertEnabled,
} from '@/hooks/queries/report-alerts';
import { useReportDatasetDetail, useEnabledReportDatasets } from '@/hooks/queries/report-datasets';
import { useReportMetricLookup } from '@/hooks/queries/report-metrics';
import type { CreateReportAlertInput, ReportAlertAggregate, ReportAlertOp, ReportAlertRule, ReportDeliveryRun } from '@zenith/shared/report';
import { NOTIFY_CHANNEL_LABELS } from '@zenith/shared/messaging';
import { REPORT_DELIVERY_STATUS_LABELS, REPORT_DELIVERY_TRIGGER_LABELS, REPORT_MISFIRE_POLICY_OPTIONS } from '@zenith/shared/report';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { switchAlertSource } from './report-platform-utils';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { DEFAULT_TIMEZONE } from '@/utils/timezones';

interface SearchParams {
  keyword: string;
  datasetId?: string;
  metricId?: string;
  enabled?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', datasetId: undefined, metricId: undefined, enabled: undefined };

const aggregateOptions: Array<{ value: ReportAlertAggregate; label: string }> = [
  { value: 'sum', label: '求和 sum' },
  { value: 'avg', label: '平均 avg' },
  { value: 'max', label: '最大 max' },
  { value: 'min', label: '最小 min' },
  { value: 'count', label: '计数 count' },
  { value: 'first', label: '首值 first' },
];

const opOptions: Array<{ value: ReportAlertOp; label: string }> = [
  { value: 'gt', label: '> 大于' },
  { value: 'gte', label: '≥ 大于等于' },
  { value: 'lt', label: '< 小于' },
  { value: 'lte', label: '≤ 小于等于' },
  { value: 'eq', label: '= 等于' },
  { value: 'neq', label: '≠ 不等于' },
];

const opSymbolMap: Record<ReportAlertOp, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
};

// report 域后端 value 为驼峰 inApp（历史枚举），label 统一复用 NOTIFY_CHANNEL_LABELS
const channelLabelMap: Record<'email' | 'inApp' | 'webhook', string> = {
  email: NOTIFY_CHANNEL_LABELS.email,
  inApp: NOTIFY_CHANNEL_LABELS.inapp,
  webhook: NOTIFY_CHANNEL_LABELS.webhook,
};

function formatRule(record: ReportAlertRule) {
  if (record.metricId) return `${record.metricName || `指标 #${record.metricId}`} ${opSymbolMap[record.op]} ${record.threshold}`;
  const scope = record.groupByField ? `按${record.groupByField}分组 · ` : '';
  return `${scope}${record.aggregate}(${record.aggregate === 'count' ? '*' : record.field || '-'}) ${opSymbolMap[record.op]} ${record.threshold}`;
}

export default function AlertsPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: reportAlertKeys.lists });

  const datasetsQuery = useEnabledReportDatasets();
  const datasets = useMemo(() => datasetsQuery.data ?? [], [datasetsQuery.data]);
  const metricsQuery = useReportMetricLookup(
    { status: 'published', limit: 100 },
    hasPermission('report:metric:list'),
  );
  const metrics = metricsQuery.data ?? [];

  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [historyTarget, setHistoryTarget] = useState<ReportAlertRule | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [sourceType, setSourceType] = useState<'dataset' | 'metric'>('dataset');
  const [selectedAggregate, setSelectedAggregate] = useState<ReportAlertAggregate>('sum');
  const [selectedChannels, setSelectedChannels] = useState<Array<'email' | 'inApp' | 'webhook'>>(['inApp']);
  const [cronExprValue, setCronExprValue] = useState('');
  const listQuery = useReportAlertList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    datasetId: submittedParams.datasetId ? Number(submittedParams.datasetId) : undefined,
    metricId: submittedParams.metricId ? Number(submittedParams.metricId) : undefined,
    enabled: submittedParams.enabled ? submittedParams.enabled === 'enabled' : undefined,
  });
  const data = listQuery.data ?? null;
  const saveMutation = useSaveReportAlert();
  const toggleMutation = useToggleReportAlertEnabled();
  const batchEnabledMutation = useBatchReportAlertEnabled();
  const evaluateMutation = useEvaluateReportAlert();
  const deleteMutation = useDeleteReportAlerts();
  const acknowledgeMutation = useAcknowledgeReportAlertRun();
  const historyQuery = useReportAlertHistory(historyTarget?.id, !!historyTarget);
  const togglingId = toggleMutation.isPending ? toggleMutation.variables?.params.id ?? null : null;

  const alertModal = useEditModal<ReportAlertRule, Record<string, unknown>, CreateReportAlertInput>({
    entityName: '预警',
    save: saveMutation,
    defaults: { sourceType: 'dataset', aggregate: 'sum', op: 'gt', cron: '', timezone: DEFAULT_TIMEZONE, misfirePolicy: 'fire_once', channels: ['inApp'], silenceMins: 60, notifyOnRecover: false, enabled: 'enabled' },
    toValues: (record) => ({
      name: record.name,
      datasetId: record.datasetId,
      metricId: record.metricId ?? undefined,
      sourceType: record.metricId ? 'metric' : 'dataset',
      aggregate: record.aggregate,
      field: record.field ?? undefined,
      groupByField: record.groupByField ?? undefined,
      op: record.op,
      threshold: record.threshold,
      cron: record.cron ?? '',
      timezone: record.timezone,
      misfirePolicy: record.misfirePolicy,
      channels: record.channels,
      recipients: record.recipients ?? '',
      webhookUrl: record.webhookUrl ?? '',
      silenceMins: record.silenceMins ?? 60,
      notifyOnRecover: record.notifyOnRecover ?? false,
      enabled: record.enabled ? 'enabled' : 'disabled',
      remark: record.remark ?? '',
    }),
    beforeSave: buildPayload,
  });
  const selectedDatasetFieldsQuery = useReportDatasetDetail(selectedDatasetId ?? undefined, alertModal.visible && !!selectedDatasetId);
  const selectedFields = selectedDatasetFieldsQuery.data?.fields ?? [];

  function openCreate() {
    setSelectedDatasetId(null);
    setSourceType('dataset');
    setSelectedAggregate('sum');
    setSelectedChannels(['inApp']);
    setCronExprValue('');
    alertModal.openCreate();
  }

  function openEdit(record: ReportAlertRule) {
    setSelectedDatasetId(record.datasetId);
    setSourceType(record.metricId ? 'metric' : 'dataset');
    setSelectedAggregate(record.aggregate);
    setSelectedChannels(record.channels);
    setCronExprValue(record.cron ?? '');
    alertModal.openEdit(record);
  }

  function buildPayload(values: Record<string, unknown>): CreateReportAlertInput {
    const aggregate = values.aggregate as ReportAlertAggregate;
    const channels = (values.channels ?? []) as Array<'email' | 'inApp' | 'webhook'>;
    return {
      name: String(values.name ?? ''),
      datasetId: sourceType === 'dataset' && values.datasetId ? Number(values.datasetId) : null,
      metricId: sourceType === 'metric' && values.metricId ? Number(values.metricId) : null,
      field: sourceType === 'metric' || aggregate === 'count' ? null : (values.field ? String(values.field) : null),
      groupByField: sourceType === 'metric' ? null : values.groupByField ? String(values.groupByField) : null,
      aggregate,
      op: values.op as ReportAlertOp,
      threshold: Number(values.threshold),
      cron: values.cron ? String(values.cron) : null,
      timezone: String(values.timezone ?? DEFAULT_TIMEZONE),
      misfirePolicy: values.misfirePolicy as 'skip' | 'fire_once',
      channels,
      recipients: channels.includes('email') && values.recipients ? String(values.recipients) : undefined,
      webhookUrl: channels.includes('webhook') && values.webhookUrl ? String(values.webhookUrl) : null,
      silenceMins: Number(values.silenceMins ?? 60),
      notifyOnRecover: Boolean(values.notifyOnRecover),
      enabled: values.enabled === 'enabled',
      remark: values.remark ? String(values.remark) : undefined,
    };
  }


  function handleToggleEnabled(record: ReportAlertRule, checked: boolean) {
    const doToggle = async () => {
      try {
        await toggleMutation.mutateAsync({ params: { id: record.id }, body: { enabled: checked } });
        Toast.success(checked ? '已启用' : '已停用');
      } catch (error) {
        Toast.error(error instanceof Error ? error.message : '状态更新失败');
      }
    };
    if (checked) void doToggle();
    else Modal.confirm({ title: '确认停用', content: `停用后「${record.name}」将不再自动评估，确认停用？`, onOk: () => void doToggle() });
  }

  async function handleEvaluate(id: number) {
    try {
      await evaluateMutation.mutateAsync({ params: { id } });
      Toast.success('任务已提交，可在任务中心查看进度');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '评估失败');
    }
  }

  async function handleAcknowledge(runId: number) {
    try {
      await acknowledgeMutation.mutateAsync({ params: { id: runId }, body: {} });
      await historyQuery.refetch();
      Toast.success('已确认');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '确认失败');
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMutation.mutateAsync([id]);
      Toast.success('删除成功');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  function handleBatchEnabled(enabled: boolean) {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认批量${enabled ? '启用' : '停用'}选中的 ${selectedRowKeys.length} 条预警？`,
      onOk: async () => {
        await batchEnabledMutation.mutateAsync({ body: { ids: selectedRowKeys, enabled } });
        setSelectedRowKeys([]);
        Toast.success(enabled ? '批量启用成功' : '批量停用成功');
      },
    });
  }

  const columns: ColumnProps<ReportAlertRule>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis },
    {
      title: '来源', dataIndex: 'datasetName', width: 180,
      render: (_: unknown, record) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          {record.metricId
            ? <Tag color="purple" size="small" style={{ flexShrink: 0 }}>指标</Tag>
            : <Tag color="blue" size="small" style={{ flexShrink: 0 }}>数据集</Tag>}
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>
            {record.metricId ? (record.metricName || `#${record.metricId}`) : (record.datasetName || `#${record.datasetId}`)}
          </Typography.Text>
        </span>
      ),
    },
    { title: '规则', dataIndex: 'id', width: 180, render: (_: unknown, record: ReportAlertRule) => renderEllipsis(formatRule(record)) },
    {
      title: '通道',
      dataIndex: 'channels',
      width: 140,
      render: (channels: Array<'email' | 'inApp' | 'webhook'>) => (channels ?? []).map((channel) => (
        <Tag key={channel} size="small" color={channel === 'email' ? 'blue' : channel === 'webhook' ? 'purple' : 'green'} style={{ marginRight: 4 }}>
          {channelLabelMap[channel]}
        </Tag>
      )),
    },
    {
      title: '最近触发',
      dataIndex: 'lastTriggered',
      width: 190,
      render: (_: unknown, record: ReportAlertRule) => (
        <Tooltip content={record.lastCheckedAt ? `最近评估：${formatDateTime(record.lastCheckedAt)}` : '尚未评估'}>
          <span>
            <Tag color={record.lastTriggered ? 'red' : 'grey'} size="small" style={{ marginRight: 6 }}>
              {record.lastTriggered ? '已触发' : '正常'}
            </Tag>
            <Typography.Text type="tertiary" size="small">
              {record.lastValue == null ? '—' : `值 ${record.lastValue}`}
            </Typography.Text>
          </span>
        </Tooltip>
      ),
    },
    dateTimeColumn('下次执行', 'nextRunAt'),
    { title: '时区', dataIndex: 'timezone', width: 150, render: renderEllipsis },
    { title: '错过策略', dataIndex: 'misfirePolicy', width: 110, render: (value: string) => REPORT_MISFIRE_POLICY_OPTIONS.find((item) => item.value === value)?.label ?? value },
    {
      title: '最近投递',
      dataIndex: 'lastDeliveryStatus',
      width: 220,
      render: (_: unknown, record: ReportAlertRule) => (
        <div>
          <Tag color={record.lastDeliveryStatus === 'success' ? 'green' : record.lastDeliveryStatus === 'failed' ? 'red' : record.lastDeliveryStatus === 'partial' ? 'orange' : record.lastDeliveryStatus === 'pending' ? 'blue' : 'grey'} size="small">
            {record.lastDeliveryStatus ? REPORT_DELIVERY_STATUS_LABELS[record.lastDeliveryStatus] : '—'}
          </Tag>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
            {record.lastDeliveryAt || '未投递'}
          </Typography.Text>
          {record.lastDeliveryError ? <Typography.Text type="danger" size="small">{record.lastDeliveryError}</Typography.Text> : null}
        </div>
      ),
    },
    { title: '备注', dataIndex: 'remark', width: 180, render: renderEllipsis },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      fixed: 'right',
      render: (_: unknown, record: ReportAlertRule) => (
        <Switch
          checked={record.enabled}
          loading={togglingId === record.id}
          disabled={!hasPermission('report:alert:update')}
          onChange={(checked) => handleToggleEnabled(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<ReportAlertRule>({
      width: 240,
      desktopInlineKeys: ['edit', 'evaluate', 'history'],
      actions: (record) => [
        ...(hasPermission('report:alert:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        ...(hasPermission('report:alert:list') ? [{ key: 'evaluate', label: '评估', onClick: () => void handleEvaluate(record.id) }] : []),
        ...(hasPermission('report:alert:list') ? [{ key: 'history', label: '历史', onClick: () => setHistoryTarget(record) }] : []),
        ...(hasPermission('report:alert:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => { confirmDelete({ content: '删除后不可恢复', onOk: () => handleDelete(record.id) }); },
        }] : []),
      ],
    }),
  ];

  const renderKeyword = () => (
    <KeywordInput placeholder="搜索名称/备注" value={draftParams.keyword} onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))} onSearch={handleSearch} width={200} />
  );
  const renderDatasetFilter = () => (
    <FilterSelect
      placeholder="全部数据集"
      items={datasets.map((dataset) => ({ value: String(dataset.id), label: dataset.name }))}
      value={draftParams.datasetId}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, datasetId: value, metricId: undefined }))}
      width={180}
      filter
    />
  );
  const renderMetricFilter = () => (
    <FilterSelect
      placeholder="全部指标"
      items={metrics.map((metric) => ({ value: String(metric.id), label: metric.name }))}
      value={draftParams.metricId}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, metricId: value, datasetId: undefined }))}
      width={180}
      filter
    />
  );
  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.enabled}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, enabled: value }))}
    />
  );
  const renderSearchBtn = () => <SearchButton onClick={handleSearch} />;
  const renderResetBtn = () => <ResetButton onClick={handleReset} />;
  const renderCreateBtn = () => hasPermission('report:alert:create')
    ? <CreateButton onClick={openCreate} /> : null;
  const renderBatchEnableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:alert:update')
    ? <Button onClick={() => handleBatchEnabled(true)}>批量启用</Button> : null;
  const renderBatchDisableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:alert:update')
    ? <Button type="danger" onClick={() => handleBatchEnabled(false)}>批量停用</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderDatasetFilter()}{renderMetricFilter()}{renderStatusFilter()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}{renderCreateBtn()}</>}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={<>{renderDatasetFilter()}{renderMetricFilter()}{renderStatusFilter()}</>}
        mobileActions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}</>}
        filterTitle="预警筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无预警"
        rowSelection={hasPermission('report:alert:update') ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        } : undefined}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />

      <SideSheet
        title={alertModal.isEdit ? `编辑预警 · ${alertModal.editing?.name ?? ''}` : '新建预警'}
        visible={alertModal.visible}
        onCancel={alertModal.close}
        closeOnEsc
        placement="right"
        width={760}
        bodyStyle={{ padding: 16, overflow: 'auto' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Form key={alertModal.formKey} {...alertModal.formProps}
            onValueChange={(values, changedValues) => {
              // 只响应本次实际变更的字段；setValue 会同步重入 onValueChange，
              // 无条件处理会因闭包中的旧 state 造成无限递归（栈溢出崩溃）
              const changed = (changedValues ?? {}) as Record<string, unknown>;
              if ('datasetId' in changed) {
                const nextDatasetId = values.datasetId ? Number(values.datasetId) : null;
                setSelectedDatasetId(nextDatasetId);
                if (values.field !== undefined) alertModal.formApi.current?.setValue('field', undefined);
              }
              if ('aggregate' in changed) {
                const nextAggregate = (values.aggregate ?? 'sum') as ReportAlertAggregate;
                setSelectedAggregate(nextAggregate);
                if (nextAggregate === 'count' && values.field !== undefined) {
                  alertModal.formApi.current?.setValue('field', undefined);
                }
              }
              if ('channels' in changed) setSelectedChannels(((values.channels ?? []) as Array<'email' | 'inApp' | 'webhook'>));
              if ('cron' in changed && typeof values.cron === 'string') setCronExprValue(values.cron);
            }}
          >
            <Row gutter={24}>
              <Col xs={24} md={12}>
                <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear />
              </Col>
              <Col xs={24} md={12}>
                <Form.Select field="sourceType" label="来源类型" style={{ width: '100%' }}
                  optionList={[{ value: 'dataset', label: '数据集' }, { value: 'metric', label: '指标' }]}
                  onChange={(value) => {
                    const next = value as 'dataset' | 'metric';
                    setSourceType(next);
                    const reset = switchAlertSource(next);
                    Object.entries(reset).forEach(([key, item]) => alertModal.formApi.current?.setValue(key, item));
                    setSelectedDatasetId(null);
                  }} />
              </Col>
              {sourceType === 'dataset' ? (
                <>
                  <Col xs={24} md={12}>
                    <Form.Select field="datasetId" label="数据集" style={{ width: '100%' }} rules={[{ required: true, message: '请选择数据集' }]} filter
                      optionList={datasets.map((dataset) => ({ value: dataset.id, label: dataset.name }))} />
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Select field="aggregate" label="聚合方式" style={{ width: '100%' }} optionList={aggregateOptions} />
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Select field="field" label="监控字段" style={{ width: '100%' }} disabled={selectedAggregate === 'count'}
                      placeholder={selectedAggregate === 'count' ? 'count 不需要选择字段' : '请选择监控字段'}
                      rules={selectedAggregate === 'count' ? [] : [{ required: true, message: '请选择监控字段' }]}
                      extraText={selectedAggregate === 'count' ? undefined : '仅数值类型字段可参与 sum/avg/min/max 聚合'}
                      optionList={(selectedAggregate === 'count' ? selectedFields : selectedFields.filter((field) => field.type === 'number'))
                        .map((field) => ({ value: field.name, label: field.label ? `${field.label}（${field.name}）` : field.name }))} />
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Select field="groupByField" label="分组维度" style={{ width: '100%' }} showClear
                      placeholder="可选；按该字段分组聚合，任一组命中即触发"
                      optionList={selectedFields.map((field) => ({ value: field.name, label: field.label ? `${field.label}（${field.name}）` : field.name }))} />
                  </Col>
                </>
              ) : (
                <Col xs={24} md={12}>
                  <Form.Select field="metricId" label="指标" style={{ width: '100%' }} rules={[{ required: true, message: '请选择指标' }]} filter
                    optionList={metrics.filter((metric) => metric.status === 'published').map((metric) => ({ value: metric.id, label: `${metric.name}（${metric.code}）` }))} />
                </Col>
              )}
              <Col xs={24} md={12}>
                <Form.Select field="op" label="运算符" style={{ width: '100%' }} optionList={opOptions} />
              </Col>
              <Col xs={24} md={12}>
                <Form.InputNumber field="threshold" label="阈值" style={{ width: '100%' }} rules={[{ required: true, message: '请输入阈值' }]} />
              </Col>
              <Col xs={24} md={12}>
                <Form.Input
                  field="cron"
                  label="评估 Cron"
                  placeholder="0 */5 * * * *"
                  helpText="留空=仅手动"
                  showClear
                  addonAfter={(
                    <CronBuilderPopover
                      value={cronExprValue}
                      onApply={(expression) => {
                        alertModal.formApi.current?.setValue('cron', expression);
                        setCronExprValue(expression);
                      }}
                    />
                  )}
                />
              </Col>
              <Col xs={24} md={12}>
                <FormTimezoneSelect />
              </Col>
              <Col xs={24} md={12}>
                <Form.Select field="misfirePolicy" label="错过策略" style={{ width: '100%' }} optionList={REPORT_MISFIRE_POLICY_OPTIONS} />
              </Col>
              <Col xs={24} md={12}>
                <Form.Select field="channels" label="通知通道" multiple style={{ width: '100%' }} rules={[{ required: true, message: '至少选择一个通道' }]}
                  optionList={[{ value: 'email', label: channelLabelMap.email }, { value: 'inApp', label: channelLabelMap.inApp }, { value: 'webhook', label: `${channelLabelMap.webhook}（企微/钉钉机器人）` }]} />
              </Col>
              {selectedChannels.includes('email') && (
                <Col xs={24} md={12}>
                  <Form.Input field="recipients" label="收件人邮箱" placeholder="多个用逗号分隔" showClear />
                </Col>
              )}
              {selectedChannels.includes('webhook') && (
                <Col xs={24} md={12}>
                  <Form.Input field="webhookUrl" label="Webhook 地址" placeholder="企微/钉钉机器人 Webhook URL 或通用 JSON 端点"
                    rules={[{ required: true, message: '请填写 Webhook 地址' }]} showClear />
                </Col>
              )}
              <Col xs={24} md={12}>
                <Form.InputNumber field="silenceMins" label="静默期(分)" min={0} max={10080} step={10} style={{ width: '100%' }}
                  helpText="持续触发时，距上次通知不足该时长不重复通知；0=每次触发都通知" />
              </Col>
              <Col xs={24} md={12}>
                <Form.Switch field="notifyOnRecover" label="恢复通知" extraText="从触发恢复正常时发送一条恢复通知" />
              </Col>
              <Col xs={24} md={12}>
                <Form.Select field="enabled" label="状态" style={{ width: '100%' }} optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
              </Col>
              <Col xs={24}>
                <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
              </Col>
            </Row>
          </Form>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid var(--semi-color-border)' }}>
            <Button onClick={alertModal.close}>取消</Button>
            <Button type="primary" loading={alertModal.modalProps.okButtonProps.loading} disabled={alertModal.modalProps.okButtonProps.disabled} onClick={() => void alertModal.modalProps.onOk()}>
              {alertModal.isEdit ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </SideSheet>

      <SideSheet
        title={historyTarget ? `预警历史 · ${historyTarget.name}` : '预警历史'}
        visible={!!historyTarget}
        width={980}
        closeOnEsc
        placement="right"
        onCancel={() => setHistoryTarget(null)}
      >
        <ConfigurableTable
          bordered
          rowKey="id"
          size="small"
          loading={historyQuery.isFetching}
          dataSource={historyQuery.data?.list ?? []}
          columns={[
            { title: '类型', dataIndex: 'triggerType', width: 90, render: (value: string) => REPORT_DELIVERY_TRIGGER_LABELS[value as keyof typeof REPORT_DELIVERY_TRIGGER_LABELS] ?? value },
            { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag color={value === 'success' ? 'green' : value === 'failed' ? 'red' : value === 'partial' ? 'orange' : value === 'pending' ? 'blue' : 'grey'}>{REPORT_DELIVERY_STATUS_LABELS[value as keyof typeof REPORT_DELIVERY_STATUS_LABELS] ?? value}</Tag> },
            { title: '值', dataIndex: 'lastValue', width: 80, render: (value: number | null) => value ?? '—' },
            dateTimeColumn('开始时间', 'startedAt'),
            dateTimeColumn('完成时间', 'completedAt'),
            dateTimeColumn('确认时间', 'acknowledgedAt', { empty: '未确认' }),
            {
              title: '确认人', dataIndex: 'acknowledgedByName', width: 120,
              render: (value: string | null) => value || EMPTY_PLACEHOLDER,
            },
            { title: '错误', dataIndex: 'errorMessage', minWidth: 220, render: renderEllipsis },
            {
              title: '操作',
              dataIndex: 'id',
              width: 100,
              fixed: 'right',
              render: (_: unknown, record: ReportDeliveryRun) => (
                record.acknowledgedAt || !hasPermission('report:alert:update')
                  ? <span style={{ color: '#999' }}>—</span>
                  : <Button theme="borderless" size="small" onClick={() => void handleAcknowledge(record.id)}>确认</Button>
              ),
            },
          ] as ColumnProps<ReportDeliveryRun>[]}
          pagination={false}
          empty="暂无执行历史"
        />
      </SideSheet>
    </div>
  );
}
