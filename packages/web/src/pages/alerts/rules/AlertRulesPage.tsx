import { useNavigate } from 'react-router-dom';
import { Form, Toast, Tag, Row, Col, Select, withField } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { batchStatusHandler, confirmAndDelete, ListSearchToolbar, useStatusToggle, useRowSelection, useCrudOperationColumn } from '@/components/list-page';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { monitorAlertContract, type CreateMonitorAlertRuleInput, type MonitorAlertRule, type MonitorMetric } from '@zenith/shared/platform';
import { MONITOR_ALERT_LEVEL_OPTIONS } from '@zenith/shared/platform';
import { BASIC_COMPARISON_OPERATOR_LABELS } from '@zenith/shared/core';
import { NOTIFY_CHANNEL_OPTIONS } from '@zenith/shared/messaging';
import {
  useBatchToggleMonitorAlerts,
  useDeleteMonitorAlerts,
  useMonitorAlertList,
  useSaveMonitorAlert,
  useTestMonitorAlert,
  useToggleMonitorAlert,
} from '@/hooks/queries/monitor-alerts';
import {
  MONITOR_METRIC_GROUPED_OPTIONS as METRIC_GROUPS,
  MONITOR_METRIC_LABELS as METRIC_LABELS,
  MONITOR_METRIC_META as METRIC_META,
  formatMonitorMetricValue,
} from './constants';
import { BatchDeleteButton, BatchStatusButtons, CreateButton } from '@/components/toolbar-controls';
import { dateTimeColumn, EMPTY_PLACEHOLDER, overflowTagColumn } from '@/utils/table-columns';
import AlertRecipientUserSelect from './AlertRecipientUserSelect';
import {
  MonitorAlertLevelTag,
  MONITOR_CHANNEL_LABELS,
  MonitorAlertStateTag,
  MonitorMetricFilterSelect,
  MONITOR_OPERATOR_SYMBOLS,
} from '../monitor-alert-display';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

const OP_OPTIONS = (['gt', 'gte', 'lt', 'lte'] as const)
  .map((value) => ({ value, label: BASIC_COMPARISON_OPERATOR_LABELS[value] }));
const FormAlertRecipientUserSelect = withField(AlertRecipientUserSelect);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 阈值输入提示随指标单位变化：百分比与吞吐的量级差了 7 个数量级，统一文案必然误导 */
function thresholdHint(metric: MonitorMetric | undefined): string {
  switch (metric ? METRIC_META[metric]?.unit : undefined) {
    case 'percent': return '填 0-100 的百分比数值';
    case 'bps': return '填字节/秒，如 10485760 = 10 MB/s';
    case 'ms': return '填毫秒数';
    case 'count': return '填条目数量';
    case 'score': return '填 0-100 的评分（通常搭配 < 使用）';
    default: return '填数值阈值';
  }
}

export default function AlertRulesPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();

  const canCreate = hasPermission('alert:rule:create');
  const canUpdate = hasPermission('alert:rule:update');
  const canDelete = hasPermission('alert:rule:delete');
  const page = useListPage({
    contract: monitorAlertContract,
    onSearch: clearSelection,
    onReset: clearSelection,
    useList: useMonitorAlertList,
    table: { rowSelection: canUpdate || canDelete ? rowSelection : undefined },
  });
  const { tableProps } = page;
  const canTest = hasPermission('alert:rule:test');
  const canViewEvents = hasPermission('alert:event:list');
  const saveMutation = useSaveMonitorAlert();
  const alertModal = useEditModal<MonitorAlertRule, Record<string, unknown>, Partial<CreateMonitorAlertRuleInput>>({
    entityName: '告警规则',
    save: saveMutation,
    defaults: { operator: 'gt', level: 'warning', channels: ['inapp'], durationMinutes: 0, silenceMinutes: 30, enabled: true, recipientUserIds: [], recipientEmails: [] },
    toValues: (rule) => ({
      name: rule.name,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      durationMinutes: rule.durationMinutes,
      level: rule.level,
      channels: rule.channels,
      webhookUrl: rule.webhookUrl ?? '',
      recipientUserIds: rule.recipientUserIds,
      recipientEmails: rule.recipientEmails,
      silenceMinutes: rule.silenceMinutes,
      enabled: rule.enabled,
    }),
    beforeSave: (values) => {
      const channels = Array.isArray(values.channels) ? values.channels as string[] : [];
      const usesUsers = channels.includes('inapp') || channels.includes('email');
      return {
        ...values,
        webhookUrl: channels.includes('webhook') ? (values.webhookUrl as string) || null : null,
        recipientUserIds: usesUsers && Array.isArray(values.recipientUserIds) ? values.recipientUserIds : [],
        recipientEmails: channels.includes('email') && Array.isArray(values.recipientEmails)
          ? values.recipientEmails.map((email) => String(email).trim().toLowerCase()).filter(Boolean)
          : [],
      } as Partial<CreateMonitorAlertRuleInput>;
    },
  });
  const deleteMutation = useDeleteMonitorAlerts();
  const toggleMutation = useToggleMonitorAlert();
  const batchToggleMutation = useBatchToggleMonitorAlerts();
  const testMutation = useTestMonitorAlert();
  const enabledStatus = useStatusToggle<MonitorAlertRule>({
    toggle: (record, enabled) => toggleMutation.mutateAsync({ params: { id: record.id }, body: { enabled } }),
    isEnabled: (record) => record.enabled,
    disabled: !canUpdate,
  });

  /**
   * 试发通知：按真实派发结果分级提示。
   * 统一报「已发送」会把「渠道配错、根本没送出去」也说成成功，等于没验证。
   */
  async function handleTest(record: MonitorAlertRule) {
    const result = await testMutation.mutateAsync({ params: { id: record.id } });
    const channels = result.channels.map((c) => MONITOR_CHANNEL_LABELS[c] ?? c).join('、');
    if (result.status === 'skipped') {
      Toast.warning({ content: `「${record.name}」未配置任何通知渠道，没有可试发的目标`, duration: 5 });
      return;
    }
    if (result.status === 'success') {
      Toast.success({ content: `测试通知已发送：${channels}，请到对应渠道确认是否收到`, duration: 5 });
      return;
    }
    Toast.error({
      content: `${result.status === 'failed' ? '全部渠道发送失败' : '部分渠道发送失败'}：${result.error ?? '未知原因'}`,
      duration: 8,
    });
  }

  function handleBatchDelete() {
    confirmAndDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 条告警规则？`,
      content: '删除后不可恢复，规则关联的历史告警事件会保留。',
      run: () => deleteMutation.mutateAsync(selectedRowKeys),
      successMessage: '批量删除成功',
      onDeleted: clearSelection,
    });
  }

  // 停用会让规则退出评估并关闭其未恢复的告警，需要确认（非破坏性，普通样式）
  const handleBatchStatus = batchStatusHandler({
    selectedRowKeys,
    clearSelection,
    run: (ids, status) => batchToggleMutation.mutateAsync({ body: { ids, enabled: status === 'enabled' } }),
    entity: '条规则',
    confirmContent: (_status, count) => `停用后选中的 ${count} 条规则将不再参与评估，其未恢复的告警会被关闭。`,
    successMessage: (status) => (status === 'enabled' ? '已批量启用' : '已批量停用'),
  });

  const operationColumn = useCrudOperationColumn<MonitorAlertRule>({
    edit: alertModal,
    remove: deleteMutation,
    allow: { edit: canUpdate, remove: canDelete },
    label: (record) => record.name,
    content: '删除后不可恢复',
    extraBetween: (record) => [
      {
        key: 'test',
        label: '试发通知',
        hidden: !canTest,
        onClick: () => void handleTest(record),
      },
      {
        key: 'events',
        label: '查看事件',
        hidden: !canViewEvents,
        onClick: () => navigate(`/alerts/events?ruleId=${record.id}`),
      },
    ],
    width: 180,
    desktopInlineKeys: ['edit', 'delete'],
  });

  const columns: ColumnProps<MonitorAlertRule>[] = [
    { title: '规则名称', dataIndex: 'name', width: 180, fixed: 'left' },
    {
      title: '触发条件',
      dataIndex: 'metric',
      minWidth: 320,
      render: (_: unknown, r: MonitorAlertRule) => (
        <span>
          <Tag size="small" type="ghost">{METRIC_LABELS[r.metric] ?? r.metric}</Tag>
          {' '}{MONITOR_OPERATOR_SYMBOLS[r.operator] ?? r.operator}{' '}
          <b>{formatMonitorMetricValue(r.metric, r.threshold)}</b>
          {r.durationMinutes > 0 ? <span style={{ color: 'var(--semi-color-text-2)' }}> · 持续{r.durationMinutes}分</span> : null}
        </span>
      ),
    },
    {
      title: '级别', dataIndex: 'level', width: 80,
      render: (v: string) => <MonitorAlertLevelTag level={v} />,
    },
    overflowTagColumn<MonitorAlertRule>({
      title: '通知渠道',
      dataIndex: 'channels',
      width: 160,
      contentWidth: 128,
      getItems: (chs) => ((chs as string[] | undefined) ?? []).map((c) => ({
        key: c,
        label: MONITOR_CHANNEL_LABELS[c] ?? c,
      })),
      tagSize: 'small',
      popoverWidth: 200,
    }),
    {
      title: '当前值', dataIndex: 'lastValue', width: 100,
      render: (v: number | null, r: MonitorAlertRule) => v === null ? EMPTY_PLACEHOLDER : formatMonitorMetricValue(r.metric, v),
    },
    dateTimeColumn('最近触发', 'lastTriggeredAt', { empty: '从未' }),
    {
      title: '告警状态', dataIndex: 'state', width: 100, fixed: 'right',
      render: (state: string) => <MonitorAlertStateTag state={state} okText="未触发" />,
    },
    enabledStatus.column({ title: '启用状态', width: 100, dataIndex: 'enabled' }),
    operationColumn,
  ];

  const renderBatchActions = () => selectedRowKeys.length > 0 ? (
    <>
      {canUpdate && (
        <BatchStatusButtons count={selectedRowKeys.length} onChange={handleBatchStatus} loading={batchToggleMutation.isPending} />
      )}
      {canDelete && (
        <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />
      )}
    </>
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'metric', 'level', 'state', 'enabled']}
        overrides={{
          metric: (p) => (
            <MonitorMetricFilterSelect value={p.bind('metric').value} onChange={(v) => p.bind('metric').onChange(v as MonitorMetric | undefined)} />
          ),
        }}
        create={canCreate ? <CreateButton onClick={alertModal.openCreate}>新增规则</CreateButton> : null}
        actions={renderBatchActions()}
        filterTitle="告警规则筛选"
        actionTitle="告警规则操作"
      />

      <ConfigurableTable<MonitorAlertRule>
        columns={columns}
        empty="暂无告警规则"
        {...tableProps}
      />

      <EditFormModal modal={alertModal} width={660}>
        {({ values }) => {
          const selectedMetric = values.metric as MonitorMetric | undefined;
          const selectedChannels = Array.isArray(values.channels) ? values.channels as string[] : [];
          const usesUserRecipients = selectedChannels.includes('inapp') || selectedChannels.includes('email');
          return (
            <>
              <Form.Input field="name" label="规则名称" placeholder="如：CPU 使用率过高" rules={[{ required: true, message: '请输入规则名称' }]} />
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Select
                    field="metric"
                    label="监控指标"
                    style={{ width: '100%' }}
                    filter
                    extraText={selectedMetric ? METRIC_META[selectedMetric]?.description : undefined}
                    rules={[{ required: true, message: '请选择指标' }]}
                  >
                    {METRIC_GROUPS.map((group) => (
                      <Select.OptGroup key={group.group} label={group.label}>
                        {group.children.map((option) => (
                          <Select.Option key={option.value} value={option.value}>{option.label}</Select.Option>
                        ))}
                      </Select.OptGroup>
                    ))}
                  </Form.Select>
                </Col>
                <Col span={12}>
                  <Form.Select field="operator" label="比较符" style={{ width: '100%' }} optionList={OP_OPTIONS} rules={[{ required: true }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.InputNumber field="threshold" label="阈值" style={{ width: '100%' }} placeholder={thresholdHint(selectedMetric)} rules={[{ required: true, message: '请输入阈值' }]} />
                </Col>
                <Col span={12}>
                  <Form.InputNumber field="durationMinutes" label="持续达标" min={0} max={1440} suffix="分钟" style={{ width: '100%' }} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Select field="level" label="告警级别" style={{ width: '100%' }} optionList={MONITOR_ALERT_LEVEL_OPTIONS} />
                </Col>
                <Col span={12}>
                  <Form.InputNumber field="silenceMinutes" label="静默期" min={0} max={10080} suffix="分钟" style={{ width: '100%' }} />
                </Col>
              </Row>
              <Form.Select field="channels" label="通知渠道" multiple style={{ width: '100%' }} optionList={NOTIFY_CHANNEL_OPTIONS} />
              {usesUserRecipients && (
                <FormAlertRecipientUserSelect
                  field="recipientUserIds"
                  label="接收用户"
                  extraText="站内信直接发送给所选用户；邮件渠道同时使用用户账号当前邮箱，无邮箱用户仅接收站内信"
                />
              )}
              {selectedChannels.includes('email') && (
                <Form.TagInput
                  field="recipientEmails"
                  label="额外邮箱"
                  placeholder="输入群组邮箱或外部联系邮箱后回车"
                  extraText="仅用于邮件渠道，不绑定系统用户；会与所选用户的账号邮箱自动去重"
                  rules={[{
                    validator: (_rule: unknown, value: unknown) =>
                      !Array.isArray(value) || value.every((email) => EMAIL_PATTERN.test(String(email))),
                    message: '请输入有效的邮箱地址',
                  }]}
                  style={{ width: '100%' }}
                />
              )}
              {selectedChannels.includes('webhook') && (
                <Form.Input field="webhookUrl" label="Webhook" placeholder="https://example.com/webhook" />
              )}
              <Form.Switch field="enabled" label="启用" />
            </>
          );
        }}
      </EditFormModal>
    </div>
  );
}
