import { useMemo, useState, useRef } from 'react';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { Button, Form, SideSheet, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CloudDownload } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { formatDateForApi } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import {
  paymentReconKeys,
  useAutoPaymentRecon,
  useCreatePaymentReconBatch,
  useDeletePaymentReconBatch,
  useHandlePaymentReconItem,
  usePaymentReconBatchList,
  usePaymentReconItems,
  usePaymentReconSampleBill,
} from '@/hooks/queries/payment-recon';
import { usePaymentChannelOperationLookup } from '@/hooks/queries/payment-channels';
import { usePaymentAppList } from '@/hooks/queries/payment-apps';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_CHANNELS, PAYMENT_RECON_HANDLE_STATUS_LABELS, PAYMENT_RECON_HANDLE_STATUSES, PAYMENT_RECON_RESULT_LABELS, PAYMENT_RECON_RESULTS, PAYMENT_RECON_SOURCE_LABELS, PAYMENT_RECON_STATUS_LABELS, PAYMENT_RECON_STATUSES, PAYMENT_RECON_STATUS_OPTIONS, PAYMENT_RECON_RESULT_OPTIONS, PAYMENT_RECON_HANDLE_STATUS_OPTIONS } from '@zenith/shared/payment';
import type { AutoPaymentReconInput, CreatePaymentReconBatchInput, PaymentChannel, PaymentReconBatch, PaymentReconHandleStatus, PaymentReconItem, PaymentReconResult, PaymentReconSource, PaymentReconStatus } from '@zenith/shared/payment';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { copyableNoColumn, dateColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';
import { FilterSelect, StatusSelect } from '@/components/search-filters';

const STATUS_COLOR = { pending: 'grey', comparing: 'blue', done: 'green', failed: 'red' } as const satisfies Record<PaymentReconStatus, string>;
const RESULT_COLOR = { matched: 'green', local_only: 'amber', channel_only: 'orange', amount_diff: 'red', status_diff: 'red' } as const satisfies Record<PaymentReconResult, string>;
const HANDLE_COLOR = { pending: 'amber', adjusted: 'green', suspended: 'orange', ignored: 'grey' } as const satisfies Record<PaymentReconHandleStatus, string>;
const SOURCE_COLOR = { manual_upload: 'orange', sandbox_generated: 'grey', provider_download: 'green' } as const satisfies Record<PaymentReconSource, string>;
const NON_FINANCIAL_HANDLE_ACTION_OPTIONS = [
  { value: 'suspended' as const, label: '挂账归档（终态，不自动入账）' },
  { value: 'ignored' as const, label: '忽略（确认无需处理）' },
];
const PROVIDER_HANDLE_ACTION_OPTIONS = [
  { value: 'adjusted' as const, label: '已调账（生成平衡的双分录凭证）' },
  ...NON_FINANCIAL_HANDLE_ACTION_OPTIONS,
];
const yuan = formatYuan;

interface SearchParams { channel?: string; status?: string; }
const defaultSearch: SearchParams = { channel: undefined, status: '' };

interface ReconFormValues {
  applicationId: number;
  channelConfigId: number;
  currency: 'CNY';
  billDate: Date | string;
  billText: string;
  remark?: string;
}
interface AutoReconFormValues { channel: string; applicationId?: number; channelConfigId?: number; currency?: 'CNY'; billDate: Date | string; }
interface HandleFormValues { action: 'adjusted' | 'suspended' | 'ignored'; remark: string; }

export default function PaymentReconPage() {
  const { hasPermission } = usePermission();
  const canHandle = hasPermission('payment:recon:handle');
  const latestAutoBatch = useRef<PaymentReconBatch | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentReconKeys.lists });

  const [detailBatch, setDetailBatch] = useState<PaymentReconBatch | null>(null);
  const canAdjustDetailBatch = detailBatch?.source === 'provider_download';
  const [itemResult, setItemResult] = useState<string | undefined>();
  const [itemHandleStatus, setItemHandleStatus] = useState<string | undefined>();
  const {
    page: itemPage,
    pageSize: itemPageSize,
    setPage: setItemPage,
    buildPagination: buildItemPagination,
  } = usePagination();

  const listQuery = usePaymentReconBatchList({
    page,
    pageSize,
    channel: enumValueOf(PAYMENT_CHANNELS, submittedParams.channel),
    status: enumValueOf(PAYMENT_RECON_STATUSES, submittedParams.status),
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const channelConfigsQuery = usePaymentChannelOperationLookup();
  const operationChannelConfigs = useMemo(() => channelConfigsQuery.data ?? [], [channelConfigsQuery.data]);
  const appLookupQuery = usePaymentAppList({ page: 1, pageSize: 100, status: 'enabled' });
  const paymentApps = useMemo(() => appLookupQuery.data?.list ?? [], [appLookupQuery.data?.list]);
  const appById = useMemo(() => new Map(paymentApps.map((app) => [app.id, app])), [paymentApps]);
  const appOptions = useMemo(
    () => paymentApps.map((app) => ({ value: app.id, label: `${app.name} · ${app.environment === 'sandbox' ? '沙箱' : '生产'}` })),
    [paymentApps],
  );
  const channelConfigById = useMemo(
    () => new Map(operationChannelConfigs.map((config) => [config.id, config])),
    [operationChannelConfigs],
  );
  const merchantConfigOptions = useMemo(
    () => {
      const app = selectedAppId == null ? null : appById.get(selectedAppId);
      const boundConfigIds = new Set([app?.wechatConfigId, app?.alipayConfigId, app?.unionpayConfigId].filter((id): id is number => id != null));
      return operationChannelConfigs.filter((config) => boundConfigIds.has(config.id)).map((config) => ({
      value: config.id,
      label: `${config.name} · ${PAYMENT_CHANNEL_LABELS[config.channel]} · ${config.sandbox ? '沙箱' : '生产'}`,
      }));
    },
    [appById, operationChannelConfigs, selectedAppId],
  );
  const autoOptions = useMemo(() => operationChannelConfigs
    .flatMap((config) => paymentApps
      .filter((app) => [app.wechatConfigId, app.alipayConfigId, app.unionpayConfigId].includes(config.id))
      .map((app) => ({ value: `${app.id}:${config.id}`, label: `${app.name} · ${config.name} · ${PAYMENT_CHANNEL_LABELS[config.channel]}`, applicationId: app.id, channelConfigId: config.id, channel: config.channel }))), [paymentApps, operationChannelConfigs]);
  const itemsQuery = usePaymentReconItems(detailBatch?.id, {
    page: itemPage,
    pageSize: itemPageSize,
    result: enumValueOf(PAYMENT_RECON_RESULTS, itemResult),
    handleStatus: enumValueOf(PAYMENT_RECON_HANDLE_STATUSES, itemHandleStatus),
  }, !!detailBatch);
  const itemsData = itemsQuery.data?.list ?? [];
  const itemsTotal = itemsQuery.data?.total ?? 0;
  const sampleBillMutation = usePaymentReconSampleBill();
  const createMutation = useCreatePaymentReconBatch();
  const deleteMutation = useDeletePaymentReconBatch();
  const handleItemMutation = useHandlePaymentReconItem();
  const autoMutation = useAutoPaymentRecon();

  const createSaveMutation = {
    mutateAsync: ({ values }: { id?: number; values: CreatePaymentReconBatchInput }) => createMutation.mutateAsync({ body: values }),
    isPending: createMutation.isPending,
  };
  const createModal = useEditModal<PaymentReconBatch, ReconFormValues, CreatePaymentReconBatchInput>({
    save: createSaveMutation,
    defaults: { currency: 'CNY' },
    beforeSave: (values) => {
      const config = channelConfigById.get(values.channelConfigId);
      const app = appById.get(values.applicationId);
      const appConfigIds = [app?.wechatConfigId, app?.alipayConfigId, app?.unionpayConfigId];
      if (!app || !config || !appConfigIds.includes(config.id)) {
        Toast.error('所选支付应用未绑定该商户配置，请重新选择');
        abortSubmit('validation');
      }
      return {
        applicationId: app.id,
        channel: config.channel,
        channelConfigId: config.id,
        currency: values.currency,
        billDate: formatDateForApi(values.billDate),
        billText: values.billText,
        remark: values.remark?.trim() || undefined,
      };
    },
    successMessage: () => '创建成功',
    labelWidth: 100,
  });
  const autoSaveMutation = {
    mutateAsync: async ({ values }: { id?: number; values: AutoPaymentReconInput }) => {
      const batch = await autoMutation.mutateAsync({ body: values });
      latestAutoBatch.current = batch;
      return batch;
    },
    isPending: autoMutation.isPending,
  };
  const autoModal = useEditModal<PaymentReconBatch, AutoReconFormValues, AutoPaymentReconInput>({
    save: autoSaveMutation,
    beforeSave: (values) => {
      const selected = autoOptions.find((option) => option.value === values.channel);
      if (!selected) { Toast.warning('请选择支付应用和商户配置'); abortSubmit('validation'); }
      return { applicationId: selected.applicationId, channel: selected.channel, channelConfigId: selected.channelConfigId, currency: 'CNY', billDate: formatDateForApi(values.billDate) };
    },
    successMessage: () => {
      const batch = latestAutoBatch.current;
      return `对账完成：匹配 ${batch?.matchedCount ?? 0} 笔，差异 ${batch?.diffCount ?? 0} 笔`;
    },
    labelWidth: 100,
  });
  const handleSaveMutation = {
    mutateAsync: ({ id, values }: { id?: number; values: HandleFormValues }) => {
      if (id == null) throw new Error('缺少记录 ID，请刷新后重试');
      return handleItemMutation.mutateAsync({ params: { id }, body: { action: values.action, remark: values.remark.trim() } });
    },
    isPending: handleItemMutation.isPending,
  };
  const handleModal = useEditModal<PaymentReconItem, HandleFormValues>({
    save: handleSaveMutation,
    defaults: { action: 'suspended', remark: '' },
    toValues: () => ({ action: 'suspended', remark: '' }),
    successMessage: () => '差异已处理',
    labelWidth: 100,
  });
  const canAdjustSelectedItem = canAdjustDetailBatch && handleModal.editing?.result !== 'status_diff';
  const handleActionOptions = canAdjustSelectedItem ? PROVIDER_HANDLE_ACTION_OPTIONS : NON_FINANCIAL_HANDLE_ACTION_OPTIONS;

  async function handleSampleBill() {
    const values = (createModal.formApi.current?.getValues() ?? {}) as Partial<ReconFormValues>;
    const config = values.channelConfigId ? channelConfigById.get(values.channelConfigId) : undefined;
    if (!values.applicationId || !config || !values.billDate) {
      Toast.warning('请先选择支付应用、商户配置和账单日期');
      return;
    }
    const data = await sampleBillMutation.mutateAsync({ applicationId: values.applicationId, channel: config.channel, channelConfigId: config.id, currency: 'CNY', billDate: formatDateForApi(values.billDate) });
    createModal.formApi.current?.setValue('billText', data.billText);
    Toast.success('模拟账单已生成');
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync({ params: { id } });
    Toast.success('删除成功');
  }

  function openItems(record: PaymentReconBatch) {
    setDetailBatch(record);
    setItemResult('');
    setItemHandleStatus('');
    setItemPage(1);
  }

  function openCreate() {
    setSelectedAppId(null);
    createModal.openCreate();
  }

  function handleItemResultChange(value: string | undefined) {
    setItemResult(value);
    setItemPage(1);
  }

  function handleItemHandleStatusChange(value: string | undefined) {
    setItemHandleStatus(value);
    setItemPage(1);
  }

  const columns: ColumnProps<PaymentReconBatch>[] = [
    copyableNoColumn('批次号', 'batchNo'),
    { title: '支付应用', dataIndex: 'appId', minWidth: 200, render: (v: number) => renderEllipsis(appById.get(v)?.name ?? `应用 #${v}`) },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    {
      title: '商户配置', dataIndex: 'channelConfigId', width: 220,
      render: (v: number) => renderEllipsis(channelConfigById.get(v)?.name ?? `配置 #${v}`),
    },
    { title: '币种', dataIndex: 'currency', width: 80 },
    dateColumn('账单日期', 'billDate'),
    { title: '账单来源', dataIndex: 'source', width: 130, render: (v: PaymentReconSource) => <Tag color={SOURCE_COLOR[v]}>{PAYMENT_RECON_SOURCE_LABELS[v]}</Tag> },
    { title: '本地笔数/金额', dataIndex: 'localCount', width: 150, align: 'right', render: (_: unknown, r: PaymentReconBatch) => `${r.localCount} / ${yuan(r.localAmount)}` },
    { title: '渠道笔数/金额', dataIndex: 'channelCount', width: 150, align: 'right', render: (_: unknown, r: PaymentReconBatch) => `${r.channelCount} / ${yuan(r.channelAmount)}` },
    { title: '匹配数', dataIndex: 'matchedCount', width: 90, align: 'right' },
    { title: '差异数', dataIndex: 'diffCount', width: 90, align: 'right', render: (v: number) => <Typography.Text type={v > 0 ? 'danger' : 'tertiary'}>{v}</Typography.Text> },
    dateTimeColumn('创建时间', 'createdAt'),
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentReconStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_RECON_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentReconBatch>({
      width: 150,
      actions: (r) => [
        {
          key: 'items',
          label: '明细',
          onClick: () => openItems(r),
        },
        ...(hasPermission('payment:recon:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              content: '删除后不可恢复',
              onOk: () => handleDelete(r.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  const itemColumns: ColumnProps<PaymentReconItem>[] = [
    copyableNoColumn('订单号', 'orderNo'),
    copyableNoColumn('渠道交易号', 'channelTradeNo', { width: 300 }),
    { title: '本地金额', dataIndex: 'localAmount', width: 110, align: 'right', render: (v: number | null) => (v == null ? '-' : yuan(v)) },
    { title: '渠道金额', dataIndex: 'channelAmount', width: 110, align: 'right', render: (v: number | null) => (v == null ? '-' : yuan(v)) },
    {
      title: '状态（本地/渠道）', dataIndex: 'localStatus', width: 170,
      render: (_: unknown, r: PaymentReconItem) => `${r.localStatus || '—'} / ${r.channelStatus || '—'}`,
    },
    { title: '结果', dataIndex: 'result', width: 120, render: (v: PaymentReconResult) => <Tag color={RESULT_COLOR[v]}>{PAYMENT_RECON_RESULT_LABELS[v]}</Tag> },
    {
      title: '处理状态', dataIndex: 'handleStatus', width: 110,
      render: (v: PaymentReconHandleStatus | null, r: PaymentReconItem) => {
        if (v == null) return <Typography.Text type="tertiary">无需处理</Typography.Text>;
        const tag = <Tag color={HANDLE_COLOR[v]}>{PAYMENT_RECON_HANDLE_STATUS_LABELS[v]}</Tag>;
        return r.handleRemark ? <Typography.Text ellipsis={{ showTooltip: { opts: { content: r.handleRemark } } }}>{tag}</Typography.Text> : tag;
      },
    },
    { title: '原始备注', dataIndex: 'remark', width: 150, render: renderEllipsis },
    { title: '处理备注', dataIndex: 'handleRemark', minWidth: 200, render: renderEllipsis },
    createOperationColumn<PaymentReconItem>({
      width: 100,
      actions: (r) => [
        ...(canHandle && r.handleStatus === 'pending' ? [{
          key: 'handle',
          label: '处理',
          onClick: () => handleModal.openEdit(r),
        }] : []),
      ],
    }),
  ];

  const renderChannelFilter = () => (
    <FilterSelect
      placeholder="全部渠道"
      items={PAYMENT_CHANNEL_OPTIONS}
      value={draftParams.channel}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: v }))}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={PAYMENT_RECON_STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateButton = () => hasPermission('payment:recon:create') ? (
    <CreateButton onClick={openCreate}>新建对账</CreateButton>
  ) : null;
  const renderAutoButton = () => hasPermission('payment:recon:create') ? (
    <Button type="primary" icon={<CloudDownload size={14} />} onClick={autoModal.openCreate}>自动拉取</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderAutoButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderSearchButton()}
            {renderAutoButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
          </>
        )}
        filterTitle="对账批次筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
      />

      <AppModal {...createModal.modalProps} title="新建对账" width={720}>
        <Form key={createModal.formKey} {...createModal.formProps}>
          <Form.Select
            field="applicationId"
            label="支付应用"
            style={{ width: '100%' }}
            optionList={appOptions}
            filter
            loading={appLookupQuery.isFetching}
            onChange={(value) => {
              setSelectedAppId((value as number | undefined) ?? null);
              createModal.formApi.current?.setValue('channelConfigId', undefined);
            }}
            rules={[{ required: true, message: '请选择启用的支付应用' }]}
          />
          <Form.Select
            field="channelConfigId"
            label="商户配置"
            style={{ width: '100%' }}
            optionList={merchantConfigOptions}
            loading={channelConfigsQuery.isFetching}
            rules={[{ required: true, message: '请选择启用的商户配置' }]}
          />
          <Form.Select field="currency" label="币种" style={{ width: '100%' }} optionList={[{ value: 'CNY', label: 'CNY · 人民币' }]} disabled rules={[{ required: true, message: '请选择币种' }]} />
          <Form.DatePicker field="billDate" label="账单日期" type="date" style={{ width: '100%' }} rules={[{ required: true, message: '请选择账单日期' }]} />
          <Button type="tertiary" loading={sampleBillMutation.isPending} onClick={handleSampleBill} style={{ marginLeft: 100, marginBottom: 12 }}>生成模拟账单</Button>
          <Form.TextArea field="billText" label="账单内容" rows={8} placeholder="订单号,渠道交易号,金额(分),状态" rules={[{ required: true, message: '请输入账单内容' }]} />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      {/* 明细用抽屉而非全宽 Modal：保留批次列表上下文，与订单/投诉详情形态统一 */}
      <SideSheet title={`对账明细${detailBatch ? `（${detailBatch.batchNo}）` : ''}`} visible={!!detailBatch} onCancel={() => setDetailBatch(null)} width={760} closeOnEsc>
        <Spin spinning={itemsQuery.isFetching}>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
            <FilterSelect
              placeholder="全部结果"
              items={PAYMENT_RECON_RESULT_OPTIONS}
              value={itemResult}
              onChange={handleItemResultChange}
              width={180}
            />
            <FilterSelect
              placeholder="全部处理状态"
              items={PAYMENT_RECON_HANDLE_STATUS_OPTIONS}
              value={itemHandleStatus}
              onChange={handleItemHandleStatusChange}
              width={160}
            />
          </div>
          <ConfigurableTable
            bordered columns={itemColumns} dataSource={itemsData} loading={itemsQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void itemsQuery.refetch()} refreshLoading={itemsQuery.isFetching} pagination={buildItemPagination(itemsTotal)}
          />
        </Spin>
      </SideSheet>

      <AppModal {...autoModal.modalProps} title="自动拉取渠道账单对账" width={480}>
        <Form key={autoModal.formKey} {...autoModal.formProps}>
            <Form.Select field="channel" label="应用与商户配置" style={{ width: '100%' }} optionList={autoOptions} loading={channelConfigsQuery.isFetching || appLookupQuery.isFetching} rules={[{ required: true, message: '请选择应用与商户配置' }]} />
          <Form.DatePicker field="billDate" label="账单日期" type="date" style={{ width: '100%' }} rules={[{ required: true, message: '请选择账单日期' }]} />
          <Typography.Text type="tertiary" size="small">沙箱渠道生成模拟账单演示闭环；生产微信渠道自动下载交易账单，支付宝暂需手动上传。</Typography.Text>
        </Form>
      </AppModal>

      <AppModal {...handleModal.modalProps} title={`处理差异${handleModal.editing?.orderNo ? `（${handleModal.editing.orderNo}）` : ''}`} width={520}>
        <Form key={handleModal.formKey} {...handleModal.formProps}>
          <Typography.Paragraph type="tertiary" size="small" style={{ marginBottom: 12 }}>
            {canAdjustSelectedItem
              ? '渠道下载账单可在人工核验后直接调账；该操作会立即生成资金凭证。'
              : canAdjustDetailBatch
                ? '该差异没有可自动计算的调账金额，只能挂账归档或忽略。'
                : '人工上传或沙箱模拟账单仅用于差异核验，不允许自动入账；挂账为终态，请在备注中记录人工核验依据。'}
          </Typography.Paragraph>
          <Form.Select field="action" label="处理方式" style={{ width: '100%' }} optionList={handleActionOptions} rules={[{ required: true, message: '请选择处理方式' }]} />
          <Form.TextArea
            field="remark"
            label="处理备注"
            autosize
            rows={2}
            maxCount={256}
            placeholder="请填写核实过程和处理依据"
            rules={[
              { required: true, message: '请填写处理备注' },
              { validator: (_rule: unknown, value: unknown) => Boolean(String(value ?? '').trim()), message: '处理备注不能只包含空格' },
            ]}
          />
        </Form>
      </AppModal>
    </div>
  );
}
