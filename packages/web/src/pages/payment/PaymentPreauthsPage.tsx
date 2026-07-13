import { useState, useRef } from 'react';
import { formatYuan } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Form, Input, Modal, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  paymentPreauthKeys,
  useCapturePaymentPreauth,
  useCreatePaymentPreauth,
  usePaymentPreauthList,
  useReleasePaymentPreauth,
} from '@/hooks/queries/payment-preauths';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_PREAUTH_STATUS_LABELS, PAYMENT_PREAUTH_STATUS_OPTIONS } from '@zenith/shared';
import type { PaymentChannel, PaymentPreauth, PaymentPreauthStatus } from '@zenith/shared';

const yuan = formatYuan;
const STATUS_COLOR = { pending: 'grey', frozen: 'blue', captured: 'green', released: 'teal', failed: 'red' } as const satisfies Record<PaymentPreauthStatus, string>;
const channelOptions = Object.entries(PAYMENT_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
const PREAUTH_METHOD_OPTIONS = [
  { value: 'wechat_preauth', label: '微信预授权' },
  { value: 'alipay_preauth', label: '支付宝预授权' },
];

interface PreauthFormValues { payMethod: string; payerAccount: string; subject: string; amountYuan: number; bizType?: string; remark?: string; }

export default function PaymentPreauthsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canManage = hasPermission('payment:preauth:manage');
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [submittedParams, setSubmittedParams] = useState({ keyword: '', status: '', channel: '' });
  const [modalVisible, setModalVisible] = useState(false);
  const [captureTarget, setCaptureTarget] = useState<PaymentPreauth | null>(null);
  const [captureAmountYuan, setCaptureAmountYuan] = useState('');

  const listQuery = usePaymentPreauthList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    channel: submittedParams.channel || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const createMutation = useCreatePaymentPreauth();
  const captureMutation = useCapturePaymentPreauth();
  const releaseMutation = useReleasePaymentPreauth();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams({ keyword, status, channel });
    void queryClient.invalidateQueries({ queryKey: paymentPreauthKeys.lists });
  };
  const handleReset = () => {
    setKeyword(''); setStatus(''); setChannel('');
    setPage(1);
    setSubmittedParams({ keyword: '', status: '', channel: '' });
    void queryClient.invalidateQueries({ queryKey: paymentPreauthKeys.lists });
  };

  async function handleCreate() {
    let values: PreauthFormValues;
    try { values = (await formApi.current?.validate()) as PreauthFormValues; } catch { throw new Error('validation'); }
    const res = await createMutation.mutateAsync({
      payMethod: values.payMethod,
      payerAccount: values.payerAccount,
      subject: values.subject,
      frozenAmount: Math.round(values.amountYuan * 100),
      bizType: values.bizType || undefined,
      remark: values.remark || undefined,
    });
    if (res.status === 'frozen') Toast.success('冻结成功');
    else if (res.status === 'failed') Toast.error(`冻结失败：${res.errorMessage ?? '未知原因'}`);
    else Toast.info('冻结请求已受理');
    setModalVisible(false);
  }

  function openCapture(r: PaymentPreauth) {
    setCaptureAmountYuan('');
    setCaptureTarget(r);
  }

  async function handleCaptureOk() {
    if (!captureTarget) return;
    const amount = captureAmountYuan.trim() ? Math.round(Number(captureAmountYuan) * 100) : undefined;
    if (captureAmountYuan.trim() && (!Number.isFinite(amount) || (amount as number) <= 0)) {
      Toast.warning('转支付金额格式不正确');
      return;
    }
    if (amount != null && amount > captureTarget.frozenAmount) {
      Toast.warning('转支付金额不能超过冻结金额');
      return;
    }
    const res = await captureMutation.mutateAsync({ id: captureTarget.id, captureAmount: amount });
    Toast.success(`转支付成功（订单 ${res.captureOrderNo}）`);
    setCaptureTarget(null);
  }

  function handleRelease(r: PaymentPreauth) {
    Modal.confirm({
      title: '解冻该预授权？',
      content: `将全额释放冻结资金 ${yuan(r.frozenAmount)}`,
      onOk: async () => {
        await releaseMutation.mutateAsync(r.id);
        Toast.success('已解冻');
      },
    });
  }

  const columns: ColumnProps<PaymentPreauth>[] = [
    { title: '预授权单号', dataIndex: 'preauthNo', width: 190, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 170 }}>{v}</Typography.Text> },
    { title: '渠道', dataIndex: 'channel', width: 90, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] },
    { title: '冻结事由', dataIndex: 'subject', width: 180, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v}</Typography.Text> },
    { title: '付款人', dataIndex: 'payerAccount', width: 150, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 130 }}>{v}</Typography.Text> },
    { title: '冻结金额', dataIndex: 'frozenAmount', width: 110, render: (v: number) => yuan(v) },
    { title: '转支付金额', dataIndex: 'capturedAmount', width: 110, render: (v: number | null) => (v == null ? '-' : yuan(v)) },
    { title: '转支付订单', dataIndex: 'captureOrderNo', width: 180, render: (v: string | null) => (v ? <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 160 }}>{v}</Typography.Text> : '-') },
    { title: '冻结时间', dataIndex: 'frozenAt', width: 170, render: (v: string | null) => (v ? formatDateTime(v) : '-') },
    createdAtColumn as ColumnProps<PaymentPreauth>,
    { title: '状态', dataIndex: 'status', width: 95, fixed: 'right', render: (v: PaymentPreauthStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_PREAUTH_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentPreauth>({
      width: 130,
      actions: (r) => (canManage && r.status === 'frozen' ? [{
        key: 'capture',
        label: '转支付',
        onClick: () => openCapture(r),
      }, {
        key: 'release',
        label: '解冻',
        danger: true,
        onClick: () => handleRelease(r),
      }] : []),
    }),
  ];

  const renderKeywordSearch = () => (
    <Input prefix={<Search size={14} />} placeholder="预授权单号/付款人/事由..." value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={status || undefined} onChange={(v) => setStatus((v as string) ?? '')} showClear style={{ width: 120 }} optionList={PAYMENT_PREAUTH_STATUS_OPTIONS} />
  );
  const renderChannelFilter = () => (
    <Select placeholder="全部渠道" value={channel || undefined} onChange={(v) => setChannel((v as string) ?? '')} showClear style={{ width: 120 }} optionList={channelOptions} />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => canManage ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => setModalVisible(true)}>发起冻结</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderChannelFilter()}
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
            {renderStatusFilter()}
            {renderChannelFilter()}
          </>
        )}
        filterTitle="预授权筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
      />

      <AppModal title="发起预授权冻结" visible={modalVisible} onOk={handleCreate} onCancel={() => setModalVisible(false)} okButtonProps={{ loading: createMutation.isPending }} width={520} closeOnEsc>
        <Banner type="warning" closeIcon={null} style={{ marginBottom: 16 }}
          description="资金冻结操作（押金场景）：冻结成功计入渠道账户冻结余额，可转支付或解冻；沙箱渠道即时生效。" />
        <Form key={modalVisible ? 'new' : 'closed'} getFormApi={(api) => { formApi.current = api; }} initValues={{ payMethod: 'wechat_preauth' }} labelPosition="left" labelWidth={110}>
          <Form.Select field="payMethod" label="预授权方式" style={{ width: '100%' }} optionList={PREAUTH_METHOD_OPTIONS} rules={[{ required: true, message: '请选择方式' }]} />
          <Form.Input field="payerAccount" label="付款人账号" placeholder="微信 openid / 支付宝账号" rules={[{ required: true, message: '付款人账号不能为空' }]} />
          <Form.Input field="subject" label="冻结事由" placeholder="如：民宿押金" rules={[{ required: true, message: '冻结事由不能为空' }]} />
          <Form.InputNumber field="amountYuan" label="冻结金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '请输入冻结金额' }]} />
          <Form.Input field="bizType" label="业务类型" placeholder="可选，默认 admin_preauth" />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal title="预授权转支付" visible={captureTarget != null} onOk={handleCaptureOk} onCancel={() => setCaptureTarget(null)} okButtonProps={{ loading: captureMutation.isPending }} width={460} closeOnEsc>
        {captureTarget && (
          <>
            <Typography.Paragraph style={{ marginBottom: 12 }}>
              冻结金额 <strong>{yuan(captureTarget.frozenAmount)}</strong>，转支付后剩余部分自动解冻，并生成正式交易订单。
            </Typography.Paragraph>
            <Input placeholder={`转支付金额(元)，留空 = 全额 ${(captureTarget.frozenAmount / 100).toFixed(2)}`} value={captureAmountYuan} onChange={setCaptureAmountYuan} />
          </>
        )}
      </AppModal>
    </div>
  );
}
