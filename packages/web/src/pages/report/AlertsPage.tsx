import { useState, useMemo, useRef } from 'react';
import { Button, Col, Form, Input, Modal, Row, Select, SideSheet, Switch, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAcknowledgeReportAlertRun,
  useBatchReportAlertEnabled,
  reportAlertKeys,
  useDeleteReportAlert,
  useEvaluateReportAlert,
  useReportAlertHistory,
  useReportAlertList,
  useSaveReportAlert,
  useToggleReportAlertEnabled,
} from '@/hooks/queries/report-alerts';
import { useReportDatasetDetail, useEnabledReportDatasets } from '@/hooks/queries/report-datasets';
import type {
  CreateReportAlertInput,
  ReportAlertAggregate,
  ReportAlertOp,
  ReportAlertRule,
  ReportDeliveryRun,
} from '@zenith/shared';
import { NOTIFY_CHANNEL_LABELS, REPORT_DELIVERY_STATUS_LABELS, REPORT_MISFIRE_POLICY_OPTIONS } from '@zenith/shared';
import { useDictItems } from '@/hooks/useDictItems';

interface SearchParams {
  keyword: string;
  datasetId: string;
  enabled: string;
}

const defaultSearchParams: SearchParams = { keyword: '', datasetId: '', enabled: '' };

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
  const scope = record.groupByField ? `按${record.groupByField}分组 · ` : '';
  return `${scope}${record.aggregate}(${record.aggregate === 'count' ? '*' : record.field || '-'}) ${opSymbolMap[record.op]} ${record.threshold}`;
}

export default function AlertsPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const datasetsQuery = useEnabledReportDatasets();
  const datasets = useMemo(() => datasetsQuery.data ?? [], [datasetsQuery.data]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportAlertRule | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [historyTarget, setHistoryTarget] = useState<ReportAlertRule | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [selectedAggregate, setSelectedAggregate] = useState<ReportAlertAggregate>('sum');
  const [selectedChannels, setSelectedChannels] = useState<Array<'email' | 'inApp' | 'webhook'>>(['inApp']);
  const selectedDatasetDetailQuery = useReportDatasetDetail(selectedDatasetId ?? undefined, modalVisible && !!selectedDatasetId);
  const selectedFields = selectedDatasetDetailQuery.data?.fields ?? [];

  const listQuery = useReportAlertList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    datasetId: submittedParams.datasetId || undefined,
    enabled: submittedParams.enabled ? submittedParams.enabled === 'enabled' : undefined,
  });
  const data = listQuery.data ?? null;
  const saveMutation = useSaveReportAlert();
  const toggleMutation = useToggleReportAlertEnabled();
  const batchEnabledMutation = useBatchReportAlertEnabled();
  const evaluateMutation = useEvaluateReportAlert();
  const deleteMutation = useDeleteReportAlert();
  const acknowledgeMutation = useAcknowledgeReportAlertRun();
  const historyQuery = useReportAlertHistory(historyTarget?.id, !!historyTarget);
  const togglingId = toggleMutation.isPending ? toggleMutation.variables?.id ?? null : null;

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: reportAlertKeys.lists });
  }

  function handleReset() {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: reportAlertKeys.lists });
  }

  function openCreate() {
    setEditing(null);
    setSelectedDatasetId(null);
    setSelectedAggregate('sum');
    setSelectedChannels(['inApp']);
    setModalVisible(true);
  }

  function openEdit(record: ReportAlertRule) {
    setEditing(record);
    setSelectedDatasetId(record.datasetId);
    setSelectedAggregate(record.aggregate);
    setSelectedChannels(record.channels);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditing(null);
  }

  const initValues = editing
    ? {
        name: editing.name,
        datasetId: editing.datasetId,
        aggregate: editing.aggregate,
        field: editing.field ?? undefined,
        groupByField: editing.groupByField ?? undefined,
        op: editing.op,
        threshold: editing.threshold,
        cron: editing.cron ?? '',
        timezone: editing.timezone,
        misfirePolicy: editing.misfirePolicy,
        channels: editing.channels,
        recipients: editing.recipients ?? '',
        webhookUrl: editing.webhookUrl ?? '',
        silenceMins: editing.silenceMins ?? 60,
        notifyOnRecover: editing.notifyOnRecover ?? false,
        enabled: editing.enabled ? 'enabled' : 'disabled',
        remark: editing.remark ?? '',
      }
    : { aggregate: 'sum', op: 'gt', cron: '', timezone: 'Asia/Shanghai', misfirePolicy: 'fire_once', channels: ['inApp'], silenceMins: 60, notifyOnRecover: false, enabled: 'enabled' };

  function buildPayload(values: Record<string, unknown>): CreateReportAlertInput {
    const aggregate = values.aggregate as ReportAlertAggregate;
    const channels = (values.channels ?? []) as Array<'email' | 'inApp' | 'webhook'>;
    return {
      name: String(values.name ?? ''),
      datasetId: Number(values.datasetId),
      field: aggregate === 'count' ? null : (values.field ? String(values.field) : null),
      groupByField: values.groupByField ? String(values.groupByField) : null,
      aggregate,
      op: values.op as ReportAlertOp,
      threshold: Number(values.threshold),
      cron: values.cron ? String(values.cron) : null,
      timezone: String(values.timezone ?? 'Asia/Shanghai'),
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

  async function handleOk() {
    let values: Record<string, unknown>;
    try { values = await formApi.current?.validate() as Record<string, unknown>; } catch { throw new Error('validation'); }
    const payload = buildPayload(values);
    try {
      await saveMutation.mutateAsync({ id: editing?.id, values: payload });
      Toast.success(editing ? '更新成功' : '创建成功');
      closeModal();
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '保存失败');
      throw error;
    }
  }

  function handleToggleEnabled(record: ReportAlertRule, checked: boolean) {
    const doToggle = async () => {
      try {
        await toggleMutation.mutateAsync({ id: record.id, enabled: checked });
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
      await evaluateMutation.mutateAsync(id);
      Toast.success('任务已提交，可在任务中心查看进度');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '评估失败');
    }
  }

  async function handleAcknowledge(runId: number) {
    try {
      await acknowledgeMutation.mutateAsync({ runId });
      await historyQuery.refetch();
      Toast.success('已确认');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '确认失败');
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMutation.mutateAsync(id);
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
        await batchEnabledMutation.mutateAsync({ ids: selectedRowKeys, enabled });
        setSelectedRowKeys([]);
        Toast.success(enabled ? '批量启用成功' : '批量停用成功');
      },
    });
  }

  const columns: ColumnProps<ReportAlertRule>[] = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '数据集', dataIndex: 'datasetName', width: 160, render: (value: string) => value || '-' },
    { title: '规则', dataIndex: 'id', width: 180, render: (_: unknown, record: ReportAlertRule) => formatRule(record) },
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
    { title: '下次执行', dataIndex: 'nextRunAt', width: 170, render: (value: string | null) => value || '—' },
    { title: '时区', dataIndex: 'timezone', width: 120, render: (value: string) => value || '—' },
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
      width: 170,
      desktopInlineKeys: ['edit', 'evaluate', 'history', 'delete'],
      actions: (record) => [
        ...(hasPermission('report:alert:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        ...(hasPermission('report:alert:list') ? [{ key: 'evaluate', label: '评估', onClick: () => void handleEvaluate(record.id) }] : []),
        ...(hasPermission('report:alert:list') ? [{ key: 'history', label: '历史', onClick: () => setHistoryTarget(record) }] : []),
        ...(hasPermission('report:alert:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => { Modal.confirm({ title: '确定要删除吗？', content: '删除后不可恢复', onOk: () => handleDelete(record.id) }); },
        }] : []),
      ],
    }),
  ];

  const renderKeyword = () => (
    <Input prefix={<Search size={14} />} placeholder="搜索名称/备注" value={draftParams.keyword}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))} showClear style={{ width: 200 }} onEnterPress={handleSearch} />
  );
  const renderDatasetFilter = () => (
    <Select placeholder="全部数据集" value={draftParams.datasetId || undefined} onChange={(value) => setDraftParams((prev) => ({ ...prev, datasetId: value ? String(value) : '' }))}
      showClear filter style={{ width: 180 }} optionList={datasets.map((dataset) => ({ value: String(dataset.id), label: dataset.name }))} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={draftParams.enabled || undefined} onChange={(value) => setDraftParams((prev) => ({ ...prev, enabled: (value as string) ?? '' }))}
      showClear style={{ width: 120 }} optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
  );
  const renderSearchBtn = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetBtn = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateBtn = () => hasPermission('report:alert:create')
    ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;
  const renderBatchEnableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:alert:update')
    ? <Button onClick={() => handleBatchEnabled(true)}>批量启用</Button> : null;
  const renderBatchDisableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:alert:update')
    ? <Button type="danger" onClick={() => handleBatchEnabled(false)}>批量停用</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderDatasetFilter()}{renderStatusFilter()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}{renderCreateBtn()}</>}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={<>{renderDatasetFilter()}{renderStatusFilter()}</>}
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

      <AppModal title={editing ? '编辑预警' : '新增预警'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: saveMutation.isPending }} width={900}>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={initValues} labelPosition="left" labelWidth={90}
          onValueChange={(values) => {
            const nextDatasetId = values.datasetId ? Number(values.datasetId) : null;
            if (nextDatasetId !== selectedDatasetId) {
              setSelectedDatasetId(nextDatasetId);
              formApi.current?.setValue('field', undefined);
            }
            const nextAggregate = (values.aggregate ?? 'sum') as ReportAlertAggregate;
            setSelectedAggregate(nextAggregate);
            if (nextAggregate === 'count') formApi.current?.setValue('field', undefined);
            setSelectedChannels(((values.channels ?? []) as Array<'email' | 'inApp' | 'webhook'>));
          }}
        >
          <Row gutter={24}>
            <Col xs={24} md={12}>
              <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear />
            </Col>
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
                optionList={selectedFields.map((field) => ({ value: field.name, label: field.label ? `${field.label}（${field.name}）` : field.name }))} />
            </Col>
            <Col xs={24} md={12}>
              <Form.Select field="groupByField" label="分组维度" style={{ width: '100%' }} showClear
                placeholder="可选；按该字段分组聚合，任一组命中即触发"
                optionList={selectedFields.map((field) => ({ value: field.name, label: field.label ? `${field.label}（${field.name}）` : field.name }))} />
            </Col>
            <Col xs={24} md={12}>
              <Form.Select field="op" label="运算符" style={{ width: '100%' }} optionList={opOptions} />
            </Col>
            <Col xs={24} md={12}>
              <Form.InputNumber field="threshold" label="阈值" style={{ width: '100%' }} rules={[{ required: true, message: '请输入阈值' }]} />
            </Col>
            <Col xs={24} md={12}>
              <Form.Input field="cron" label="评估Cron" placeholder="0 */5 * * * *" helpText="留空=仅手动" showClear />
            </Col>
            <Col xs={24} md={12}>
              <Form.Input field="timezone" label="时区" placeholder="Asia/Shanghai" rules={[{ required: true, message: '请输入 IANA 时区' }]} showClear />
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
      </AppModal>

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
            { title: '类型', dataIndex: 'triggerType', width: 90 },
            { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'success' ? 'green' : value === 'failed' ? 'red' : value === 'partial' ? 'orange' : value === 'pending' ? 'blue' : 'grey'}>{REPORT_DELIVERY_STATUS_LABELS[value as keyof typeof REPORT_DELIVERY_STATUS_LABELS] ?? value}</Tag> },
            { title: '值', dataIndex: 'lastValue', width: 80, render: (value: number | null) => value ?? '—' },
            { title: '开始时间', dataIndex: 'startedAt', width: 170, render: (value: string | null) => value || '—' },
            { title: '完成时间', dataIndex: 'completedAt', width: 170, render: (value: string | null) => value || '—' },
            { title: '确认', dataIndex: 'acknowledgedAt', width: 200, render: (_: unknown, record: ReportDeliveryRun) => record.acknowledgedAt ? `${record.acknowledgedAt}${record.acknowledgedByName ? ` · ${record.acknowledgedByName}` : ''}` : '未确认' },
            { title: '错误', dataIndex: 'errorMessage', width: 220, render: renderEllipsis },
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
