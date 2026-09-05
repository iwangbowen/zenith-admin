import { useState } from 'react';
import { Button, Form, Tag, Toast, Modal, SideSheet, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import { FormTimezoneSelect } from '@/components/FormTimezoneSelect';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useEditModal } from '@/hooks/useEditModal';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBatchReportSubscriptionEnabled,
  reportSubscriptionKeys,
  useDeleteReportSubscriptions,
  useReportSubscriptionDashboardOptions,
  useReportSubscriptionHistory,
  useReportSubscriptionList,
  useRunReportSubscription,
  useSaveReportSubscription,
} from '@/hooks/queries/report-subscriptions';
import type { ReportDashboardSubscription, ReportDeliveryRun } from '@zenith/shared/report';
import { NOTIFY_CHANNEL_LABELS } from '@zenith/shared/messaging';
import type { NotifyChannel } from '@zenith/shared/messaging';
import { REPORT_DELIVERY_STATUS_LABELS, REPORT_DELIVERY_TRIGGER_LABELS, REPORT_MISFIRE_POLICY_OPTIONS } from '@zenith/shared/report';
import { useDictItems } from '@/hooks/useDictItems';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { DEFAULT_TIMEZONE } from '@/utils/timezones';

const deliveryStatusColorMap: Record<string, 'green' | 'red' | 'orange' | 'grey' | 'blue' | 'amber'> = {
  success: 'green',
  partial: 'orange',
  failed: 'red',
  pending: 'blue',
  running: 'amber',
  cancelled: 'grey',
};

export default function SubscriptionsPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [historyTarget, setHistoryTarget] = useState<ReportDashboardSubscription | null>(null);
  const [cronExprValue, setCronExprValue] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['inApp']);

  const listQuery = useReportSubscriptionList({ page, pageSize, keyword: submittedKeyword || undefined });
  const data = listQuery.data ?? null;
  const dashboardsQuery = useReportSubscriptionDashboardOptions();
  const dashboards = dashboardsQuery.data ?? [];
  const saveMutation = useSaveReportSubscription();
  const batchEnabledMutation = useBatchReportSubscriptionEnabled();
  const runMutation = useRunReportSubscription();
  const deleteMutation = useDeleteReportSubscriptions();
  const historyQuery = useReportSubscriptionHistory(historyTarget?.id, !!historyTarget);

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: reportSubscriptionKeys.lists });
  }

  function handleReset() {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: reportSubscriptionKeys.lists });
  }

  const subscriptionModal = useEditModal<ReportDashboardSubscription, Record<string, unknown>>({
    entityName: '订阅',
    save: saveMutation,
    defaults: { cron: '0 0 9 * * *', timezone: DEFAULT_TIMEZONE, misfirePolicy: 'fire_once', channels: ['inApp'], enabled: 'enabled' },
    labelWidth: 110,
    toValues: (editing) => ({
      dashboardId: editing.dashboardId,
      cron: editing.cron,
      timezone: editing.timezone,
      misfirePolicy: editing.misfirePolicy,
      channels: editing.channels,
      recipients: editing.recipients ?? '',
      webhookUrl: editing.webhookUrl ?? '',
      enabled: editing.enabled ? 'enabled' : 'disabled',
      remark: editing.remark ?? '',
    }),
    beforeSave: (v) => {
      const channels = (v.channels ?? []) as string[];
      return {
      dashboardId: v.dashboardId, cron: v.cron, timezone: v.timezone, misfirePolicy: v.misfirePolicy, channels: v.channels,
      recipients: v.recipients || undefined,
      webhookUrl: channels.includes('webhook') && v.webhookUrl ? String(v.webhookUrl) : null,
      enabled: v.enabled === 'enabled', remark: v.remark || undefined,
      };
    },
  });
  function openCreate() { setCronExprValue('0 0 9 * * *'); setSelectedChannels(['inApp']); subscriptionModal.openCreate(); }
  function openEdit(r: ReportDashboardSubscription) { setCronExprValue(r.cron); setSelectedChannels(r.channels); subscriptionModal.openEdit(r); }

  async function handleRun(id: number) {
    await runMutation.mutateAsync({ params: { id } });
    Toast.success('任务已提交，可在任务中心查看进度');
    // 推送任务在后台异步执行，稍后刷新列表，让「上次推送 / 最近投递」自动更新
    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: reportSubscriptionKeys.lists });
    }, 4000);
  }
  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  }

  function handleBatchEnabled(enabled: boolean) {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认批量${enabled ? '启用' : '停用'}选中的 ${selectedRowKeys.length} 条订阅？`,
      onOk: async () => {
        await batchEnabledMutation.mutateAsync({ body: { ids: selectedRowKeys, enabled } });
        setSelectedRowKeys([]);
        Toast.success(enabled ? '批量启用成功' : '批量停用成功');
      },
    });
  }

  const columns: ColumnProps<ReportDashboardSubscription>[] = [
    { title: '仪表盘', dataIndex: 'dashboardName', width: 180, render: renderEllipsis },
    { title: 'Cron', dataIndex: 'cron', width: 130, render: renderEllipsis },
    { title: '时区', dataIndex: 'timezone', width: 150, render: renderEllipsis },
    { title: '错过策略', dataIndex: 'misfirePolicy', width: 110, render: (value: string) => REPORT_MISFIRE_POLICY_OPTIONS.find((item) => item.value === value)?.label ?? value },
    dateTimeColumn('下次执行', 'nextRunAt'),
    { title: '通道', dataIndex: 'channels', width: 170, render: (ch: string[]) => (ch ?? []).map((c) => <Tag key={c} size="small" color={c === 'email' ? 'blue' : c === 'webhook' ? 'purple' : 'green'} style={{ marginRight: 4 }}>{NOTIFY_CHANNEL_LABELS[c.toLowerCase() as NotifyChannel] ?? c}</Tag>) },
    { title: '收件邮箱', dataIndex: 'recipients', minWidth: 200, render: renderEllipsis },
    dateTimeColumn('上次推送', 'lastRunAt'),
    {
      title: '最近投递',
      dataIndex: 'lastDeliveryStatus',
      width: 220,
      render: (_: unknown, record) => (
        <div>
          <Tag color={deliveryStatusColorMap[record.lastDeliveryStatus ?? 'cancelled'] ?? 'grey'} size="small">
            {record.lastDeliveryStatus ? REPORT_DELIVERY_STATUS_LABELS[record.lastDeliveryStatus] : '—'}
          </Tag>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
            {record.lastDeliveryAt || '未投递'}
          </Typography.Text>
          {record.lastDeliveryError ? <Typography.Text type="danger" size="small">{record.lastDeliveryError}</Typography.Text> : null}
        </div>
      ),
    },
    { title: '状态', dataIndex: 'enabled', width: 80, fixed: 'right', render: (e: boolean) => e ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag> },
    createOperationColumn<ReportDashboardSubscription>({
      width: 260, desktopInlineKeys: ['run', 'history', 'edit'],
      actions: (r) => [
        ...(hasPermission('report:subscription:update') ? [{ key: 'run', label: '立即推送', onClick: () => handleRun(r.id) }] : []),
        ...(hasPermission('report:subscription:list') ? [{ key: 'history', label: '历史', onClick: () => setHistoryTarget(r) }] : []),
        ...(hasPermission('report:subscription:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(r) }] : []),
        ...(hasPermission('report:subscription:delete') ? [{ key: 'delete', label: '删除', danger: true, onClick: () => { confirmDelete({ title: '确定删除？', onOk: () => handleDelete(r.id) }); } }] : []),
      ],
    }),
  ];

  const renderKeyword = () => <KeywordInput placeholder="搜索 Cron/备注" value={draftKeyword} onChange={setDraftKeyword} onSearch={handleSearch} width={200} />;
  const renderCreate = () => hasPermission('report:subscription:create') ? <CreateButton onClick={openCreate} /> : null;
  const renderBatchEnable = () => selectedRowKeys.length > 0 && hasPermission('report:subscription:update') ? <Button onClick={() => handleBatchEnabled(true)}>批量启用</Button> : null;
  const renderBatchDisable = () => selectedRowKeys.length > 0 && hasPermission('report:subscription:update') ? <Button type="danger" onClick={() => handleBatchEnabled(false)}>批量停用</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}<SearchButton onClick={handleSearch} /><ResetButton onClick={handleReset} /></>}
        actions={<>{renderBatchEnable()}{renderBatchDisable()}{renderCreate()}</>}
        mobilePrimary={<>{renderKeyword()}{renderCreate()}</>}
        mobileActions={<>{renderBatchEnable()}{renderBatchDisable()}</>}
      />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无订阅"
        rowSelection={hasPermission('report:subscription:update') ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        } : undefined}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)} />

      <AppModal {...subscriptionModal.modalProps} width={560}>
        <Form key={subscriptionModal.formKey} {...subscriptionModal.formProps}
          onValueChange={(v: Record<string, unknown>) => {
            if (typeof v.cron === 'string') setCronExprValue(v.cron);
            if (Array.isArray(v.channels)) setSelectedChannels(v.channels as string[]);
          }}>
          <Form.Select field="dashboardId" label="仪表盘" style={{ width: '100%' }} rules={[{ required: true, message: '请选择仪表盘' }]} filter
            extraText="定时推送在无用户上下文执行：使用数据权限变量（${__userId} 等）、必填参数或行级权限数据集的仪表盘无法订阅"
            optionList={dashboards.map((d) => ({ value: d.id, label: d.name }))} />
          <Form.Input field="cron" label="Cron 表达式" rules={[{ required: true, message: '请输入 Cron 表达式' }]} placeholder="如 0 0 9 * * *（每天 9 点）"
            addonAfter={<CronBuilderPopover value={cronExprValue} onApply={(expr) => { subscriptionModal.formApi.current?.setValue('cron', expr); setCronExprValue(expr); }} />} />
          <FormTimezoneSelect />
          <Form.Select field="misfirePolicy" label="错过策略" style={{ width: '100%' }} optionList={REPORT_MISFIRE_POLICY_OPTIONS} />
          <Form.Select field="channels" label="推送通道" multiple style={{ width: '100%' }} rules={[{ required: true, message: '至少一个通道' }]}
            optionList={[{ value: 'inApp', label: '站内信（推给创建者）' }, { value: 'email', label: '邮件' }, { value: 'webhook', label: 'Webhook（企微/钉钉机器人）' }]} />
          {selectedChannels.includes('email') && (
            <Form.Input field="recipients" label="收件邮箱" placeholder="多个用逗号分隔（仅邮件通道）" />
          )}
          {selectedChannels.includes('webhook') && (
            <Form.Input field="webhookUrl" label="Webhook 地址" placeholder="企微/钉钉机器人 Webhook URL 或通用 JSON 端点"
              rules={[{ required: true, message: '请填写 Webhook 地址' }]} showClear />
          )}
          <Form.Select field="enabled" label="状态" style={{ width: '100%' }} optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
        </Form>
      </AppModal>

      <SideSheet
        title={historyTarget ? `订阅历史 · ${historyTarget.dashboardName}` : '订阅历史'}
        visible={!!historyTarget}
        width={900}
        onCancel={() => setHistoryTarget(null)}
        closeOnEsc
        placement="right"
      >
        <ConfigurableTable
          bordered
          rowKey="id"
          size="small"
          loading={historyQuery.isFetching}
          dataSource={historyQuery.data?.list ?? []}
          columns={[
            { title: '触发方式', dataIndex: 'triggerType', width: 90, render: (value: string) => REPORT_DELIVERY_TRIGGER_LABELS[value as keyof typeof REPORT_DELIVERY_TRIGGER_LABELS] ?? value },
            { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag color={deliveryStatusColorMap[value] ?? 'grey'}>{REPORT_DELIVERY_STATUS_LABELS[value as keyof typeof REPORT_DELIVERY_STATUS_LABELS] ?? value}</Tag> },
            dateTimeColumn('开始时间', 'startedAt'),
            dateTimeColumn('完成时间', 'completedAt'),
            dateTimeColumn('下次重试', 'nextRetryAt'),
            { title: '错误', dataIndex: 'errorMessage', width: 220, render: renderEllipsis },
          ] as ColumnProps<ReportDeliveryRun>[]}
          pagination={false}
          empty="暂无投递历史"
        />
      </SideSheet>
    </div>
  );
}
