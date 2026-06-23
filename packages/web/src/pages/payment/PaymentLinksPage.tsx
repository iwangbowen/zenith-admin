import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Input, Popconfirm, Select, Space, Switch, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { QRCodeSVG } from 'qrcode.react';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_METHOD_LABELS, PAYMENT_LINK_STATUS_LABELS } from '@zenith/shared';
import type { PaginatedResponse, PaymentLink, PaymentLinkStatus, PaymentMethod } from '@zenith/shared';

const yuan = (cents: number | null | undefined) => (cents == null ? '用户填写' : `¥${(cents / 100).toFixed(2)}`);
const methodOptions = Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }));
const LINK_STATUS_COLOR = { active: 'green', disabled: 'grey', expired: 'red' } as const satisfies Record<PaymentLinkStatus, string>;

function publicUrl(token: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const publicPath = `/public/payment/link/${token}`;
  if (import.meta.env.VITE_ELECTRON === 'true') return `${window.location.origin}${base}/#${publicPath}`;
  return `${window.location.origin}${base}${publicPath}`;
}

interface SearchParams { keyword: string; status: string; }
const defaultSearch: SearchParams = { keyword: '', status: '' };

interface LinkFormValues {
  subject: string;
  amountYuan?: number;
  payMethod?: PaymentMethod;
  bizType: string;
  maxUses?: number;
  expiredAt?: Date;
  status?: 'active' | 'disabled';
  remark?: string;
}

export default function PaymentLinksPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const qrContainerRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<PaginatedResponse<PaymentLink> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [search, setSearch] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = search;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentLink | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [qrLink, setQrLink] = useState<PaymentLink | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const active = params ?? searchRef.current;
      setLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (active.keyword) query.keyword = active.keyword;
        if (active.status) query.status = active.status;
        const res = await request.get<PaginatedResponse<PaymentLink>>(`/api/payment/links?${new URLSearchParams(query)}`);
        if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize],
  );

  useEffect(() => {
    void fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearch(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); }

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: PaymentLink) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const formInit: Partial<LinkFormValues> = editing
    ? {
        subject: editing.subject,
        amountYuan: editing.amount != null ? editing.amount / 100 : undefined,
        payMethod: editing.payMethod ?? undefined,
        bizType: editing.bizType,
        maxUses: editing.maxUses ?? undefined,
        expiredAt: editing.expiredAt ? new Date(editing.expiredAt) : undefined,
        status: editing.status === 'disabled' ? 'disabled' : 'active',
        remark: editing.remark ?? '',
      }
    : { bizType: 'general', status: 'active' };

  async function handleOk() {
    let values: LinkFormValues;
    try { values = (await formApi.current?.validate()) as LinkFormValues; } catch { throw new Error('validation'); }
    setSubmitting(true);
    try {
      const payload = {
        subject: values.subject,
        amount: values.amountYuan != null ? Math.round(values.amountYuan * 100) : undefined,
        payMethod: values.payMethod || undefined,
        bizType: values.bizType,
        maxUses: values.maxUses ?? undefined,
        expiredAt: values.expiredAt ? formatDateTimeForApi(values.expiredAt) : undefined,
        status: values.status,
        remark: values.remark || undefined,
      };
      const res = editing
        ? await request.put<PaymentLink>(`/api/payment/links/${editing.id}`, payload)
        : await request.post<PaymentLink>('/api/payment/links', payload);
      if (res.code === 0) { Toast.success(editing ? '更新成功' : '创建成功'); closeModal(); void fetchList(); }
      else throw new Error(res.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleToggle(record: PaymentLink, checked: boolean) {
    setTogglingIds((prev) => new Set(prev).add(record.id));
    request
      .put<PaymentLink>(`/api/payment/links/${record.id}`, { status: checked ? 'active' : 'disabled' })
      .then((res) => { if (res.code === 0) { Toast.success(checked ? '已启用' : '已停用'); void fetchList(); } })
      .finally(() => setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/payment/links/${id}`);
    if (res.code === 0) { Toast.success('删除成功'); void fetchList(); }
  }

  async function copyPublicLink(link: PaymentLink) {
    try {
      await navigator.clipboard.writeText(publicUrl(link.token));
      Toast.success('链接已复制');
    } catch {
      Toast.error('复制失败，请手动复制链接');
    }
  }

  function downloadQrCode() {
    if (!qrLink) return;
    const svg = qrContainerRef.current?.querySelector('svg');
    if (!svg) {
      Toast.error('二维码未生成');
      return;
    }
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${qrLink.linkNo}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const columns: ColumnProps<PaymentLink>[] = [
    { title: '标题', dataIndex: 'subject', width: 180, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v}</Typography.Text> },
    { title: '金额', dataIndex: 'amount', width: 110, render: (v: number | null) => yuan(v) },
    { title: '支付方式', dataIndex: 'payMethod', width: 130, render: (v: PaymentMethod | null) => (v ? PAYMENT_METHOD_LABELS[v] : '用户选择') },
    { title: '业务类型', dataIndex: 'bizType', width: 120 },
    { title: '已用/上限', dataIndex: 'usedCount', width: 110, render: (_: unknown, r: PaymentLink) => `${r.usedCount} / ${r.maxUses ?? '∞'}` },
    { title: '失效时间', dataIndex: 'expiredAt', width: 170, render: (v: string | null) => (v ? formatDateTime(v) : '永久') },
    createdAtColumn as ColumnProps<PaymentLink>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentLinkStatus) => <Tag color={LINK_STATUS_COLOR[v]}>{PAYMENT_LINK_STATUS_LABELS[v]}</Tag> },
    {
      title: '操作', fixed: 'right', width: 170,
      render: (_: unknown, r: PaymentLink) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => setQrLink(r)}>收款码</Button>
          {hasPermission('payment:link:update') && (
            <Switch checked={r.status !== 'disabled'} loading={togglingIds.has(r.id)} size="small" onChange={(c) => handleToggle(r, c)} />
          )}
          {hasPermission('payment:link:update') && <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>}
          {hasPermission('payment:link:delete') && (
            <Popconfirm title="确定要删除吗？" content="删除后不可恢复" onConfirm={() => handleDelete(r.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="标题..." value={search.keyword} onChange={(v) => setSearch((p) => ({ ...p, keyword: v }))} showClear style={{ width: 200 }} onEnterPress={handleSearch} />
        <Select placeholder="全部状态" value={search.status || undefined} onChange={(v) => setSearch((p) => ({ ...p, status: (v as string) ?? '' }))} showClear style={{ width: 120 }}
          optionList={[{ value: 'active', label: '生效中' }, { value: 'disabled', label: '已停用' }]} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('payment:link:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal title={editing ? '编辑支付链接' : '新增支付链接'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: submitting }} width={560} closeOnEsc>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInit} labelPosition="left" labelWidth={96}>
          <Form.Input field="subject" label="标题" placeholder="如：会员年费收款" rules={[{ required: true, message: '标题不能为空' }]} />
          <Form.InputNumber field="amountYuan" label="金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} placeholder="留空=由用户填写金额" />
          <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={methodOptions} showClear placeholder="留空=用户选择" />
          <Form.Input field="bizType" label="业务类型" placeholder="如：general" rules={[{ required: true, message: '业务类型不能为空' }]} />
          <Form.InputNumber field="maxUses" label="使用次数上限" min={1} step={1} precision={0} style={{ width: '100%' }} placeholder="留空=不限次" />
          <Form.DatePicker field="expiredAt" label="失效时间" type="dateTime" style={{ width: '100%' }} placeholder="留空=永久有效" />
          <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'active', label: '生效中' }, { value: 'disabled', label: '已停用' }]} />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal title="收款码" visible={!!qrLink} onCancel={() => setQrLink(null)} footer={null} width={420} closeOnEsc>
        {qrLink && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 0' }}>
            <Typography.Title heading={6}>{qrLink.subject}</Typography.Title>
            <Typography.Text strong style={{ fontSize: 18, color: '#10b981' }}>{yuan(qrLink.amount)}</Typography.Text>
            <div ref={qrContainerRef} style={{ padding: 12, background: '#fff', borderRadius: 8 }}>
              <QRCodeSVG value={publicUrl(qrLink.token)} size={200} level="M" />
            </div>
            <Input value={publicUrl(qrLink.token)} readonly style={{ width: '100%' }} />
            <Space>
              <Button size="small" onClick={() => { void copyPublicLink(qrLink); }}>复制链接</Button>
              <Button size="small" onClick={downloadQrCode}>下载二维码</Button>
              <Button size="small" onClick={() => window.open(publicUrl(qrLink.token), '_blank', 'noopener')}>打开链接</Button>
            </Space>
          </div>
        )}
      </AppModal>
    </div>
  );
}
