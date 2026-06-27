import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Input, Modal, Select, Switch, Tabs, TabPane, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_SHARING_RECEIVER_TYPE_LABELS, PAYMENT_SHARING_ORDER_STATUS_LABELS } from '@zenith/shared';
import type { PaginatedResponse, PaymentSharingOrder, PaymentSharingOrderStatus, PaymentSharingReceiver, PaymentSharingReceiverType } from '@zenith/shared';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const receiverTypeOptions = Object.entries(PAYMENT_SHARING_RECEIVER_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const ORDER_STATUS_COLOR = { pending: 'grey', processing: 'blue', success: 'green', failed: 'red' } as const satisfies Record<PaymentSharingOrderStatus, string>;

interface ReceiverFormValues { name: string; receiverType: PaymentSharingReceiverType; account: string; ratioPercent?: number; status?: 'enabled' | 'disabled'; remark?: string; }
interface DispatchFormValues { orderNo: string; receiverId: number; amountYuan?: number; remark?: string; }

export default function PaymentSharingPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('payment:sharing:manage');
  const canDispatch = hasPermission('payment:sharing:dispatch');
  const receiverFormApi = useRef<FormApi | null>(null);
  const dispatchFormApi = useRef<FormApi | null>(null);
  const [activeTab, setActiveTab] = useState<'receivers' | 'orders'>('receivers');

  // ── 接收方 ──
  const [receiverData, setReceiverData] = useState<PaginatedResponse<PaymentSharingReceiver> | null>(null);
  const [receiverLoading, setReceiverLoading] = useState(false);
  const { page: rPage, pageSize: rPageSize, setPage: setRPage, setPageSize: setRPageSize, buildPagination: buildRPagination } = usePagination();
  const [receiverKeyword, setReceiverKeyword] = useState('');
  const receiverKeywordRef = useRef('');
  receiverKeywordRef.current = receiverKeyword;
  const [receiverModal, setReceiverModal] = useState(false);
  const [editingReceiver, setEditingReceiver] = useState<PaymentSharingReceiver | null>(null);
  const [receiverSubmitting, setReceiverSubmitting] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  // ── 分账单 ──
  const [orderData, setOrderData] = useState<PaginatedResponse<PaymentSharingOrder> | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const { page: oPage, pageSize: oPageSize, setPage: setOPage, setPageSize: setOPageSize, buildPagination: buildOPagination } = usePagination();
  const [orderKeyword, setOrderKeyword] = useState('');
  const [orderStatus, setOrderStatus] = useState('');
  const orderSearchRef = useRef({ keyword: '', status: '' });
  orderSearchRef.current = { keyword: orderKeyword, status: orderStatus };
  const [dispatchModal, setDispatchModal] = useState(false);
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
  const [enabledReceivers, setEnabledReceivers] = useState<PaymentSharingReceiver[]>([]);

  const fetchReceivers = useCallback(
    async (p = rPage, ps = rPageSize, keyword?: string) => {
      const kw = keyword ?? receiverKeywordRef.current;
      setReceiverLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (kw) query.keyword = kw;
        const res = await request.get<PaginatedResponse<PaymentSharingReceiver>>(`/api/payment/sharing/receivers?${new URLSearchParams(query)}`);
        if (res.code === 0) { setReceiverData(res.data); setRPage(res.data.page); setRPageSize(res.data.pageSize); }
      } finally {
        setReceiverLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rPage, rPageSize],
  );

  const fetchOrders = useCallback(
    async (p = oPage, ps = oPageSize, params?: { keyword: string; status: string }) => {
      const active = params ?? orderSearchRef.current;
      setOrderLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (active.keyword) query.keyword = active.keyword;
        if (active.status) query.status = active.status;
        const res = await request.get<PaginatedResponse<PaymentSharingOrder>>(`/api/payment/sharing/orders?${new URLSearchParams(query)}`);
        if (res.code === 0) { setOrderData(res.data); setOPage(res.data.page); setOPageSize(res.data.pageSize); }
      } finally {
        setOrderLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oPage, oPageSize],
  );

  useEffect(() => {
    void fetchReceivers();
    void fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 接收方处理 ──
  function openCreateReceiver() { setEditingReceiver(null); setReceiverModal(true); }
  function openEditReceiver(r: PaymentSharingReceiver) { setEditingReceiver(r); setReceiverModal(true); }
  const receiverInit: ReceiverFormValues = editingReceiver
    ? { name: editingReceiver.name, receiverType: editingReceiver.receiverType, account: editingReceiver.account, ratioPercent: editingReceiver.ratioBps != null ? editingReceiver.ratioBps / 100 : undefined, status: editingReceiver.status, remark: editingReceiver.remark ?? '' }
    : { name: '', receiverType: 'merchant', account: '', status: 'enabled' };

  async function handleReceiverOk() {
    let values: ReceiverFormValues;
    try { values = (await receiverFormApi.current?.validate()) as ReceiverFormValues; } catch { throw new Error('validation'); }
    setReceiverSubmitting(true);
    try {
      const payload = { name: values.name, receiverType: values.receiverType, account: values.account, ratioBps: values.ratioPercent != null ? Math.round(values.ratioPercent * 100) : undefined, status: values.status, remark: values.remark || undefined };
      const res = editingReceiver
        ? await request.put<PaymentSharingReceiver>(`/api/payment/sharing/receivers/${editingReceiver.id}`, payload)
        : await request.post<PaymentSharingReceiver>('/api/payment/sharing/receivers', payload);
      if (res.code === 0) { Toast.success(editingReceiver ? '更新成功' : '创建成功'); setReceiverModal(false); setEditingReceiver(null); void fetchReceivers(); }
      else throw new Error(res.message);
    } finally {
      setReceiverSubmitting(false);
    }
  }

  function handleReceiverToggle(r: PaymentSharingReceiver, checked: boolean) {
    setTogglingIds((prev) => new Set(prev).add(r.id));
    request
      .put<PaymentSharingReceiver>(`/api/payment/sharing/receivers/${r.id}`, { status: checked ? 'enabled' : 'disabled' })
      .then((res) => { if (res.code === 0) { Toast.success(checked ? '已启用' : '已停用'); void fetchReceivers(); } })
      .finally(() => setTogglingIds((prev) => { const s = new Set(prev); s.delete(r.id); return s; }));
  }

  async function handleDeleteReceiver(id: number) {
    const res = await request.delete(`/api/payment/sharing/receivers/${id}`);
    if (res.code === 0) { Toast.success('删除成功'); void fetchReceivers(); }
  }

  // ── 分账处理 ──
  async function openDispatch() {
    const res = await request.get<PaginatedResponse<PaymentSharingReceiver>>('/api/payment/sharing/receivers?page=1&pageSize=100&status=enabled');
    if (res.code === 0) setEnabledReceivers(res.data.list.filter((r) => r.status === 'enabled'));
    setDispatchModal(true);
  }
  async function handleDispatchOk() {
    let values: DispatchFormValues;
    try { values = (await dispatchFormApi.current?.validate()) as DispatchFormValues; } catch { throw new Error('validation'); }
    setDispatchSubmitting(true);
    try {
      const res = await request.post<PaymentSharingOrder>('/api/payment/sharing/orders', {
        orderNo: values.orderNo,
        receiverId: values.receiverId,
        amount: values.amountYuan != null ? Math.round(values.amountYuan * 100) : undefined,
        remark: values.remark || undefined,
      });
      if (res.code === 0) { Toast.success('分账已发起'); setDispatchModal(false); void fetchOrders(); }
      else throw new Error(res.message);
    } finally {
      setDispatchSubmitting(false);
    }
  }

  const receiverColumns: ColumnProps<PaymentSharingReceiver>[] = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '类型', dataIndex: 'receiverType', width: 90, render: (v: PaymentSharingReceiverType) => PAYMENT_SHARING_RECEIVER_TYPE_LABELS[v] },
    { title: '账号', dataIndex: 'account', width: 200, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 180 }}>{v}</Typography.Text> },
    { title: '默认比例', dataIndex: 'ratioBps', width: 110, render: (v: number | null) => (v == null ? '-' : `${(v / 100).toFixed(2)}%`) },
    createdAtColumn as ColumnProps<PaymentSharingReceiver>,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, r: PaymentSharingReceiver) => <Switch checked={r.status === 'enabled'} loading={togglingIds.has(r.id)} disabled={!canManage} size="small" onChange={(c) => handleReceiverToggle(r, c)} />,
    },
    createOperationColumn<PaymentSharingReceiver>({
      width: 120,
      actions: (r) => [
        ...(canManage ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEditReceiver(r),
        }, {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除吗？',
              content: '删除后不可恢复',
              onOk: () => handleDeleteReceiver(r.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  const orderColumns: ColumnProps<PaymentSharingOrder>[] = [
    { title: '分账单号', dataIndex: 'sharingNo', width: 180, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 160 }}>{v}</Typography.Text> },
    { title: '订单号', dataIndex: 'orderNo', width: 180 },
    { title: '接收方', dataIndex: 'receiverName', width: 140, render: (v: string | null) => v || '-' },
    { title: '分账金额', dataIndex: 'amount', width: 110, render: (v: number) => yuan(v) },
    { title: '渠道分账号', dataIndex: 'channelSharingNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '完成时间', dataIndex: 'finishedAt', width: 170, render: (v: string | null) => (v ? formatDateTime(v) : '-') },
    createdAtColumn as ColumnProps<PaymentSharingOrder>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentSharingOrderStatus) => <Tag color={ORDER_STATUS_COLOR[v]}>{PAYMENT_SHARING_ORDER_STATUS_LABELS[v]}</Tag> },
  ];

  const handleReceiverSearch = () => {
    setRPage(1);
    void fetchReceivers(1, rPageSize);
  };
  const handleReceiverReset = () => {
    setReceiverKeyword('');
    setRPage(1);
    void fetchReceivers(1, rPageSize, '');
  };
  const handleOrderSearch = () => {
    setOPage(1);
    void fetchOrders(1, oPageSize);
  };
  const handleOrderReset = () => {
    setOrderKeyword('');
    setOrderStatus('');
    setOPage(1);
    void fetchOrders(1, oPageSize, { keyword: '', status: '' });
  };

  const renderReceiverKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="名称..."
      value={receiverKeyword}
      onChange={setReceiverKeyword}
      showClear
      style={{ width: 200 }}
      onEnterPress={handleReceiverSearch}
    />
  );
  const renderReceiverSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleReceiverSearch}>查询</Button>;
  const renderReceiverResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReceiverReset}>重置</Button>;
  const renderReceiverCreateButton = () => canManage ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreateReceiver}>新增</Button>
  ) : null;

  const renderOrderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="订单号..."
      value={orderKeyword}
      onChange={setOrderKeyword}
      showClear
      style={{ width: 200 }}
      onEnterPress={handleOrderSearch}
    />
  );
  const renderOrderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={orderStatus || undefined}
      onChange={(v) => setOrderStatus((v as string) ?? '')}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(PAYMENT_SHARING_ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );
  const renderOrderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleOrderSearch}>查询</Button>;
  const renderOrderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleOrderReset}>重置</Button>;
  const renderDispatchButton = () => canDispatch ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => void openDispatch()}>发起分账</Button>
  ) : null;

  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as 'receivers' | 'orders')} type="line" lazyRender keepDOM={false}>
        <TabPane tab="分账接收方" itemKey="receivers">
          <SearchToolbar
            primary={(
              <>
                {renderReceiverKeywordSearch()}
                {renderReceiverSearchButton()}
                {renderReceiverResetButton()}
                {renderReceiverCreateButton()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderReceiverKeywordSearch()}
                {renderReceiverSearchButton()}
                {renderReceiverCreateButton()}
              </>
            )}
          />
          <ConfigurableTable
            bordered columns={receiverColumns} dataSource={receiverData?.list ?? []} loading={receiverLoading} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void fetchReceivers()} refreshLoading={receiverLoading} pagination={buildRPagination(receiverData?.total ?? 0, fetchReceivers)}
          />
        </TabPane>
        <TabPane tab="分账单" itemKey="orders">
          <SearchToolbar
            primary={(
              <>
                {renderOrderKeywordSearch()}
                {renderOrderStatusFilter()}
                {renderOrderSearchButton()}
                {renderOrderResetButton()}
                {renderDispatchButton()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderOrderKeywordSearch()}
                {renderOrderSearchButton()}
                {renderDispatchButton()}
              </>
            )}
            mobileFilters={renderOrderStatusFilter()}
            filterTitle="分账单筛选"
            onFilterApply={handleOrderSearch}
            onFilterReset={handleOrderReset}
          />
          <ConfigurableTable
            bordered columns={orderColumns} dataSource={orderData?.list ?? []} loading={orderLoading} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void fetchOrders()} refreshLoading={orderLoading} pagination={buildOPagination(orderData?.total ?? 0, fetchOrders)}
          />
        </TabPane>
      </Tabs>

      <AppModal title={editingReceiver ? '编辑分账接收方' : '新增分账接收方'} visible={receiverModal} onOk={handleReceiverOk} onCancel={() => { setReceiverModal(false); setEditingReceiver(null); }} okButtonProps={{ loading: receiverSubmitting }} width={520} closeOnEsc>
        <Form key={editingReceiver?.id ?? 'new'} getFormApi={(api) => { receiverFormApi.current = api; }} initValues={receiverInit} labelPosition="left" labelWidth={104}>
          <Form.Input field="name" label="名称" placeholder="如：合作商户 A" rules={[{ required: true, message: '名称不能为空' }]} />
          <Form.Select field="receiverType" label="类型" style={{ width: '100%' }} optionList={receiverTypeOptions} rules={[{ required: true, message: '请选择类型' }]} />
          <Form.Input field="account" label="账号" placeholder="商户号 / 个人 openid" rules={[{ required: true, message: '账号不能为空' }]} />
          <Form.InputNumber field="ratioPercent" label="默认比例(%)" min={0} max={100} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选，发起分账时可覆盖" />
          <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal title="发起分账" visible={dispatchModal} onOk={handleDispatchOk} onCancel={() => setDispatchModal(false)} okButtonProps={{ loading: dispatchSubmitting }} width={520} closeOnEsc>
        <Form key={dispatchModal ? 'dispatch' : 'closed'} getFormApi={(api) => { dispatchFormApi.current = api; }} labelPosition="left" labelWidth={104}>
          <Form.Input field="orderNo" label="订单号" placeholder="已支付成功的支付订单号" rules={[{ required: true, message: '订单号不能为空' }]} />
          <Form.Select field="receiverId" label="接收方" style={{ width: '100%' }} rules={[{ required: true, message: '请选择接收方' }]}
            optionList={enabledReceivers.map((r) => ({ value: r.id, label: `${r.name}（${PAYMENT_SHARING_RECEIVER_TYPE_LABELS[r.receiverType]}）` }))} />
          <Form.InputNumber field="amountYuan" label="分账金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} placeholder="留空=按接收方默认比例计算" />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>
    </div>
  );
}
