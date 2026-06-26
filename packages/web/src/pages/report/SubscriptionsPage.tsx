import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Input, Tag, Toast, Modal } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import type { ReportDashboardSubscription, ReportDashboard, PaginatedResponse } from '@zenith/shared';

export default function SubscriptionsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<PaginatedResponse<ReportDashboardSubscription> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [keyword, setKeyword] = useState('');
  const keywordRef = useRef('');
  keywordRef.current = keyword;
  const [dashboards, setDashboards] = useState<ReportDashboard[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDashboardSubscription | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchList = useCallback(async (p = page, ps = pageSize, kw?: string) => {
    const k = kw ?? keywordRef.current;
    setLoading(true);
    try {
      const q: Record<string, string> = { page: String(p), pageSize: String(ps) };
      if (k) q.keyword = k;
      const res = await request.get<PaginatedResponse<ReportDashboardSubscription>>(`/api/report/subscriptions?${new URLSearchParams(q)}`);
      if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
    request.get<PaginatedResponse<ReportDashboard>>('/api/report/dashboards?page=1&pageSize=200').then((res) => { if (res.code === 0) setDashboards(res.data.list); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(r: ReportDashboardSubscription) { setEditing(r); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const initValues = editing
    ? { dashboardId: editing.dashboardId, cron: editing.cron, channels: editing.channels, recipients: editing.recipients ?? '', enabled: editing.enabled ? 'enabled' : 'disabled', remark: editing.remark ?? '' }
    : { cron: '0 9 * * *', channels: ['inApp'], enabled: 'enabled' };

  async function handleOk() {
    let v: Record<string, unknown>;
    try { v = await formApi.current?.validate() as Record<string, unknown>; } catch { throw new Error('validation'); }
    const payload = { dashboardId: v.dashboardId, cron: v.cron, channels: v.channels, recipients: v.recipients || undefined, enabled: v.enabled === 'enabled', remark: v.remark || undefined };
    setSubmitting(true);
    try {
      const res = editing ? await request.put(`/api/report/subscriptions/${editing.id}`, payload) : await request.post('/api/report/subscriptions', payload);
      if (res.code === 0) { Toast.success(editing ? '更新成功' : '创建成功'); closeModal(); void fetchList(); } else throw new Error(res.message);
    } finally { setSubmitting(false); }
  }

  async function handleRun(id: number) {
    const res = await request.post(`/api/report/subscriptions/${id}/run`);
    if (res.code === 0) { Toast.success('已推送'); void fetchList(); }
  }
  async function handleDelete(id: number) {
    const res = await request.delete(`/api/report/subscriptions/${id}`);
    if (res.code === 0) { Toast.success('删除成功'); void fetchList(); }
  }

  const columns: ColumnProps<ReportDashboardSubscription>[] = [
    { title: '仪表盘', dataIndex: 'dashboardName', width: 180, render: (v: string) => v || '-' },
    { title: 'Cron', dataIndex: 'cron', width: 130 },
    { title: '通道', dataIndex: 'channels', width: 140, render: (ch: string[]) => (ch ?? []).map((c) => <Tag key={c} size="small" color={c === 'email' ? 'blue' : 'green'} style={{ marginRight: 4 }}>{c === 'email' ? '邮件' : '站内信'}</Tag>) },
    { title: '收件邮箱', dataIndex: 'recipients', width: 200, render: (v: string) => v || '-' },
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

  const renderKeyword = () => <Input prefix={<Search size={14} />} placeholder="搜索 Cron/备注" value={keyword} onChange={setKeyword} showClear style={{ width: 200 }} onEnterPress={() => { setPage(1); void fetchList(1, pageSize); }} />;
  const renderCreate = () => hasPermission('report:subscription:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}<Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); void fetchList(1, pageSize); }}>查询</Button><Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setKeyword(''); setPage(1); void fetchList(1, pageSize, ''); }}>重置</Button></>}
        actions={renderCreate()}
        mobilePrimary={<>{renderKeyword()}{renderCreate()}</>}
      />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无订阅"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)} />

      <AppModal title={editing ? '编辑订阅' : '新增订阅'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: submitting }} width={560}>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={initValues} labelPosition="left" labelWidth={90}>
          <Form.Select field="dashboardId" label="仪表盘" style={{ width: '100%' }} rules={[{ required: true, message: '请选择仪表盘' }]} filter
            optionList={dashboards.map((d) => ({ value: d.id, label: d.name }))} />
          <Form.Input field="cron" label="Cron 表达式" rules={[{ required: true }]} placeholder="如 0 9 * * *（每天 9 点）" />
          <Form.Select field="channels" label="推送通道" multiple style={{ width: '100%' }} rules={[{ required: true, message: '至少一个通道' }]}
            optionList={[{ value: 'inApp', label: '站内信（推给创建者）' }, { value: 'email', label: '邮件' }]} />
          <Form.Input field="recipients" label="收件邮箱" placeholder="多个用逗号分隔（仅邮件通道）" />
          <Form.Select field="enabled" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
        </Form>
      </AppModal>
    </div>
  );
}
