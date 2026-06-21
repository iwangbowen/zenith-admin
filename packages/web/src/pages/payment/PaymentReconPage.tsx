import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Popconfirm, Select, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime, formatDateForApi } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_RECON_RESULT_LABELS, PAYMENT_RECON_STATUS_LABELS } from '@zenith/shared';
import type { PaginatedResponse, PaymentChannel, PaymentReconBatch, PaymentReconItem, PaymentReconResult, PaymentReconStatus } from '@zenith/shared';

const STATUS_COLOR = { pending: 'grey', comparing: 'blue', done: 'green', failed: 'red' } as const satisfies Record<PaymentReconStatus, string>;
const RESULT_COLOR = { matched: 'green', local_only: 'amber', channel_only: 'orange', amount_diff: 'red', status_diff: 'red' } as const satisfies Record<PaymentReconResult, string>;
const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

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
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<PaginatedResponse<PaymentReconBatch> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = searchParams;

  const [modalVisible, setModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);

  const [detailBatch, setDetailBatch] = useState<PaymentReconBatch | null>(null);
  const [itemsData, setItemsData] = useState<PaginatedResponse<PaymentReconItem> | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemResult, setItemResult] = useState('');
  const itemResultRef = useRef('');
  itemResultRef.current = itemResult;
  const {
    page: itemPage,
    pageSize: itemPageSize,
    setPage: setItemPage,
    setPageSize: setItemPageSize,
    buildPagination: buildItemPagination,
  } = usePagination();

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const active = params ?? searchRef.current;
      setLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (active.channel) query.channel = active.channel;
        if (active.status) query.status = active.status;
        const res = await request.get<PaginatedResponse<PaymentReconBatch>>(`/api/payment/recon/batches?${new URLSearchParams(query)}`);
        if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize],
  );

  const fetchItems = useCallback(
    async (p = itemPage, ps = itemPageSize, result?: string, batch?: PaymentReconBatch | null) => {
      const activeBatch = batch ?? detailBatch;
      if (!activeBatch) return;
      const activeResult = result ?? itemResultRef.current;
      setItemsLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (activeResult) query.result = activeResult;
        const res = await request.get<PaginatedResponse<PaymentReconItem>>(`/api/payment/recon/batches/${activeBatch.id}/items?${new URLSearchParams(query)}`);
        if (res.code === 0) { setItemsData(res.data); setItemPage(res.data.page); setItemPageSize(res.data.pageSize); }
      } finally {
        setItemsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemPage, itemPageSize, detailBatch],
  );

  useEffect(() => {
    void fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearchParams(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); }

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
    setSampleLoading(true);
    try {
      const query = new URLSearchParams({ channel: values.channel, billDate: formatDateForApi(values.billDate) });
      const res = await request.get<{ billText: string }>(`/api/payment/recon/sample-bill?${query}`);
      if (res.code === 0) {
        formApi.current?.setValue('billText', res.data.billText);
        Toast.success('模拟账单已生成');
      }
    } finally {
      setSampleLoading(false);
    }
  }

  async function handleOk() {
    let values: ReconFormValues;
    try {
      values = (await formApi.current?.validate()) as ReconFormValues;
    } catch {
      throw new Error('validation');
    }
    setSubmitting(true);
    try {
      const res = await request.post<PaymentReconBatch>('/api/payment/recon/batches', {
        channel: values.channel,
        billDate: formatDateForApi(values.billDate),
        billText: values.billText,
        remark: values.remark,
      });
      if (res.code === 0) {
        Toast.success('创建成功');
        closeModal();
        void fetchList();
      } else {
        throw new Error(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/payment/recon/batches/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchList();
    }
  }

  function openItems(record: PaymentReconBatch) {
    setDetailBatch(record);
    setItemsData(null);
    setItemResult('');
    setItemPage(1);
    void fetchItems(1, itemPageSize, '', record);
  }

  function handleItemResultChange(value: string) {
    setItemResult(value);
    setItemPage(1);
    void fetchItems(1, itemPageSize, value);
  }

  const columns: ColumnProps<PaymentReconBatch>[] = [
    { title: '批次号', dataIndex: 'batchNo', width: 190, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 170 }}>{v}</Typography.Text> },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={v === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '账单日期', dataIndex: 'billDate', width: 120 },
    { title: '本地笔数/金额', dataIndex: 'localCount', width: 150, render: (_: unknown, r: PaymentReconBatch) => `${r.localCount} / ${yuan(r.localAmount)}` },
    { title: '渠道笔数/金额', dataIndex: 'channelCount', width: 150, render: (_: unknown, r: PaymentReconBatch) => `${r.channelCount} / ${yuan(r.channelAmount)}` },
    { title: '匹配数', dataIndex: 'matchedCount', width: 90 },
    { title: '差异数', dataIndex: 'diffCount', width: 90, render: (v: number) => <Typography.Text type={v > 0 ? 'danger' : 'tertiary'}>{v}</Typography.Text> },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentReconStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_RECON_STATUS_LABELS[v]}</Tag> },
    {
      title: '操作', fixed: 'right', width: 130,
      render: (_: unknown, r: PaymentReconBatch) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openItems(r)}>明细</Button>
          {hasPermission('payment:recon:delete') && (
            <Popconfirm title="确定要删除吗？" content="删除后不可恢复" onConfirm={() => handleDelete(r.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const itemColumns: ColumnProps<PaymentReconItem>[] = [
    { title: '订单号', dataIndex: 'orderNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '渠道交易号', dataIndex: 'channelTradeNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '本地金额', dataIndex: 'localAmount', width: 110, render: (v: number | null) => (v == null ? '-' : yuan(v)) },
    { title: '渠道金额', dataIndex: 'channelAmount', width: 110, render: (v: number | null) => (v == null ? '-' : yuan(v)) },
    { title: '本地状态', dataIndex: 'localStatus', width: 100, render: (v: string | null) => v || '-' },
    { title: '渠道状态', dataIndex: 'channelStatus', width: 100, render: (v: string | null) => v || '-' },
    { title: '结果', dataIndex: 'result', width: 120, render: (v: PaymentReconResult) => <Tag color={RESULT_COLOR[v]}>{PAYMENT_RECON_RESULT_LABELS[v]}</Tag> },
    { title: '备注', dataIndex: 'remark', width: 180, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v || '-'}</Typography.Text> },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Select placeholder="全部渠道" value={searchParams.channel || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, channel: (v as string) ?? '' }))} showClear style={{ width: 120 }}
          optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }]} />
        <Select placeholder="全部状态" value={searchParams.status || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))} showClear style={{ width: 120 }}
          optionList={Object.entries(PAYMENT_RECON_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('payment:recon:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新建对账</Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal title="新建对账" visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: submitting }} width={720} closeOnEsc>
        <Form key={modalVisible ? 'new' : 'closed'} getFormApi={(api) => { formApi.current = api; }} initValues={{ channel: 'wechat' }} labelPosition="left" labelWidth={100}>
          <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }]} rules={[{ required: true, message: '请选择渠道' }]} />
          <Form.DatePicker field="billDate" label="账单日期" type="date" style={{ width: '100%' }} rules={[{ required: true, message: '请选择账单日期' }]} />
          <Button type="tertiary" loading={sampleLoading} onClick={handleSampleBill} style={{ marginLeft: 100, marginBottom: 12 }}>生成模拟账单</Button>
          <Form.TextArea field="billText" label="账单内容" rows={8} placeholder="订单号,渠道交易号,金额(分),状态" rules={[{ required: true, message: '请输入账单内容' }]} />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal title={`对账明细${detailBatch ? `（${detailBatch.batchNo}）` : ''}`} visible={!!detailBatch} onCancel={() => setDetailBatch(null)} footer={null} width={900} closeOnEsc>
        <Spin spinning={itemsLoading}>
          <div style={{ marginBottom: 12 }}>
            <Select placeholder="全部结果" value={itemResult || undefined} onChange={(v) => handleItemResultChange((v as string) ?? '')} showClear style={{ width: 180 }}
              optionList={Object.entries(PAYMENT_RECON_RESULT_LABELS).map(([value, label]) => ({ value, label }))} />
          </div>
          <ConfigurableTable
            bordered columns={itemColumns} dataSource={itemsData?.list ?? []} loading={itemsLoading} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void fetchItems()} refreshLoading={itemsLoading} pagination={buildItemPagination(itemsData?.total ?? 0, fetchItems)}
          />
        </Spin>
      </AppModal>
    </div>
  );
}
