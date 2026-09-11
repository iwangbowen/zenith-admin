import type { CSSProperties } from 'react';
import { useMemo, useRef, useState } from 'react';
import { formatYuan } from '@/utils/payment';
import { downloadBlob } from '@/utils/download';
import { Button, Form, Input, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { QRCodeSVG } from 'qrcode.react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import { formatDateTimeForApi } from '@/utils/date';
import { createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { PAYMENT_CASHIER_METHODS, PAYMENT_METHOD_LABELS, PAYMENT_LINK_STATUS_LABELS, PAYMENT_LINK_STATUS_OPTIONS } from '@zenith/shared/payment';
import type { PaymentApp, PaymentCashierMethod, PaymentLink, PaymentLinkStatus } from '@zenith/shared/payment';
import { paymentLinkKeys, useDeletePaymentLinks, usePaymentLinkDetail, usePaymentLinkList, useRotatePaymentLinkToken, useSavePaymentLink, type PaymentLinkSaveValues } from '@/hooks/queries/payment-links';
import { useEnsureShortLink } from '@/hooks/queries/short-links';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';
import { copyTextWithToast } from '@/utils/clipboard';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { useAppPaymentMethodOptions, useEnabledPaymentAppLookup } from './payment-app-options';
import { paymentMoneyColumn } from './payment-display';

const yuan = (cents: number | null | undefined) => formatYuan(cents, '用户填写');
const LINK_STATUS_COLOR = { active: 'green', disabled: 'grey', expired: 'red' } as const satisfies Record<PaymentLinkStatus, string>;

function isCashierMethod(value: PaymentLink['payMethod']): value is PaymentCashierMethod {
  return value != null && (PAYMENT_CASHIER_METHODS as readonly string[]).includes(value);
}

function publicUrl(token: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const publicPath = `/public/payment/link/${token}`;
  if (import.meta.env.VITE_ELECTRON === 'true') return `${window.location.origin}${base}/#${publicPath}`;
  return `${window.location.origin}${base}${publicPath}`;
}

interface SearchParams { keyword: string; status?: PaymentLinkStatus; }
const defaultSearch: SearchParams = { keyword: '', status: undefined };

interface LinkFormValues {
  applicationId: number;
  subject: string;
  amountYuan?: number;
  payMethod?: PaymentCashierMethod;
  bizType: string;
  maxUses?: number;
  expiredAt?: Date;
  status?: 'active' | 'disabled';
  remark?: string;
}

// 收款链接按开放应用名标识支付应用（其它支付页用环境后缀）
const paymentAppOptionLabel = (app: PaymentApp) => `${app.name} · ${app.openClientName}`;

export default function PaymentLinksPage() {
  const { hasPermission } = usePermission();
  const qrContainerRef = useRef<HTMLDivElement | null>(null);
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentLinkKeys.lists });

  const [qrLink, setQrLink] = useState<PaymentLink | null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<number>();
  // 当前收款码弹窗对应的短链地址；切换目标链接时重置
  const [payShortUrl, setPayShortUrl] = useState<string | null>(null);
  const ensureShortLinkMutation = useEnsureShortLink();

  const listQuery = usePaymentLinkList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const { apps: paymentApps, appOptions, isFetching: appsFetching } = useEnabledPaymentAppLookup({ label: paymentAppOptionLabel });
  const appNameById = useMemo(() => new Map(paymentApps.map((app) => [app.id, app.name])), [paymentApps]);
  const selectedPaymentApp = paymentApps.find((app) => app.id === selectedApplicationId);
  const { options: methodOptions } = useAppPaymentMethodOptions(selectedPaymentApp, PAYMENT_CASHIER_METHODS);
  const saveMutation = useSavePaymentLink();
  const modal = useEditModal<PaymentLink, LinkFormValues, PaymentLinkSaveValues>({
    entityName: '支付链接',
    save: saveMutation,
    useDetail: usePaymentLinkDetail,
    defaults: { bizType: 'general', status: 'active' },
    toValues: (record) => ({
      applicationId: record.appId,
      subject: record.subject,
      amountYuan: record.amount != null ? record.amount / 100 : undefined,
      payMethod: isCashierMethod(record.payMethod) ? record.payMethod : undefined,
      bizType: record.bizType,
      maxUses: record.maxUses ?? undefined,
      expiredAt: record.expiredAt ? new Date(record.expiredAt) : undefined,
      status: record.status === 'disabled' ? 'disabled' : 'active',
      remark: record.remark ?? '',
    }),
    beforeSave: (values, { isEdit }) => ({
      ...(!isEdit ? { applicationId: values.applicationId } : {}),
      subject: values.subject,
      amount: values.amountYuan != null ? Math.round(values.amountYuan * 100) : undefined,
      payMethod: values.payMethod || undefined,
      bizType: values.bizType,
      maxUses: values.maxUses ?? undefined,
      expiredAt: values.expiredAt ? formatDateTimeForApi(values.expiredAt) : undefined,
      status: values.status,
      remark: values.remark || undefined,
    }),
    labelWidth: 100,
  });

  function openCreate() {
    setSelectedApplicationId(undefined);
    modal.openCreate();
  }

  function openEdit(record: PaymentLink) {
    setSelectedApplicationId(record.appId);
    modal.openEdit(record);
  }
  const toggleMutation = useSavePaymentLink();
  const deleteMutation = useDeletePaymentLinks();
  const rotateTokenMutation = useRotatePaymentLinkToken();
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;

  function handleToggle(record: PaymentLink, checked: boolean) {
    toggleMutation.mutate(
      { id: record.id, values: { status: checked ? 'active' : 'disabled' } },
      { onSuccess: () => Toast.success(checked ? '已启用' : '已停用') },
    );
  }

  async function handleRotateToken(id: number) {
    await rotateTokenMutation.mutateAsync({ params: { id } });
    Toast.success('token 已重置，旧链接已失效');
  }

  function copyPublicLink(link: PaymentLink) {
    return copyTextWithToast(publicUrl(link.token), { success: '链接已复制', error: '复制失败，请手动复制链接' });
  }

  async function handleGenerateShortLink() {
    if (!qrLink) return;
    const link = await ensureShortLinkMutation.mutateAsync({
      body: {
        targetUrl: publicUrl(qrLink.token),
        bizType: 'payment_link',
        bizRef: String(qrLink.id),
        title: qrLink.subject,
      },
    });
    setPayShortUrl(link.shortUrl);
    Toast.success('短链已生成，二维码已切换为短链');
  }

  function copyShortLink() {
    if (!payShortUrl) return;
    return copyTextWithToast(payShortUrl, { success: '短链已复制', error: '复制失败，请手动复制链接' });
  }

  function downloadQrCode() {
    if (!qrLink) return;
    const svg = qrContainerRef.current?.querySelector('svg');
    if (!svg) {
      Toast.error('二维码未生成');
      return;
    }
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `${qrLink.linkNo}.svg`);
  }

  const columns: ColumnProps<PaymentLink>[] = [
    { title: '标题', dataIndex: 'subject', minWidth: 180, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v}</Typography.Text> },
    { title: '支付应用', dataIndex: 'appId', width: 200, render: (v: number) => renderEllipsis(appNameById.get(v) ?? `应用 #${v}`) },
    { ...paymentMoneyColumn<PaymentLink>('金额', 'amount', { empty: '用户填写' }), width: 110 },
    { title: '支付方式', dataIndex: 'payMethod', width: 130, render: (v: PaymentCashierMethod | null) => (v ? PAYMENT_METHOD_LABELS[v] : '用户选择') },
    { title: '业务类型', dataIndex: 'bizType', width: 140, render: renderEllipsis },
    { title: '已用/预占/上限', dataIndex: 'usedCount', width: 150, align: 'right', render: (_: unknown, r: PaymentLink) => `${r.usedCount} / ${r.reservedCount} / ${r.maxUses ?? '∞'}` },
    dateTimeColumn('失效时间', 'expiredAt', { empty: '永久' }),
    createdAtColumn as ColumnProps<PaymentLink>,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: PaymentLink['status']) => <Tag color={LINK_STATUS_COLOR[v]}>{PAYMENT_LINK_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<PaymentLink>({
      width: 190,
      desktopInlineKeys: ['qr', 'edit'],
      actions: (r) => [
        {
          key: 'qr',
          label: '收款码',
          onClick: () => {
            setPayShortUrl(null);
            setQrLink(r);
          },
        },
        ...(hasPermission('payment:link:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(r),
        }, {
          key: 'toggle',
          label: r.status === 'disabled' ? '启用' : '停用',
          loading: togglingId === r.id,
          onClick: () => handleToggle(r, r.status === 'disabled'),
        }, {
          key: 'rotate-token',
          label: '重置链接',
          loading: rotateTokenMutation.isPending && rotateTokenMutation.variables?.params.id === r.id,
          onClick: () => {
            confirmDanger({
              title: '重置链接',
              content: '重置后旧链接立即失效，确定？',
              onOk: () => handleRotateToken(r.id),
            });
          },
        }] : []),
        deleteAction({
          hidden: !hasPermission('payment:link:delete'),
          title: '确定要删除吗？',
          content: '删除后不可恢复',
          run: () => deleteMutation.mutateAsync([r.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="标题..." {...bindKeyword('keyword')} width={200} />}
        filters={(
          <StatusSelect
            items={PAYMENT_LINK_STATUS_OPTIONS}
            {...bind('status')}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('payment:link:create') ? (
            <CreateButton onClick={openCreate} />
          ) : null
        )}
        filterTitle="支付链接筛选"
      />

      <ConfigurableTable<PaymentLink>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} width={700}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Input field="subject" label="标题" placeholder="如：会员年费收款" rules={[{ required: true, message: '标题不能为空' }]} />
          {modal.isEdit ? (
            <Form.Slot label="支付应用">{modal.editing ? (appNameById.get(modal.editing.appId) ?? `应用 #${modal.editing.appId}`) : '-'}</Form.Slot>
          ) : (
            <Form.Select
              field="applicationId"
              label="支付应用"
              style={{ width: '100%' }}
              optionList={appOptions}
              filter
              loading={appsFetching}
              onChange={(value) => {
                setSelectedApplicationId(value as number | undefined);
                modal.formApi.current?.setValue('payMethod', undefined);
              }}
              rules={[{ required: true, message: '请选择支付应用' }]}
            />
          )}
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
            <Form.InputNumber field="amountYuan" label="金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} placeholder="留空=由用户填写" />
            <Form.Select
              field="payMethod"
              label="支付方式"
              style={{ width: '100%' }}
              optionList={methodOptions}
              showClear
              disabled={!selectedPaymentApp || methodOptions.length === 0}
              placeholder={selectedPaymentApp ? (methodOptions.length > 0 ? '留空=用户选择' : '该应用暂无可用收银台方式') : '请先选择支付应用'}
            />
          </div>
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
            <Form.Input field="bizType" label="业务类型" placeholder="如：general" rules={[{ required: true, message: '业务类型不能为空' }]} />
            <Form.InputNumber field="maxUses" label="使用次数上限" min={1} step={1} precision={0} style={{ width: '100%' }} placeholder="留空=不限次" />
          </div>
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
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
            <div ref={qrContainerRef} style={{ padding: 12, background: '#fff', borderRadius: 'var(--semi-border-radius-medium)' }}>
              <QRCodeSVG value={payShortUrl ?? publicUrl(qrLink.token)} size={200} level="M" />
            </div>
            <Input value={payShortUrl ?? publicUrl(qrLink.token)} readonly style={{ width: '100%' }} />
            <Space>
              {payShortUrl ? (
                <Button size="small" onClick={() => { void copyShortLink(); }}>复制短链</Button>
              ) : (
                <Button size="small" onClick={() => { void copyPublicLink(qrLink); }}>复制链接</Button>
              )}
              {!payShortUrl && hasPermission('shortlink:link:create') && (
                <Button size="small" loading={ensureShortLinkMutation.isPending} onClick={() => { void handleGenerateShortLink(); }}>生成短链</Button>
              )}
              <Button size="small" onClick={downloadQrCode}>下载二维码</Button>
              <Button size="small" onClick={() => window.open(payShortUrl ?? publicUrl(qrLink.token), '_blank', 'noopener')}>打开链接</Button>
            </Space>
          </div>
        )}
      </AppModal>
    </div>
  );
}
