import { useState, useRef } from 'react';
import { Button, Form, Input, Tag, Toast, Modal, SideSheet, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import { renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBatchReportSubscriptionEnabled,
  reportSubscriptionKeys,
  useDeleteReportSubscription,
  useReportSubscriptionDashboardOptions,
  useReportSubscriptionHistory,
  useReportSubscriptionList,
  useRunReportSubscription,
  useSaveReportSubscription,
} from '@/hooks/queries/report-subscriptions';
import type { ReportDashboardSubscription, ReportDeliveryRun } from '@zenith/shared';
import { NOTIFY_CHANNEL_LABELS, REPORT_DELIVERY_STATUS_LABELS, REPORT_MISFIRE_POLICY_OPTIONS, type NotifyChannel } from '@zenith/shared';
import { useDictItems } from '@/hooks/useDictItems';

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
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDashboardSubscription | null>(null);
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
  const deleteMutation = useDeleteReportSubscription();
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

  function openCreate() { setEditing(null); setCronExprValue('0 0 9 * * *'); setSelectedChannels(['inApp']); setModalVisible(true); }
  function openEdit(r: ReportDashboardSubscription) { setEditing(r); setCronExprValue(r.cron); setSelectedChannels(r.channels); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const initValues = editing
    ? {
      dashboardId: editing.dashboardId,
      cron: editing.cron,
      timezone: editing.timezone,
      misfirePolicy: editing.misfirePolicy,
      channels: editing.channels,
      recipients: editing.recipients ?? '',
      webhookUrl: editing.webhookUrl ?? '',
      enabled: editing.enabled ? 'enabled' : 'disabled',
      remark: editing.remark ?? '',
    }
    : { cron: '0 0 9 * * *', timezone: 'Asia/Shanghai', misfirePolicy: 'fire_once', channels: ['inApp'], enabled: 'enabled' };

  async function handleOk() {
    let v: Record<string, unknown>;
    try { v = await formApi.current?.validate() as Record<string, unknown>; } catch { throw new Error('validation'); }
    const channels = (v.channels ?? []) as string[];
    const payload = {
      dashboardId: v.dashboardId, cron: v.cron, timezone: v.timezone, misfirePolicy: v.misfirePolicy, channels: v.channels,
      recipients: v.recipients || undefined,
      webhookUrl: channels.includes('webhook') && v.webhookUrl ? String(v.webhookUrl) : null,
      enabled: v.enabled === 'enabled', remark: v.remark || undefined,
    };
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleRun(id: number) {
    await runMutation.mutateAsync(id);
    Toast.success('任务已提交，可在任务中心查看进度');
  }
  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  function handleBatchEnabled(enabled: boolean) {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认批量${enabled ? '启用' : '停用'}选中的 ${selectedRowKeys.length} 条订阅？`,
      onOk: async () => {
        await batchEnabledMutation.mutateAsync({ ids: selectedRowKeys, enabled });
        setSelectedRowKeys([]);
        Toast.success(enabled ? '批量启用成功' : '批量停用成功');
      },
    });
  }

  const columns: ColumnProps<ReportDashboardSubscription>[] = [
    { title: '仪表盘', dataIndex: 'dashboardName', width: 180, render: (v: string) => v || '-' },
    { title: 'Cron', dataIndex: 'cron', width: 130 },
    { title: '时区', dataIndex: 'timezone', width: 140 },
    { title: '错过策略', dataIndex: 'misfirePolicy', width: 110, render: (value: string) => REPORT_MISFIRE_POLICY_OPTIONS.find((item) => item.value === value)?.label ?? value },
    { title: '下次执行', dataIndex: 'nextRunAt', width: 170, render: (value: string | null) => value || '—' },
    { title: '通道', dataIndex: 'channels', width: 170, render: (ch: string[]) => (ch ?? []).map((c) => <Tag key={c} size="small" color={c === 'email' ? 'blue' : c === 'webhook' ? 'purple' : 'green'} style={{ marginRight: 4 }}>{NOTIFY_CHANNEL_LABELS[c.toLowerCase() as NotifyChannel] ?? c}</Tag>) },
    { title: '收件邮箱', dataIndex: 'recipients', width: 200, render: renderEllipsis },
    { title: '上次推送', dataIndex: 'lastRunAt', width: 170, render: (v: string) => v || '—' },
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
    { title: '状态', dataIndex: 'enabled', width: 70, fixed: 'right', render: (e: boolean) => e ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag> },
    createOperationColumn<ReportDashboardSubscription>({
      width: 220, desktopInlineKeys: ['run', 'history', 'edit', 'delete'],
      actions: (r) => [
        ...(hasPermission('report:subscription:update') ? [{ key: 'run', label: '立即推送', onClick: () => handleRun(r.id) }] : []),
        ...(hasPermission('report:subscription:list') ? [{ key: 'history', label: '历史', onClick: () => setHistoryTarget(r) }] : []),
        ...(hasPermission('report:subscription:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(r) }] : []),
        ...(hasPermission('report:subscription:delete') ? [{ key: 'delete', label: '删除', danger: true, onClick: () => { Modal.confirm({ title: '确定删除？', onOk: () => handleDelete(r.id) }); } }] : []),
      ],
    }),
  ];

  const renderKeyword = () => <Input prefix={<Search size={14} />} placeholder="搜索 Cron/备注" value={draftKeyword} onChange={setDraftKeyword} showClear style={{ width: 200 }} onEnterPress={handleSearch} />;
  const renderCreate = () => hasPermission('report:subscription:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;
  const renderBatchEnable = () => selectedRowKeys.length > 0 && hasPermission('report:subscription:update') ? <Button onClick={() => handleBatchEnabled(true)}>批量启用</Button> : null;
  const renderBatchDisable = () => selectedRowKeys.length > 0 && hasPermission('report:subscription:update') ? <Button type="danger" onClick={() => handleBatchEnabled(false)}>批量停用</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}<Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button><Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button></>}
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

      <AppModal title={editing ? '编辑订阅' : '新增订阅'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: saveMutation.isPending }} width={560}>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={initValues} labelPosition="left" labelWidth={110}
          onValueChange={(v: Record<string, unknown>) => {
            if (typeof v.cron === 'string') setCronExprValue(v.cron);
            if (Array.isArray(v.channels)) setSelectedChannels(v.channels as string[]);
          }}>
          <Form.Select field="dashboardId" label="仪表盘" style={{ width: '100%' }} rules={[{ required: true, message: '请选择仪表盘' }]} filter
            optionList={dashboards.map((d) => ({ value: d.id, label: d.name }))} />
          <Form.Input field="cron" label="Cron 表达式" rules={[{ required: true, message: '请输入 Cron 表达式' }]} placeholder="如 0 0 9 * * *（每天 9 点）"
            addonAfter={<CronBuilderPopover value={cronExprValue} onApply={(expr) => { formApi.current?.setValue('cron', expr); setCronExprValue(expr); }} />} />
          <Form.Input field="timezone" label="时区" placeholder="Asia/Shanghai" rules={[{ required: true, message: '请输入 IANA 时区' }]} showClear />
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
            { title: '触发方式', dataIndex: 'triggerType', width: 90 },
            { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={deliveryStatusColorMap[value] ?? 'grey'}>{REPORT_DELIVERY_STATUS_LABELS[value as keyof typeof REPORT_DELIVERY_STATUS_LABELS] ?? value}</Tag> },
            { title: '开始时间', dataIndex: 'startedAt', width: 170, render: (value: string | null) => value || '—' },
            { title: '完成时间', dataIndex: 'completedAt', width: 170, render: (value: string | null) => value || '—' },
            { title: '下次重试', dataIndex: 'nextRetryAt', width: 170, render: (value: string | null) => value || '—' },
            { title: '错误', dataIndex: 'errorMessage', width: 220, render: renderEllipsis },
          ] as ColumnProps<ReportDeliveryRun>[]}
          pagination={false}
          empty="暂无投递历史"
        />
      </SideSheet>
    </div>
  );
}
