import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Space, Spin, Toast, Modal, Switch, Tag, Row, Col, Select, withField } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import type { CreateMonitorAlertRuleInput, MonitorAlertRule, MonitorMetric } from '@zenith/shared/platform';
import { MONITOR_ALERT_LEVELS, MONITOR_ALERT_LEVEL_OPTIONS, MONITOR_ALERT_STATES, MONITOR_METRICS } from '@zenith/shared/platform';
import { BASIC_COMPARISON_OPERATOR_LABELS, enumValueOf } from '@zenith/shared/core';
import { NOTIFY_CHANNEL_LABELS, NOTIFY_CHANNEL_OPTIONS } from '@zenith/shared/messaging';
import {
  monitorAlertKeys,
  useBatchToggleMonitorAlerts,
  useDeleteMonitorAlerts,
  useMonitorAlertList,
  useSaveMonitorAlert,
  useTestMonitorAlert,
  useToggleMonitorAlert,
} from '@/hooks/queries/monitor-alerts';
import {
  MONITOR_ALERT_LEVEL_CONFIG as LEVEL_CONFIG,
  MONITOR_METRIC_GROUPED_OPTIONS as METRIC_GROUPS,
  MONITOR_METRIC_LABELS as METRIC_LABELS,
  MONITOR_METRIC_META as METRIC_META,
  formatMonitorMetricValue,
} from './constants';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn } from '@/utils/table-columns';
import AlertRecipientUserSelect from './AlertRecipientUserSelect';

const OP_SYMBOL: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
const OP_OPTIONS = (['gt', 'gte', 'lt', 'lte'] as const)
  .map((value) => ({ value, label: BASIC_COMPARISON_OPERATOR_LABELS[value] }));
const CHANNEL_LABELS: Record<string, string> = NOTIFY_CHANNEL_LABELS;
const FormAlertRecipientUserSelect = withField(AlertRecipientUserSelect);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ENABLED_OPTIONS = [{ value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }];
const STATE_OPTIONS = [{ value: 'firing', label: '告警中' }, { value: 'ok', label: '未触发' }];

interface SearchParams {
  keyword: string;
  metric?: string;
  level?: string;
  enabled?: string;
  state?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', metric: undefined, level: undefined, enabled: undefined, state: undefined };

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

/** 指标筛选下拉：指标接近 30 个，按业务域分组并支持搜索 */
const METRIC_FILTER_GROUPS = METRIC_GROUPS.map((group) => ({ label: group.label, items: group.children }));

function MetricFilterSelect({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  return <FilterSelect placeholder="全部指标" groups={METRIC_FILTER_GROUPS} value={value} onChange={onChange} width={170} filter />;
}

export default function AlertRulesPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({
    defaults: defaultSearchParams,
    listKey: monitorAlertKeys.lists,
    onSearch: () => setSelectedRowKeys([]),
    onReset: () => setSelectedRowKeys([]),
  });

  // 筛选条件全部下推服务端：此前在当前页做 filter，翻到第 2 页就搜不到第 1 页的规则，
  // 且分页总数仍是未过滤的值，列表与页码对不上
  const listQuery = useMonitorAlertList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    metric: enumValueOf(MONITOR_METRICS, submittedParams.metric),
    level: enumValueOf(MONITOR_ALERT_LEVELS, submittedParams.level),
    enabled: submittedParams.enabled === undefined ? undefined : submittedParams.enabled === 'true',
    state: enumValueOf(MONITOR_ALERT_STATES, submittedParams.state),
  });
  const data = listQuery.data ?? null;

  const canCreate = hasPermission('alert:rule:create');
  const canUpdate = hasPermission('alert:rule:update');
  const canDelete = hasPermission('alert:rule:delete');
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
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.params.id ?? null) : null;

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  }

  /**
   * 试发通知：按真实派发结果分级提示。
   * 统一报「已发送」会把「渠道配错、根本没送出去」也说成成功，等于没验证。
   */
  async function handleTest(record: MonitorAlertRule) {
    const result = await testMutation.mutateAsync({ params: { id: record.id } });
    const channels = result.channels.map((c) => CHANNEL_LABELS[c] ?? c).join('、');
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

  function handleToggle(record: MonitorAlertRule, checked: boolean) {
    toggleMutation.mutate(
      { params: { id: record.id }, body: { enabled: checked } },
      { onSuccess: () => Toast.success(checked ? '已启用' : '已停用') },
    );
  }

  function handleBatchDelete() {
    confirmDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 条告警规则？`,
      content: '删除后不可恢复，规则关联的历史告警事件会保留。',
      onOk: async () => {
        await deleteMutation.mutateAsync(selectedRowKeys);
        Toast.success('批量删除成功');
        setSelectedRowKeys([]);
      },
    });
  }

  function handleBatchToggle(enabled: boolean) {
    const doToggle = async () => {
      await batchToggleMutation.mutateAsync({ body: { ids: selectedRowKeys, enabled } });
      Toast.success(enabled ? '已批量启用' : '已批量停用');
      setSelectedRowKeys([]);
    };
    // 停用是非破坏性确认，用原生 Modal.confirm
    if (enabled) void doToggle();
    else Modal.confirm({
      title: '确认批量停用',
      content: `停用后选中的 ${selectedRowKeys.length} 条规则将不再参与评估，其未恢复的告警会被关闭。`,
      onOk: doToggle,
    });
  }

  const columns: ColumnProps<MonitorAlertRule>[] = [
    { title: '规则名称', dataIndex: 'name', width: 180, fixed: 'left' },
    {
      title: '触发条件',
      dataIndex: 'metric',
      minWidth: 320,
      render: (_: unknown, r: MonitorAlertRule) => (
        <span>
          <Tag size="small" type="ghost">{METRIC_LABELS[r.metric] ?? r.metric}</Tag>
          {' '}{OP_SYMBOL[r.operator] ?? r.operator}{' '}
          <b>{formatMonitorMetricValue(r.metric, r.threshold)}</b>
          {r.durationMinutes > 0 ? <span style={{ color: 'var(--semi-color-text-2)' }}> · 持续{r.durationMinutes}分</span> : null}
        </span>
      ),
    },
    {
      title: '级别', dataIndex: 'level', width: 80,
      render: (v: string) => <Tag color={LEVEL_CONFIG[v]?.color ?? 'grey'} size="small">{LEVEL_CONFIG[v]?.label ?? v}</Tag>,
    },
    {
      title: '通知渠道', dataIndex: 'channels', width: 160,
      render: (chs: string[]) => chs?.length ? <Space spacing={4} wrap>{chs.map((c) => <Tag key={c} size="small" type="light">{CHANNEL_LABELS[c] ?? c}</Tag>)}</Space> : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    {
      title: '当前值', dataIndex: 'lastValue', width: 100,
      render: (v: number | null, r: MonitorAlertRule) => v === null ? '—' : formatMonitorMetricValue(r.metric, v),
    },
    dateTimeColumn('最近触发', 'lastTriggeredAt', { empty: '从未' }),
    {
      title: '告警状态', dataIndex: 'state', width: 100, fixed: 'right',
      render: (state: string) => state === 'firing'
        ? <Tag color="red" size="small">告警中</Tag>
        : <Tag color="green" size="small">未触发</Tag>,
    },
    {
      title: '启用状态', dataIndex: 'enabled', width: 100, fixed: 'right',
      render: (enabled: boolean, r: MonitorAlertRule) => (
        <Switch
          checked={enabled}
          loading={togglingId === r.id}
          disabled={!canUpdate}
          onChange={(checked) => handleToggle(r, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<MonitorAlertRule>({
      width: 180,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !canUpdate,
          onClick: () => alertModal.openEdit(record),
        },
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
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canDelete,
          onClick: () => {
            confirmDelete({
              title: `确定要删除「${record.name}」吗？`,
              content: '删除后不可恢复',
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索规则名称..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  const renderMetricFilter = () => (
    <MetricFilterSelect
      value={draftParams.metric}
      onChange={(v) => setDraftParams((p) => ({ ...p, metric: v }))}
    />
  );

  const renderLevelFilter = () => (
    <FilterSelect
      placeholder="全部级别"
      items={MONITOR_ALERT_LEVEL_OPTIONS}
      value={draftParams.level}
      onChange={(v) => setDraftParams((p) => ({ ...p, level: v }))}
    />
  );

  const renderStateFilter = () => (
    <FilterSelect
      placeholder="全部告警状态"
      items={STATE_OPTIONS}
      value={draftParams.state}
      onChange={(v) => setDraftParams((p) => ({ ...p, state: v }))}
      width={140}
    />
  );

  const renderEnabledFilter = () => (
    <FilterSelect
      placeholder="全部启用状态"
      items={ENABLED_OPTIONS}
      value={draftParams.enabled}
      onChange={(v) => setDraftParams((p) => ({ ...p, enabled: v }))}
      width={140}
    />
  );

  const renderBatchActions = () => selectedRowKeys.length > 0 ? (
    <>
      {canUpdate && (
        <>
          <Button theme="light" onClick={() => handleBatchToggle(true)} loading={batchToggleMutation.isPending}>
            批量启用 ({selectedRowKeys.length})
          </Button>
          <Button theme="light" onClick={() => handleBatchToggle(false)} loading={batchToggleMutation.isPending}>
            批量停用 ({selectedRowKeys.length})
          </Button>
        </>
      )}
      {canDelete && (
        <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
          批量删除 ({selectedRowKeys.length})
        </Button>
      )}
    </>
  ) : null;

  const renderCreateButton = () => canCreate ? <CreateButton onClick={alertModal.openCreate}>新增规则</CreateButton> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderMetricFilter()}
            {renderLevelFilter()}
            {renderStateFilter()}
            {renderEnabledFilter()}
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {renderBatchActions()}
          </>
        )}
        actions={renderCreateButton()}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            <SearchButton onClick={handleSearch} />
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderMetricFilter()}
            {renderLevelFilter()}
            {renderStateFilter()}
            {renderEnabledFilter()}
          </>
        )}
        mobileActions={renderBatchActions()}
        filterTitle="告警规则筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
        actionTitle="告警规则操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无告警规则"
        rowSelection={canUpdate || canDelete
          ? { selectedRowKeys, onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]) }
          : undefined}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        {...alertModal.modalProps}
        width={660}
      >
        <Spin spinning={alertModal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={alertModal.formKey} {...alertModal.formProps}>
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
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
