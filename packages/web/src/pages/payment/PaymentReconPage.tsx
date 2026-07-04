import { useState, useRef } from 'react';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Modal, Select, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus, CloudDownload } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { formatDateTime, formatDateForApi } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
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
import { PAYMENT_CHANNEL_LABELS, PAYMENT_RECON_HANDLE_STATUS_LABELS, PAYMENT_RECON_RESULT_LABELS, PAYMENT_RECON_STATUS_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentReconBatch, PaymentReconHandleStatus, PaymentReconItem, PaymentReconResult, PaymentReconStatus } from '@zenith/shared';

const STATUS_COLOR = { pending: 'grey', comparing: 'blue', done: 'green', failed: 'red' } as const satisfies Record<PaymentReconStatus, string>;
const RESULT_COLOR = { matched: 'green', local_only: 'amber', channel_only: 'orange', amount_diff: 'red', status_diff: 'red' } as const satisfies Record<PaymentReconResult, string>;
const HANDLE_COLOR = { pending: 'amber', adjusted: 'green', suspended: 'orange', ignored: 'grey' } as const satisfies Record<PaymentReconHandleStatus, string>;
const HANDLE_ACTION_OPTIONS = [
  { value: 'adjusted', label: '已调账（差额自动记入资金台账）' },
  { value: 'suspended', label: '挂账（暂缓处理，保留差异）' },
  { value: 'ignored', label: '忽略（确认无需处理）' },
];
const yuan = formatYuan;

interface SearchParams { channel: string; status: string; }
const defaultSearch: SearchParams = { channel: '', status: '' };

interface ReconFormValues {
  channel: PaymentChannel;
  billDate: Date | string;
  billText: string;
  remark?: string;
}

export default function PaymentReconPage() {
  const { hasPermission } = usePermission();
  const canHandle = hasPermission('payment:recon:handle');
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [modalVisible, setModalVisible] = useState(false);
  const [autoModalVisible, setAutoModalVisible] = useState(false);
  const autoFormApi = useRef<FormApi | null>(null);

  const [detailBatch, setDetailBatch] = useState<PaymentReconBatch | null>(null);
  const [itemResult, setItemResult] = useState('');
  const [itemHandleStatus, setItemHandleStatus] = useState('');
  const [handlingItem, setHandlingItem] = useState<PaymentReconItem | null>(null);
  const handleFormApi = useRef<FormApi | null>(null);
  const {
    page: itemPage,
    pageSize: itemPageSize,
    setPage: setItemPage,
    buildPagination: buildItemPagination,
  } = usePagination();

  const listQuery = usePaymentReconBatchList({
    page,
    pageSize,
    channel: submittedParams.channel || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const itemsQuery = usePaymentReconItems({
    batchId: detailBatch?.id,
    page: itemPage,
    pageSize: itemPageSize,
    result: itemResult || undefined,
    handleStatus: itemHandleStatus || undefined,
  }, !!detailBatch);
  const itemsData = itemsQuery.data?.list ?? [];
  const itemsTotal = itemsQuery.data?.total ?? 0;
  const sampleBillMutation = usePaymentReconSampleBill();
  const createMutation = useCreatePaymentReconBatch();
  const deleteMutation = useDeletePaymentReconBatch();
  const handleItemMutation = useHandlePaymentReconItem();
  const autoMutation = useAutoPaymentRecon();

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentReconKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setPage(1); setSubmittedParams(defaultSearch); void queryClient.invalidateQueries({ queryKey: paymentReconKeys.lists }); }

  function openCreate() {
    setModalVisible(true);
  }
  function closeModal() {
    setModalVisible(false);
    formApi.current = null;
  }

  async function handleSampleBill() {
    const values = (formApi.current?.getValues() ?? {}) as Partial<ReconFormValues>;
    if (!values.channel || !values.billDate) {
      Toast.warning('请先选择渠道和账单日期');
      return;
    }
    const data = await sampleBillMutation.mutateAsync({ channel: values.channel, billDate: formatDateForApi(values.billDate) });
    formApi.current?.setValue('billText', data.billText);
    Toast.success('模拟账单已生成');
  }

  async function handleOk() {
    let values: ReconFormValues;
    try {
      values = (await formApi.current?.validate()) as ReconFormValues;
    } catch {
      throw new Error('validation');
    }
    await createMutation.mutateAsync({
      channel: values.channel,
      billDate: formatDateForApi(values.billDate),
      billText: values.billText,
      remark: values.remark,
    });
    Toast.success('创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  async function handleAutoOk() {
    let values: { channel: PaymentChannel; billDate: Date | string };
    try {
      values = (await autoFormApi.current?.validate()) as { channel: PaymentChannel; billDate: Date | string };
    } catch {
      throw new Error('validation');
    }
    const batch = await autoMutation.mutateAsync({ channel: values.channel, billDate: formatDateForApi(values.billDate) });
    Toast.success(`对账完成：匹配 ${batch.matchedCount} 笔，差异 ${batch.diffCount} 笔`);
    setAutoModalVisible(false);
    autoFormApi.current = null;
  }

  function openItems(record: PaymentReconBatch) {
    setDetailBatch(record);
    setItemResult('');
    setItemHandleStatus('');
    setItemPage(1);
  }

  function handleItemResultChange(value: string) {
    setItemResult(value);
    setItemPage(1);
  }

  function handleItemHandleStatusChange(value: string) {
    setItemHandleStatus(value);
    setItemPage(1);
  }

  async function handleHandleOk() {
    if (!handlingItem) return;
    let values: { action: 'adjusted' | 'suspended' | 'ignored'; remark?: string };
    try {
      values = (await handleFormApi.current?.validate()) as { action: 'adjusted' | 'suspended' | 'ignored'; remark?: string };
    } catch {
      throw new Error('validation');
    }
    await handleItemMutation.mutateAsync({ id: handlingItem.id, values: { action: values.action, remark: values.remark || undefined } });
    Toast.success('差异已处理');
    setHandlingItem(null);
    handleFormApi.current = null;
  }

  const columns: ColumnProps<PaymentReconBatch>[] = [
    { title: '批次号', dataIndex: 'batchNo', width: 190, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 170 }}>{v}</Typography.Text> },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '账单日期', dataIndex: 'billDate', width: 120 },
    { title: '本地笔数/金额', dataIndex: 'localCount', width: 150, render: (_: unknown, r: PaymentReconBatch) => `${r.localCount} / ${yuan(r.localAmount)}` },
    { title: '渠道笔数/金额', dataIndex: 'channelCount', width: 150, render: (_: unknown, r: PaymentReconBatch) => `${r.channelCount} / ${yuan(r.channelAmount)}` },
    { title: '匹配数', dataIndex: 'matchedCount', width: 90 },
    { title: '差异数', dataIndex: 'diffCount', width: 90, render: (v: number) => <Typography.Text type={v > 0 ? 'danger' : 'tertiary'}>{v}</Typography.Text> },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentReconStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_RECON_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentReconBatch>({
      width: 130,
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

  const itemColumns: ColumnProps<PaymentReconItem>[] = [
    { title: '订单号', dataIndex: 'orderNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '渠道交易号', dataIndex: 'channelTradeNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '本地金额', dataIndex: 'localAmount', width: 110, render: (v: number | null) => (v == null ? '-' : yuan(v)) },
    { title: '渠道金额', dataIndex: 'channelAmount', width: 110, render: (v: number | null) => (v == null ? '-' : yuan(v)) },
    { title: '本地状态', dataIndex: 'localStatus', width: 100, render: (v: string | null) => v || '-' },
    { title: '渠道状态', dataIndex: 'channelStatus', width: 100, render: (v: string | null) => v || '-' },
    { title: '结果', dataIndex: 'result', width: 120, render: (v: PaymentReconResult) => <Tag color={RESULT_COLOR[v]}>{PAYMENT_RECON_RESULT_LABELS[v]}</Tag> },
    {
      title: '处理状态', dataIndex: 'handleStatus', width: 110,
      render: (v: PaymentReconHandleStatus | null, r: PaymentReconItem) => {
        if (v == null) return <Typography.Text type="tertiary">无需处理</Typography.Text>;
        const tag = <Tag color={HANDLE_COLOR[v]}>{PAYMENT_RECON_HANDLE_STATUS_LABELS[v]}</Tag>;
        return r.handleRemark ? <Typography.Text ellipsis={{ showTooltip: { opts: { content: r.handleRemark } } }}>{tag}</Typography.Text> : tag;
      },
    },
    { title: '备注', dataIndex: 'remark', width: 150, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 130 }}>{v || '-'}</Typography.Text> },
    createOperationColumn<PaymentReconItem>({
      width: 90,
      actions: (r) => [
        ...(canHandle && r.handleStatus === 'pending' ? [{
          key: 'handle',
          label: '处理',
          onClick: () => setHandlingItem(r),
        }] : []),
      ],
    }),
  ];

  const renderChannelFilter = () => (
    <Select
      placeholder="全部渠道"
      value={draftParams.channel || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }, { value: 'unionpay', label: '云闪付' }]}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(PAYMENT_RECON_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('payment:recon:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新建对账</Button>
  ) : null;
  const renderAutoButton = () => hasPermission('payment:recon:create') ? (
    <Button type="primary" icon={<CloudDownload size={14} />} onClick={() => setAutoModalVisible(true)}>自动拉取</Button>
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

      <AppModal title="新建对账" visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: createMutation.isPending }} width={720} closeOnEsc>
        <Form key={modalVisible ? 'new' : 'closed'} getFormApi={(api) => { formApi.current = api; }} initValues={{ channel: 'wechat' }} labelPosition="left" labelWidth={100}>
          <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }, { value: 'unionpay', label: '云闪付' }]} rules={[{ required: true, message: '请选择渠道' }]} />
          <Form.DatePicker field="billDate" label="账单日期" type="date" style={{ width: '100%' }} rules={[{ required: true, message: '请选择账单日期' }]} />
          <Button type="tertiary" loading={sampleBillMutation.isPending} onClick={handleSampleBill} style={{ marginLeft: 100, marginBottom: 12 }}>生成模拟账单</Button>
          <Form.TextArea field="billText" label="账单内容" rows={8} placeholder="订单号,渠道交易号,金额(分),状态" rules={[{ required: true, message: '请输入账单内容' }]} />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal title={`对账明细${detailBatch ? `（${detailBatch.batchNo}）` : ''}`} visible={!!detailBatch} onCancel={() => setDetailBatch(null)} footer={null} width={1000} closeOnEsc>
        <Spin spinning={itemsQuery.isFetching}>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
            <Select placeholder="全部结果" value={itemResult || undefined} onChange={(v) => handleItemResultChange((v as string) ?? '')} showClear style={{ width: 180 }}
              optionList={Object.entries(PAYMENT_RECON_RESULT_LABELS).map(([value, label]) => ({ value, label }))} />
            <Select placeholder="全部处理状态" value={itemHandleStatus || undefined} onChange={(v) => handleItemHandleStatusChange((v as string) ?? '')} showClear style={{ width: 160 }}
              optionList={Object.entries(PAYMENT_RECON_HANDLE_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          </div>
          <ConfigurableTable
            bordered columns={itemColumns} dataSource={itemsData} loading={itemsQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void itemsQuery.refetch()} refreshLoading={itemsQuery.isFetching} pagination={buildItemPagination(itemsTotal)}
          />
        </Spin>
      </AppModal>

      <AppModal title="自动拉取渠道账单对账" visible={autoModalVisible} onOk={handleAutoOk} onCancel={() => { setAutoModalVisible(false); autoFormApi.current = null; }} okButtonProps={{ loading: autoMutation.isPending }} width={480} closeOnEsc>
        <Form key={autoModalVisible ? 'auto' : 'closed'} getFormApi={(api) => { autoFormApi.current = api; }} initValues={{ channel: 'wechat' }} labelPosition="left" labelWidth={100}>
          <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }, { value: 'unionpay', label: '云闪付' }]} rules={[{ required: true, message: '请选择渠道' }]} />
          <Form.DatePicker field="billDate" label="账单日期" type="date" style={{ width: '100%' }} rules={[{ required: true, message: '请选择账单日期' }]} />
          <Typography.Text type="tertiary" size="small">沙箱渠道生成模拟账单演示闭环；生产微信渠道自动下载交易账单，支付宝暂需手动上传。</Typography.Text>
        </Form>
      </AppModal>

      <AppModal title={`处理差异${handlingItem?.orderNo ? `（${handlingItem.orderNo}）` : ''}`} visible={!!handlingItem} onOk={handleHandleOk} onCancel={() => { setHandlingItem(null); handleFormApi.current = null; }} okButtonProps={{ loading: handleItemMutation.isPending }} width={520} closeOnEsc>
        <Form key={handlingItem?.id ?? 'closed'} getFormApi={(api) => { handleFormApi.current = api; }} initValues={{ action: 'adjusted' }} labelPosition="left" labelWidth={100}>
          <Form.Select field="action" label="处理方式" style={{ width: '100%' }} optionList={HANDLE_ACTION_OPTIONS} rules={[{ required: true, message: '请选择处理方式' }]} />
          <Form.TextArea field="remark" label="处理备注" autosize rows={2} placeholder="可选，如：渠道账单延迟，已人工核实" />
        </Form>
      </AppModal>
    </div>
  );
}
