import { useState, useRef } from 'react';
import { Button, Form, Input, Tag, Toast, Modal } from '@douyinfe/semi-ui';
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
  reportSubscriptionKeys,
  useDeleteReportSubscription,
  useReportSubscriptionDashboardOptions,
  useReportSubscriptionList,
  useRunReportSubscription,
  useSaveReportSubscription,
} from '@/hooks/queries/report-subscriptions';
import type { ReportDashboardSubscription } from '@zenith/shared';
import { NOTIFY_CHANNEL_LABELS, type NotifyChannel } from '@zenith/shared';

export default function SubscriptionsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDashboardSubscription | null>(null);
  const [cronExprValue, setCronExprValue] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['inApp']);

  const listQuery = useReportSubscriptionList({ page, pageSize, keyword: submittedKeyword || undefined });
  const data = listQuery.data ?? null;
  const dashboardsQuery = useReportSubscriptionDashboardOptions();
  const dashboards = dashboardsQuery.data ?? [];
  const saveMutation = useSaveReportSubscription();
  const runMutation = useRunReportSubscription();
  const deleteMutation = useDeleteReportSubscription();

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
    ? { dashboardId: editing.dashboardId, cron: editing.cron, channels: editing.channels, recipients: editing.recipients ?? '', webhookUrl: editing.webhookUrl ?? '', enabled: editing.enabled ? 'enabled' : 'disabled', remark: editing.remark ?? '' }
    : { cron: '0 0 9 * * *', channels: ['inApp'], enabled: 'enabled' };

  async function handleOk() {
    let v: Record<string, unknown>;
    try { v = await formApi.current?.validate() as Record<string, unknown>; } catch { throw new Error('validation'); }
    const channels = (v.channels ?? []) as string[];
    const payload = {
      dashboardId: v.dashboardId, cron: v.cron, channels: v.channels,
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
    Toast.success('已推送');
  }
  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  const columns: ColumnProps<ReportDashboardSubscription>[] = [
    { title: '仪表盘', dataIndex: 'dashboardName', width: 180, render: (v: string) => v || '-' },
    { title: 'Cron', dataIndex: 'cron', width: 130 },
    { title: '通道', dataIndex: 'channels', width: 170, render: (ch: string[]) => (ch ?? []).map((c) => <Tag key={c} size="small" color={c === 'email' ? 'blue' : c === 'webhook' ? 'purple' : 'green'} style={{ marginRight: 4 }}>{NOTIFY_CHANNEL_LABELS[c.toLowerCase() as NotifyChannel] ?? c}</Tag>) },
    { title: '收件邮箱', dataIndex: 'recipients', width: 200, render: renderEllipsis },
    { title: '上次推送', dataIndex: 'lastRunAt', width: 170, render: (v: string) => v || '—' },
    { title: '状态', dataIndex: 'enabled', width: 70, fixed: 'right', render: (e: boolean) => e ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag> },
    createOperationColumn<ReportDashboardSubscription>({
      width: 180, desktopInlineKeys: ['run', 'edit', 'delete'],
      actions: (r) => [
        ...(hasPermission('report:subscription:update') ? [{ key: 'run', label: '立即推送', onClick: () => handleRun(r.id) }] : []),
        ...(hasPermission('report:subscription:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(r) }] : []),
        ...(hasPermission('report:subscription:delete') ? [{ key: 'delete', label: '删除', danger: true, onClick: () => { Modal.confirm({ title: '确定删除？', onOk: () => handleDelete(r.id) }); } }] : []),
      ],
    }),
  ];

  const renderKeyword = () => <Input prefix={<Search size={14} />} placeholder="搜索 Cron/备注" value={draftKeyword} onChange={setDraftKeyword} showClear style={{ width: 200 }} onEnterPress={handleSearch} />;
  const renderCreate = () => hasPermission('report:subscription:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}<Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button><Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button></>}
        actions={renderCreate()}
        mobilePrimary={<>{renderKeyword()}{renderCreate()}</>}
      />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无订阅"
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
          <Form.Select field="channels" label="推送通道" multiple style={{ width: '100%' }} rules={[{ required: true, message: '至少一个通道' }]}
            optionList={[{ value: 'inApp', label: '站内信（推给创建者）' }, { value: 'email', label: '邮件' }, { value: 'webhook', label: 'Webhook（企微/钉钉机器人）' }]} />
          {selectedChannels.includes('email') && (
            <Form.Input field="recipients" label="收件邮箱" placeholder="多个用逗号分隔（仅邮件通道）" />
          )}
          {selectedChannels.includes('webhook') && (
            <Form.Input field="webhookUrl" label="Webhook 地址" placeholder="企微/钉钉机器人 Webhook URL 或通用 JSON 端点"
              rules={[{ required: true, message: '请填写 Webhook 地址' }]} showClear />
          )}
          <Form.Select field="enabled" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
        </Form>
      </AppModal>
    </div>
  );
}
