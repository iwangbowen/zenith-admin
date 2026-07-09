import { useState, useRef } from 'react';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Form, Input, Modal, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, SendHorizontal } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  paymentTransferKeys,
  useCreatePaymentTransfer,
  usePaymentTransferList,
  usePaymentTransferSummary,
  useQueryPaymentTransfer,
  useRetryPaymentTransfer,
} from '@/hooks/queries/payment-transfers';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_TRANSFER_STATUS_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentTransfer, PaymentTransferStatus } from '@zenith/shared';

const yuan = formatYuan;
const STATUS_COLOR = { pending: 'grey', processing: 'blue', success: 'green', failed: 'red' } as const satisfies Record<PaymentTransferStatus, string>;

interface SearchParams { keyword: string; channel: string; status: string; }
const defaultSearch: SearchParams = { keyword: '', channel: '', status: '' };

interface TransferFormValues {
  channel: PaymentChannel;
  receiverAccount: string;
  receiverName?: string;
  amountYuan: number;
  remark?: string;
}

export default function PaymentTransfersPage() {
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('payment:transfer:create');
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);
  const [modalVisible, setModalVisible] = useState(false);

  const listQuery = usePaymentTransferList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    channel: submittedParams.channel || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const summaryQuery = usePaymentTransferSummary();
  const summary = summaryQuery.data ?? null;
  const createMutation = useCreatePaymentTransfer();
  const queryMutation = useQueryPaymentTransfer();
  const retryMutation = useRetryPaymentTransfer();

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentTransferKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setPage(1); setSubmittedParams(defaultSearch); void queryClient.invalidateQueries({ queryKey: paymentTransferKeys.lists }); }

  async function handleOk() {
    let values: TransferFormValues;
    try {
      values = (await formApi.current?.validate()) as TransferFormValues;
    } catch {
      throw new Error('validation');
    }
    const transfer = await createMutation.mutateAsync({
      channel: values.channel,
      receiverAccount: values.receiverAccount,
      receiverName: values.receiverName || undefined,
      amount: Math.round(values.amountYuan * 100),
      remark: values.remark || undefined,
    });
    if (transfer.status === 'failed') {
      Toast.error(`渠道转账失败：${transfer.failReason ?? '未知原因'}，可在列表中重试`);
    } else {
      Toast.success(transfer.status === 'success' ? '转账成功' : '转账已受理，处理中');
    }
    setModalVisible(false);
    formApi.current = null;
  }

  async function handleQuery(id: number) {
    const t = await queryMutation.mutateAsync(id);
    Toast.info(`当前状态：${PAYMENT_TRANSFER_STATUS_LABELS[t.status]}`);
  }

  async function handleRetry(id: number) {
    const t = await retryMutation.mutateAsync(id);
    if (t.status === 'failed') Toast.error(`重试仍失败：${t.failReason ?? '未知原因'}`);
    else Toast.success(t.status === 'success' ? '转账成功' : '已重新受理');
  }

  const columns: ColumnProps<PaymentTransfer>[] = [
    { title: '转账单号', dataIndex: 'transferNo', width: 190, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 170 }}>{v}</Typography.Text> },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '收款账号', dataIndex: 'receiverAccount', width: 180, render: (v: string, r: PaymentTransfer) => (
      <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{r.receiverName ? `${r.receiverName}（${v}）` : v}</Typography.Text>
    ) },
    { title: '金额', dataIndex: 'amount', width: 110, render: (v: number) => <Typography.Text type="danger">{yuan(v)}</Typography.Text> },
    { title: '渠道单号', dataIndex: 'channelTransferNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '失败原因', dataIndex: 'failReason', width: 180, render: (v: string | null) => (v ? <Typography.Text type="danger" ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v}</Typography.Text> : '-') },
    { title: '备注', dataIndex: 'remark', width: 140, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{v || '-'}</Typography.Text> },
    { title: '操作人', dataIndex: 'operatorName', width: 110, render: (v: string | null) => v || '-' },
    { title: '完成时间', dataIndex: 'finishedAt', width: 170, render: (v: string | null) => (v ? formatDateTime(v) : '-') },
    createdAtColumn as ColumnProps<PaymentTransfer>,
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (v: PaymentTransferStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_TRANSFER_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentTransfer>({
      width: 130,
      actions: (r) => [
        ...(r.status === 'processing' || r.status === 'failed' ? [{
          key: 'query',
          label: '查单',
          onClick: () => void handleQuery(r.id),
        }] : []),
        ...(canCreate && r.status === 'failed' && !r.channelTransferNo && r.attempts < 3 ? [{
          key: 'retry',
          label: '重试',
          onClick: () => {
            Modal.confirm({
              title: '确认重试转账？',
              content: `将向 ${r.receiverAccount} 重新发起 ${yuan(r.amount)} 转账`,
              onOk: () => handleRetry(r.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input prefix={<Search size={14} />} placeholder="转账单号 / 收款账号..." value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
  );
  const renderChannelFilter = () => (
    <Select placeholder="全部渠道" value={draftParams.channel || undefined} onChange={(v) => setDraftParams((p) => ({ ...p, channel: (v as string) ?? '' }))}
      showClear style={{ width: 120 }} optionList={PAYMENT_CHANNEL_OPTIONS} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={draftParams.status || undefined} onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear style={{ width: 120 }} optionList={Object.entries(PAYMENT_TRANSFER_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => canCreate ? (
    <Button type="primary" icon={<SendHorizontal size={14} />} onClick={() => setModalVisible(true)}>发起转账</Button>
  ) : null;

  const summaryText = summary
    ? `累计转出 ${yuan(summary.totalAmount)}（成功 ${summary.successCount} 笔 · 处理中 ${summary.processingCount} 笔 · 失败 ${summary.failedCount} 笔）`
    : '';

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderChannelFilter()}
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
        mobileFilters={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
          </>
        )}
        filterTitle="转账单筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {summaryText && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="tertiary">{summaryText}</Typography.Text>
        </div>
      )}

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => { void listQuery.refetch(); void summaryQuery.refetch(); }} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
      />

      <AppModal title="发起转账" visible={modalVisible} onOk={handleOk} onCancel={() => { setModalVisible(false); formApi.current = null; }} okButtonProps={{ loading: createMutation.isPending }} width={560} closeOnEsc>
        <Banner type="warning" closeIcon={null} style={{ marginBottom: 16 }}
          description="资金流出操作：微信渠道收款账号为用户 openid（转入零钱），支付宝渠道为登录账号。沙箱渠道为模拟转账。" />
        <Form key={modalVisible ? 'new' : 'closed'} getFormApi={(api) => { formApi.current = api; }} initValues={{ channel: 'wechat' }} labelPosition="left" labelWidth={110}>
          <Form.Select field="channel" label="渠道" style={{ width: '100%' }}
            optionList={[{ value: 'wechat', label: '微信支付（零钱）' }, { value: 'alipay', label: '支付宝（账户）' }]} rules={[{ required: true, message: '请选择渠道' }]} />
          <Form.Input field="receiverAccount" label="收款账号" placeholder="微信 openid / 支付宝登录账号" rules={[{ required: true, message: '收款账号不能为空' }]} />
          <Form.Input field="receiverName" label="收款人姓名" placeholder="可选（支付宝大额建议填写校验）" />
          <Form.InputNumber field="amountYuan" label="转账金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '请输入转账金额' }]} />
          <Form.TextArea field="remark" label="转账备注" autosize rows={1} placeholder="可选，将展示给收款方" />
        </Form>
      </AppModal>
    </div>
  );
}
