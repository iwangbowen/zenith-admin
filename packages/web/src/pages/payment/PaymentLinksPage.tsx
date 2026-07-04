import { useState, useRef } from 'react';
import { formatYuan } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Space, Switch, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { QRCodeSVG } from 'qrcode.react';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_METHOD_LABELS, PAYMENT_LINK_STATUS_LABELS } from '@zenith/shared';
import type { PaymentLink, PaymentLinkStatus, PaymentMethod } from '@zenith/shared';
import { paymentLinkKeys, useDeletePaymentLink, usePaymentLinkDetail, usePaymentLinkList, useRotatePaymentLinkToken, useSavePaymentLink } from '@/hooks/queries/payment-links';

const yuan = (cents: number | null | undefined) => formatYuan(cents, '用户填写');
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
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const qrContainerRef = useRef<HTMLDivElement | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentLink | null>(null);
  const [qrLink, setQrLink] = useState<PaymentLink | null>(null);

  const listQuery = usePaymentLinkList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data ?? null;
  const detailQuery = usePaymentLinkDetail(editing?.id, modalVisible);
  const editingLink = editing ? (detailQuery.data ?? editing) : null;
  const saveMutation = useSavePaymentLink();
  const toggleMutation = useSavePaymentLink();
  const deleteMutation = useDeletePaymentLink();
  const rotateTokenMutation = useRotatePaymentLinkToken();
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentLinkKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setSubmittedParams(defaultSearch); setPage(1); void queryClient.invalidateQueries({ queryKey: paymentLinkKeys.lists }); }

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: PaymentLink) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const formInit: Partial<LinkFormValues> = editingLink
    ? {
        subject: editingLink.subject,
        amountYuan: editingLink.amount != null ? editingLink.amount / 100 : undefined,
        payMethod: editingLink.payMethod ?? undefined,
        bizType: editingLink.bizType,
        maxUses: editingLink.maxUses ?? undefined,
        expiredAt: editingLink.expiredAt ? new Date(editingLink.expiredAt) : undefined,
        status: editingLink.status === 'disabled' ? 'disabled' : 'active',
        remark: editingLink.remark ?? '',
      }
    : { bizType: 'general', status: 'active' };

  async function handleOk() {
    let values: LinkFormValues;
    try { values = (await formApi.current?.validate()) as LinkFormValues; } catch { throw new Error('validation'); }
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
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  function handleToggle(record: PaymentLink, checked: boolean) {
    toggleMutation.mutate(
      { id: record.id, values: { status: checked ? 'active' : 'disabled' } },
      { onSuccess: () => Toast.success(checked ? '已启用' : '已停用') },
    );
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  async function handleRotateToken(id: number) {
    await rotateTokenMutation.mutateAsync(id);
    Toast.success('token 已重置，旧链接已失效');
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
    {
      title: '状态', dataIndex: 'status', width: 140, fixed: 'right',
      render: (_: unknown, r: PaymentLink) => (
        <Space spacing={4}>
          <Tag color={LINK_STATUS_COLOR[r.status]}>{PAYMENT_LINK_STATUS_LABELS[r.status]}</Tag>
          {hasPermission('payment:link:update') && (
            <Switch checked={r.status !== 'disabled'} loading={togglingId === r.id} size="small" onChange={(c) => handleToggle(r, c)} />
          )}
        </Space>
      ),
    },
    createOperationColumn<PaymentLink>({
      width: 150,
      actions: (r) => [
        {
          key: 'qr',
          label: '收款码',
          onClick: () => setQrLink(r),
        },
        ...(hasPermission('payment:link:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(r),
        }, {
          key: 'rotate-token',
          label: '重置链接',
          loading: rotateTokenMutation.isPending && rotateTokenMutation.variables === r.id,
          onClick: () => {
            Modal.confirm({
              title: '重置链接',
              content: '重置后旧链接立即失效，确定？',
              onOk: () => handleRotateToken(r.id),
            });
          },
        }] : []),
        ...(hasPermission('payment:link:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除吗？',
              content: '删除后不可恢复',
              onOk: () => handleDelete(r.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="标题..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 200 }}
      onEnterPress={handleSearch}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'active', label: '生效中' }, { value: 'disabled', label: '已停用' }]}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('payment:link:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
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
        filterTitle="支付链接筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal title={editing ? '编辑支付链接' : '新增支付链接'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: saveMutation.isPending, disabled: !!editing && detailQuery.isFetching }} width={700} closeOnEsc>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInit} labelPosition="left" labelWidth={100}>
          <Form.Input field="subject" label="标题" placeholder="如：会员年费收款" rules={[{ required: true, message: '标题不能为空' }]} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.InputNumber field="amountYuan" label="金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} placeholder="留空=由用户填写" />
            <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={methodOptions} showClear placeholder="留空=用户选择" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.Input field="bizType" label="业务类型" placeholder="如：general" rules={[{ required: true, message: '业务类型不能为空' }]} />
            <Form.InputNumber field="maxUses" label="使用次数上限" min={1} step={1} precision={0} style={{ width: '100%' }} placeholder="留空=不限次" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.DatePicker field="expiredAt" label="失效时间" type="dateTime" style={{ width: '100%' }} placeholder="留空=永久有效" />
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'active', label: '生效中' }, { value: 'disabled', label: '已停用' }]} />
          </div>
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
