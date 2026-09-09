import { useState, type CSSProperties } from 'react';
import { formatMinorAmount, formatYuan } from '@/utils/payment';
import { Button, Form, SideSheet, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import { formatDateForApi } from '@/utils/date';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import {
  paymentSettlementKeys,
  useDeletePaymentSettlement,
  useGeneratePaymentSettlement,
  usePaymentSettlementItems,
  usePaymentSettlementList,
  useUpdatePaymentSettlementStatus,
} from '@/hooks/queries/payment-settlements';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_CHANNELS, PAYMENT_SETTLEMENT_STATUS_LABELS, PAYMENT_SETTLEMENT_STATUSES, PAYMENT_CHANNEL_OPTIONS, PAYMENT_SETTLEMENT_STATUS_OPTIONS } from '@zenith/shared/payment';
import type { CreatePaymentSettlementInput, PaymentChannel, PaymentSettlementBatch, PaymentSettlementItem, PaymentSettlementStatus } from '@zenith/shared/payment';
import { abortSubmit } from '@/lib/abort-submit';
import { FilterSelect, StatusSelect } from '@/components/search-filters';
import { deleteAction, listTableProps, ListSearchToolbar } from '@/components/list-page';
import { PaymentChannelTag, paymentMoneyColumn } from './payment-display';
import { paymentAppBoundConfigIds, useAppMerchantConfigLookup } from './payment-app-options';
import { PaymentAppField, PaymentCurrencyField, PaymentMerchantConfigField } from './payment-form-fields';

const yuan = formatYuan;
const channelOptions = PAYMENT_CHANNEL_OPTIONS;
const STATUS_COLOR = { pending: 'grey', settling: 'blue', settled: 'green', failed: 'red' } as const satisfies Record<PaymentSettlementStatus, string>;

interface SearchParams { channel?: string; status?: string; }
const defaultSearch: SearchParams = { channel: undefined, status: '' };

interface GenerateFormValues { applicationId: number; channelConfigId: number; currency: 'CNY'; period: [Date, Date]; remark?: string; }
interface SettlementReferenceFormValues { reference: string; }

export default function PaymentSettlementsPage() {
  const { hasPermission } = usePermission();
  const canSettle = hasPermission('payment:settlement:settle');
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [detailBatch, setDetailBatch] = useState<PaymentSettlementBatch | null>(null);
  const {
    page, pageSize, buildPagination,
    bind, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentSettlementKeys.lists });

  const listQuery = usePaymentSettlementList({
    page,
    pageSize,
    channel: enumValueOf(PAYMENT_CHANNELS, submittedParams.channel),
    status: enumValueOf(PAYMENT_SETTLEMENT_STATUSES, submittedParams.status),
  });
  const { channelConfigsQuery, appById, appOptions, appsFetching, channelConfigById, merchantConfigOptions } = useAppMerchantConfigLookup(selectedAppId);
  const generateMutation = useGeneratePaymentSettlement();
  const itemsQuery = usePaymentSettlementItems(detailBatch?.id, !!detailBatch);
  const transitionMutation = useUpdatePaymentSettlementStatus();
  const deleteMutation = useDeletePaymentSettlement();
  const transitioningId = transitionMutation.isPending ? (transitionMutation.variables?.params.id ?? null) : null;

  const generateSaveMutation = {
    mutateAsync: ({ values }: { id?: number; values: CreatePaymentSettlementInput }) => generateMutation.mutateAsync({ body: values }),
    isPending: generateMutation.isPending,
  };
  const generateModal = useEditModal<PaymentSettlementBatch, GenerateFormValues, CreatePaymentSettlementInput>({
    save: generateSaveMutation,
    defaults: { currency: 'CNY' },
    beforeSave: (values) => {
      const config = channelConfigById.get(values.channelConfigId);
      const app = appById.get(values.applicationId);
      const appConfigIds = paymentAppBoundConfigIds(app);
      if (!app || !config || !appConfigIds.has(config.id)) {
        Toast.error('所选支付应用未绑定该商户配置，请重新选择');
        abortSubmit('validation');
      }
      return {
        applicationId: app.id,
        channelConfigId: config.id,
        currency: values.currency,
        periodStart: formatDateForApi(values.period[0]),
        periodEnd: formatDateForApi(values.period[1]),
        remark: values.remark?.trim() || undefined,
      };
    },
    successMessage: () => '生成成功',
  });

  const settleSaveMutation = {
    mutateAsync: ({ id, values }: { id?: number; values: SettlementReferenceFormValues }) => {
      if (id == null) {
        Toast.error('缺少结算批次 ID，请刷新后重试');
        abortSubmit('validation');
      }
      return transitionMutation.mutateAsync({ params: { id }, body: { status: 'settled', payoutReference: values.reference.trim() } });
    },
    isPending: transitionMutation.isPending,
  };
  const settleModal = useEditModal<PaymentSettlementBatch, SettlementReferenceFormValues>({
    save: settleSaveMutation,
    toValues: () => ({ reference: '' }),
    beforeSave: (values) => ({ reference: values.reference.trim() }),
    successMessage: () => '已确认结算到账',
    labelWidth: 110,
  });

  const failSaveMutation = {
    mutateAsync: ({ id, values }: { id?: number; values: SettlementReferenceFormValues }) => {
      if (id == null) {
        Toast.error('缺少结算批次 ID，请刷新后重试');
        abortSubmit('validation');
      }
      return transitionMutation.mutateAsync({ params: { id }, body: { status: 'failed', failureReason: values.reference.trim() } });
    },
    isPending: transitionMutation.isPending,
  };
  const failModal = useEditModal<PaymentSettlementBatch, SettlementReferenceFormValues>({
    save: failSaveMutation,
    toValues: () => ({ reference: '' }),
    beforeSave: (values) => ({ reference: values.reference.trim() }),
    successMessage: () => '已标记结算失败',
    labelWidth: 110,
  });

  async function handleStart(record: PaymentSettlementBatch) {
    await transitionMutation.mutateAsync({ params: { id: record.id }, body: { status: 'settling' } });
    Toast.success('已进入结算中');
  }

  function openGenerate() {
    setSelectedAppId(null);
    generateModal.openCreate();
  }

  const columns: ColumnProps<PaymentSettlementBatch>[] = [
    copyableNoColumn('批次号', 'batchNo'),
    { title: '支付应用', dataIndex: 'appId', width: 200, render: (v: number) => renderEllipsis(appById.get(v)?.name ?? `应用 #${v}`) },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <PaymentChannelTag channel={v} /> },
    {
      title: '商户配置', dataIndex: 'channelConfigId', width: 220,
      render: (v: number) => renderEllipsis(channelConfigById.get(v)?.name ?? `配置 #${v}`),
    },
    { title: '币种', dataIndex: 'currency', width: 80 },
    { title: '账期', dataIndex: 'periodStart', width: 240, render: (_: unknown, r: PaymentSettlementBatch) => <span style={{ whiteSpace: 'nowrap' }}>{r.periodStart} ~ {r.periodEnd}</span> },
    { title: '订单数', dataIndex: 'orderCount', width: 80, align: 'right' },
    { ...paymentMoneyColumn<PaymentSettlementBatch>('收款', 'grossAmount'), width: 110 },
    { ...paymentMoneyColumn<PaymentSettlementBatch>('手续费', 'feeAmount'), width: 100 },
    { ...paymentMoneyColumn<PaymentSettlementBatch>('退款', 'refundAmount'), width: 100 },
    { title: '分账', dataIndex: 'sharingAmount', width: 100, align: 'right', render: (v: number) => yuan(v ?? 0) },
    { title: '净额', dataIndex: 'netAmount', width: 120, align: 'right', render: (v: number) => <Typography.Text strong type={v < 0 ? 'danger' : 'success'}>{yuan(v)}</Typography.Text> },
    { title: '到账参考号', dataIndex: 'payoutReference', width: 180, render: renderEllipsis },
    { title: '失败原因', dataIndex: 'failureReason', minWidth: 200, render: renderEllipsis },
    dateTimeColumn('到账时间', 'settledAt'),
    createdAtColumn as ColumnProps<PaymentSettlementBatch>,
    { title: '版本', dataIndex: 'version', width: 80, align: 'right', render: (v: number) => `v${v}` },
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (v: PaymentSettlementStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_SETTLEMENT_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentSettlementBatch>({
      width: 240,
      desktopInlineKeys: ['items', 'start', 'settled'],
      menuAriaLabel: '更多结算操作',
      emptyContent: <Typography.Text type="tertiary">—</Typography.Text>,
      actions: (r) => {
        const detailAction = { key: 'items', label: '资金明细', onClick: () => setDetailBatch(r) };
        if (!canSettle || r.status === 'settled' || r.status === 'failed') return [detailAction];
        const busy = transitioningId === r.id;
        return [
          detailAction,
          ...(r.status === 'pending' ? [{
            key: 'start',
            label: '开始结算',
            loading: busy,
            onClick: () => void handleStart(r),
          },
          deleteAction({
            hidden: false,
            disabled: deleteMutation.isPending && deleteMutation.variables?.params.id === r.id,
            title: `删除结算批次 ${r.batchNo}？`,
            content: '删除后该批次认领的资金凭证行会重新变为可结算状态。',
            run: () => deleteMutation.mutateAsync({ params: { id: r.id } }),
            successMessage: '结算批次已删除，资金明细已解除认领',
          })] : []),
          ...(r.status === 'settling' ? [{
            key: 'settled',
            label: '标记到账',
            loading: busy,
            onClick: () => settleModal.openEdit(r),
          }] : []),
          {
            key: 'failed',
            label: '标记失败',
            danger: true,
            loading: busy,
            onClick: () => failModal.openEdit(r),
          },
        ];
      },
    }),
  ];

  const itemColumns: ColumnProps<PaymentSettlementItem>[] = [
    copyableNoColumn('资金凭证行 ID', 'journalLineId', { width: 150 }),
    { title: '认领金额', dataIndex: 'amount', width: 150, align: 'right', render: (value: string, record: PaymentSettlementItem) => formatMinorAmount(value, record.currency) },
    { title: '支付应用', dataIndex: 'appId', width: 200, render: (value: number) => renderEllipsis(appById.get(value)?.name ?? `应用 #${value}`) },
    {
      title: '商户配置', dataIndex: 'channelConfigId', width: 220,
      render: (value: number) => renderEllipsis(channelConfigById.get(value)?.name ?? `配置 #${value}`),
    },
    { title: '币种', dataIndex: 'currency', width: 80 },
    createdAtColumn as ColumnProps<PaymentSettlementItem>,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <FilterSelect
            placeholder="全部渠道"
            items={channelOptions}
            {...bind('channel')}
          />
        )}
        filters={(
          <StatusSelect
            items={PAYMENT_SETTLEMENT_STATUS_OPTIONS}
            {...bind('status')}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('payment:settlement:generate') ? (
            <Button type="primary" icon={<Plus size={14} />} onClick={openGenerate}>生成结算</Button>
          ) : null
        )}
        filterTitle="结算批次筛选"
      />

      <ConfigurableTable<PaymentSettlementBatch>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...generateModal.modalProps} title="生成结算批次" width={520}>
        <Form key={generateModal.formKey} {...generateModal.formProps}>
          <PaymentAppField
            optionList={appOptions}
            loading={appsFetching}
            requiredMessage="请选择启用的支付应用"
            onChange={(appId) => {
              setSelectedAppId(appId);
              generateModal.formApi.current?.setValue('channelConfigId', undefined);
            }}
          />
          <PaymentMerchantConfigField optionList={merchantConfigOptions} loading={channelConfigsQuery.isFetching} />
          <PaymentCurrencyField />
          <Form.DatePicker
            field="period"
            label="账期"
            type="dateRange"
            style={{ width: '100%' }}
            rules={[
              { required: true, message: '请选择账期' },
              {
                validator: (_rule: unknown, value: unknown) => {
                  if (!Array.isArray(value) || value.length !== 2) return false;
                  const [start, end] = value as [Date, Date];
                  return start <= end;
                },
                message: '账期开始不能晚于结束',
              },
            ]}
          />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginLeft: 90 }}>将聚合该渠道账期内成功订单，净额 = 收款 - 手续费 - 退款 - 分账</Typography.Text>
        </Form>
      </AppModal>

      <SideSheet
        title={`结算资金明细${detailBatch ? `（${detailBatch.batchNo}）` : ''}`}
        visible={!!detailBatch}
        onCancel={() => setDetailBatch(null)}
        width={860}
        closeOnEsc
      >
        {detailBatch && (
          <>
            <div className="auto-grid" style={{ ['--auto-grid-min']: '180px', ['--auto-grid-cols']: 3, marginBottom: 16 } as CSSProperties}>
              <Typography.Text>应用：{appById.get(detailBatch.appId)?.name ?? `应用 #${detailBatch.appId}`}</Typography.Text>
              <Typography.Text>商户配置：{channelConfigById.get(detailBatch.channelConfigId)?.name ?? `配置 #${detailBatch.channelConfigId}`}</Typography.Text>
              <Typography.Text strong>批次净额：{yuan(detailBatch.netAmount)}</Typography.Text>
            </div>
            <Spin spinning={itemsQuery.isFetching}>
              <ConfigurableTable
                bordered columns={itemColumns} dataSource={itemsQuery.data ?? []} loading={itemsQuery.isFetching} rowKey="id" size="small" empty="暂无已认领资金明细"
                onRefresh={() => void itemsQuery.refetch()} refreshLoading={itemsQuery.isFetching} pagination={false}
              />
            </Spin>
          </>
        )}
      </SideSheet>

      <AppModal {...settleModal.modalProps} title="确认结算到账" width={520}>
        <Form key={settleModal.formKey} {...settleModal.formProps}>
          <Form.Slot label="批次号">{settleModal.editing?.batchNo ?? '-'}</Form.Slot>
          <Form.Slot label="结算净额">{settleModal.editing ? yuan(settleModal.editing.netAmount) : '-'}</Form.Slot>
          <Form.Input
            field="reference"
            label="到账参考号"
            maxLength={128}
            placeholder="银行流水号、渠道出款单号或到账凭证号"
            rules={[
              { required: true, message: '请填写到账参考号' },
              { validator: (_rule: unknown, value: unknown) => Boolean(String(value ?? '').trim()), message: '到账参考号不能只包含空格' },
            ]}
          />
        </Form>
      </AppModal>

      <AppModal
        {...failModal.modalProps}
        title="标记结算失败"
        width={520}
        okButtonProps={{ ...failModal.modalProps.okButtonProps, type: 'danger', theme: 'solid' }}
      >
        <Form key={failModal.formKey} {...failModal.formProps}>
          <Form.Slot label="批次号">{failModal.editing?.batchNo ?? '-'}</Form.Slot>
          <Form.TextArea
            field="reference"
            label="失败原因"
            autosize
            rows={3}
            maxCount={512}
            placeholder="请填写失败阶段、渠道返回和后续处理建议"
            rules={[
              { required: true, message: '请填写失败原因' },
              { validator: (_rule: unknown, value: unknown) => Boolean(String(value ?? '').trim()), message: '失败原因不能只包含空格' },
            ]}
          />
        </Form>
      </AppModal>
    </div>
  );
}
