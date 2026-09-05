import { useState } from 'react';
import { formatYuan } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Descriptions, Form, SideSheet, Spin, Switch, Tabs, TabPane, Tag, TextArea, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import {
  paymentSharingKeys,
  useCreatePaymentSharingOrder,
  useDeletePaymentSharingReceivers,
  useEnabledPaymentSharingReceivers,
  usePaymentSharingReversals,
  usePaymentSharingReversalDetail,
  usePaymentSharingOrders,
  usePaymentSharingReceivers,
  useQueryPaymentSharingReversal,
  useReversePaymentSharingOrder,
  useSavePaymentSharingReceiver,
} from '@/hooks/queries/payment-sharing';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_SHARING_RECEIVER_TYPE_LABELS, PAYMENT_SHARING_ORDER_STATUS_LABELS, PAYMENT_SHARING_ORDER_STATUSES, PAYMENT_SHARING_REVERSAL_STATUS_LABELS, PAYMENT_SHARING_REVERSAL_STATUSES, PAYMENT_SHARING_RECEIVER_TYPE_OPTIONS, PAYMENT_SHARING_ORDER_STATUS_OPTIONS, PAYMENT_SHARING_REVERSAL_STATUS_OPTIONS } from '@zenith/shared/payment';
import type { CreatePaymentSharingReceiverInput, DispatchPaymentSharingInput, PaymentSharingOrder, PaymentSharingOrderStatus, PaymentSharingReceiver, PaymentSharingReceiverType, PaymentSharingReversal, PaymentSharingReversalStatus } from '@zenith/shared/payment';
import { useDictItems } from '@/hooks/useDictItems';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';

import { useUrlTabState } from '@/hooks/useUrlTabState';
const yuan = formatYuan;
const receiverTypeOptions = PAYMENT_SHARING_RECEIVER_TYPE_OPTIONS;
const ORDER_STATUS_COLOR = { pending: 'grey', processing: 'blue', success: 'green', failed: 'red', reversed: 'orange' } as const satisfies Record<PaymentSharingOrderStatus, string>;
const REVERSAL_STATUS_COLOR = { processing: 'blue', unknown: 'orange', success: 'green', failed: 'red' } as const satisfies Record<PaymentSharingReversalStatus, string>;

interface ReceiverFormValues { name: string; receiverType: PaymentSharingReceiverType; account: string; ratioPercent?: number; autoShare?: boolean; status?: 'enabled' | 'disabled'; remark?: string; }
interface DispatchFormValues { orderNo: string; receiverId: number; amountYuan?: number; remark?: string; }

export default function PaymentSharingPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canManage = hasPermission('payment:sharing:manage');
  const canDispatch = hasPermission('payment:sharing:dispatch');
  const [activeTab, setActiveTab] = useUrlTabState(['receivers', 'orders', 'reversals'] as const, 'receivers');

  // ── 接收方 ──
  const { page: rPage, pageSize: rPageSize, setPage: setRPage, buildPagination: buildRPagination } = usePagination();
  const [receiverKeyword, setReceiverKeyword] = useState('');
  const [submittedReceiverKeyword, setSubmittedReceiverKeyword] = useState('');
  // ── 分账单 ──
  const { page: oPage, pageSize: oPageSize, setPage: setOPage, buildPagination: buildOPagination } = usePagination();
  const [orderKeyword, setOrderKeyword] = useState('');
  const [orderStatus, setOrderStatus] = useState<string | undefined>();
  const [submittedOrderParams, setSubmittedOrderParams] = useState<{ keyword: string; status?: string }>({ keyword: '' });
  // ── 冲正记录 ──
  const { page: vPage, pageSize: vPageSize, setPage: setVPage, buildPagination: buildVPagination } = usePagination();
  const [reversalStatus, setReversalStatus] = useState<string | undefined>();
  const [submittedReversalStatus, setSubmittedReversalStatus] = useState<string | undefined>();
  const [reverseTarget, setReverseTarget] = useState<PaymentSharingOrder | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseIdempotencyKey, setReverseIdempotencyKey] = useState('');
  const [reversalDetailTarget, setReversalDetailTarget] = useState<PaymentSharingReversal | null>(null);

  const receiverQuery = usePaymentSharingReceivers({
    page: rPage,
    pageSize: rPageSize,
    keyword: submittedReceiverKeyword || undefined,
  });
  const receiverData = receiverQuery.data?.list ?? [];
  const receiverTotal = receiverQuery.data?.total ?? 0;
  const orderQuery = usePaymentSharingOrders({
    page: oPage,
    pageSize: oPageSize,
    keyword: submittedOrderParams.keyword || undefined,
    status: enumValueOf(PAYMENT_SHARING_ORDER_STATUSES, submittedOrderParams.status),
  });
  const orderData = orderQuery.data?.list ?? [];
  const orderTotal = orderQuery.data?.total ?? 0;
  const reversalQuery = usePaymentSharingReversals({
    page: vPage,
    pageSize: vPageSize,
    status: enumValueOf(PAYMENT_SHARING_REVERSAL_STATUSES, submittedReversalStatus),
  });
  const reversalData = reversalQuery.data?.list ?? [];
  const reversalTotal = reversalQuery.data?.total ?? 0;
  const reversalDetailQuery = usePaymentSharingReversalDetail(reversalDetailTarget?.id, !!reversalDetailTarget);
  const reversalDetail = reversalDetailTarget ? (reversalDetailQuery.data ?? reversalDetailTarget) : null;
  const saveReceiverMutation = useSavePaymentSharingReceiver();
  const toggleReceiverMutation = useSavePaymentSharingReceiver();
  const deleteReceiverMutation = useDeletePaymentSharingReceivers();
  const createOrderMutation = useCreatePaymentSharingOrder();
  const reverseOrderMutation = useReversePaymentSharingOrder();
  const queryReversalMutation = useQueryPaymentSharingReversal();
  const togglingId = toggleReceiverMutation.isPending ? (toggleReceiverMutation.variables?.id ?? null) : null;

  const receiverModal = useEditModal<PaymentSharingReceiver, ReceiverFormValues, Partial<CreatePaymentSharingReceiverInput>>({
    entityName: '分账接收方',
    save: saveReceiverMutation,
    defaults: { name: '', receiverType: 'merchant', account: '', autoShare: false, status: 'enabled' },
    toValues: (record) => ({
      name: record.name,
      receiverType: record.receiverType,
      account: record.account,
      ratioPercent: record.ratioBps != null ? record.ratioBps / 100 : undefined,
      autoShare: record.autoShare,
      status: record.status,
      remark: record.remark ?? '',
    }),
    beforeSave: (values) => {
      if (values.autoShare && values.ratioPercent == null) {
        Toast.warning('开启自动分账需先设置默认比例');
        abortSubmit('validation');
      }
      return {
        name: values.name,
        receiverType: values.receiverType,
        account: values.account,
        ratioBps: values.ratioPercent != null ? Math.round(values.ratioPercent * 100) : undefined,
        autoShare: values.autoShare ?? false,
        status: values.status,
        remark: values.remark || undefined,
      };
    },
    labelWidth: 104,
  });
  const dispatchSaveMutation = {
    mutateAsync: ({ values }: { id?: number; values: DispatchPaymentSharingInput }) => createOrderMutation.mutateAsync({ body: values }),
    isPending: createOrderMutation.isPending,
  };
  const dispatchModal = useEditModal<PaymentSharingOrder, DispatchFormValues, DispatchPaymentSharingInput>({
    save: dispatchSaveMutation,
    beforeSave: (values) => ({
      orderNo: values.orderNo,
      receiverId: values.receiverId,
      amount: values.amountYuan != null ? Math.round(values.amountYuan * 100) : undefined,
      remark: values.remark || undefined,
    }),
    successMessage: () => '分账已发起',
    labelWidth: 104,
  });
  const dispatchReceiversQuery = useEnabledPaymentSharingReceivers(dispatchModal.visible);
  const dispatchReceivers = dispatchReceiversQuery.data ?? [];

  // ── 接收方处理 ──
  async function handleReceiverToggle(r: PaymentSharingReceiver, checked: boolean) {
    await toggleReceiverMutation.mutateAsync({ id: r.id, values: { status: checked ? 'enabled' : 'disabled' } });
    Toast.success(checked ? '已启用' : '已停用');
  }

  async function handleDeleteReceiver(id: number) {
    await deleteReceiverMutation.mutateAsync([id]);
    Toast.success('删除成功');
  }

  // ── 分账处理 ──
  function openDispatch() {
    dispatchModal.openCreate();
  }

  function openReverse(order: PaymentSharingOrder) {
    setReverseTarget(order);
    setReverseReason('');
    setReverseIdempotencyKey(crypto.randomUUID());
  }

  function closeReverse() {
    if (reverseOrderMutation.isPending) return;
    setReverseTarget(null);
    setReverseReason('');
    setReverseIdempotencyKey('');
  }

  function submitReverse() {
    if (!reverseTarget || !reverseIdempotencyKey) return;
    const reason = reverseReason.trim();
    if (!reason) {
      Toast.warning('请填写冲正原因');
      return;
    }
    confirmDanger({
      title: `确认冲正分账单 ${reverseTarget.sharingNo}？`,
      content: '冲正提交后将由渠道异步处理，请通过冲正记录确认最终结果。',
      onOk: async () => {
        await reverseOrderMutation.mutateAsync({ params: { id: reverseTarget.id }, headers: { 'x-idempotency-key': reverseIdempotencyKey }, body: { reason } });
        Toast.success('冲正已受理');
        setReverseTarget(null);
        setReverseReason('');
        setReverseIdempotencyKey('');
        setActiveTab('reversals');
      },
    });
  }

  async function handleQueryReversal(record: PaymentSharingReversal) {
    const result = await queryReversalMutation.mutateAsync({ params: { id: record.id } });
    if (result.status === 'success') Toast.success('查单完成，冲正已成功');
    else if (result.status === 'failed') Toast.warning('查单完成，冲正已失败');
    else Toast.info('查单完成，渠道结果仍待确认');
  }

  const receiverColumns: ColumnProps<PaymentSharingReceiver>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis },
    { title: '类型', dataIndex: 'receiverType', width: 90, render: (v: PaymentSharingReceiverType) => PAYMENT_SHARING_RECEIVER_TYPE_LABELS[v] },
    copyableNoColumn('账号', 'account', { width: 200 }),
    { title: '默认比例', dataIndex: 'ratioBps', width: 110, align: 'right', render: (v: number | null) => (v == null ? '-' : `${(v / 100).toFixed(2)}%`) },
    { title: '自动分账', dataIndex: 'autoShare', width: 100, render: (v: boolean) => (v ? <Tag color="green">自动</Tag> : <Tag color="grey">手动</Tag>) },
    createdAtColumn as ColumnProps<PaymentSharingReceiver>,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, r: PaymentSharingReceiver) => <Switch checked={r.status === 'enabled'} loading={togglingId === r.id} disabled={!canManage} size="small" onChange={(c) => void handleReceiverToggle(r, c)} />,
    },
    createOperationColumn<PaymentSharingReceiver>({
      width: 150,
      actions: (r) => [
        ...(canManage ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => receiverModal.openEdit(r),
        }, {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              content: '删除后不可恢复',
              onOk: () => handleDeleteReceiver(r.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  const orderColumns: ColumnProps<PaymentSharingOrder>[] = [
    copyableNoColumn('分账单号', 'sharingNo'),
    copyableNoColumn('订单号', 'orderNo'),
    { title: '接收方', dataIndex: 'receiverName', minWidth: 150, render: renderEllipsis },
    { title: '分账金额', dataIndex: 'amount', width: 110, align: 'right', render: (v: number) => yuan(v) },
    copyableNoColumn('渠道分账号', 'channelSharingNo', { width: 300 }),
    { title: '版本', dataIndex: 'version', width: 70, align: 'right', render: (v: number) => `v${v}` },
    dateTimeColumn('完成时间', 'finishedAt'),
    createdAtColumn as ColumnProps<PaymentSharingOrder>,
    { title: '状态', dataIndex: 'status', width: 100, render: (v: PaymentSharingOrderStatus) => <Tag color={ORDER_STATUS_COLOR[v]}>{PAYMENT_SHARING_ORDER_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentSharingOrder>({
      width: 100,
      actions: (record) => canDispatch && record.status === 'success' ? [{
        key: 'reverse',
        label: '冲正',
        danger: true,
        onClick: () => openReverse(record),
      }] : [],
    }),
  ];

  const reversalColumns: ColumnProps<PaymentSharingReversal>[] = [
    copyableNoColumn('冲正单号', 'reversalNo', { width: 210 }),
    copyableNoColumn('分账单号', 'sharingNo', { width: 210 }),
    copyableNoColumn('订单号', 'orderNo', { width: 210 }),
    { title: '冲正金额', dataIndex: 'amount', width: 110, align: 'right', render: (v: number) => yuan(v) },
    { title: '原因', dataIndex: 'reason', minWidth: 220, render: renderEllipsis },
    copyableNoColumn('渠道冲正单号', 'channelReversalNo', { width: 220 }),
    { title: '尝试/查单', width: 100, align: 'right', render: (_: unknown, record: PaymentSharingReversal) => `${record.attempts} / ${record.queryAttempts}` },
    { title: '版本', dataIndex: 'version', width: 70, align: 'right', render: (v: number) => `v${v}` },
    { title: '失败原因', dataIndex: 'errorMessage', width: 220, render: renderEllipsis },
    dateTimeColumn('完成时间', 'finishedAt'),
    createdAtColumn as ColumnProps<PaymentSharingReversal>,
    { title: '状态', dataIndex: 'status', width: 110, render: (v: PaymentSharingReversalStatus) => <Tag color={REVERSAL_STATUS_COLOR[v]}>{PAYMENT_SHARING_REVERSAL_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentSharingReversal>({
      width: 120,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => setReversalDetailTarget(record) },
        ...(canDispatch && (record.status === 'processing' || record.status === 'unknown') ? [{
          key: 'query',
          label: '查单',
          loading: queryReversalMutation.isPending && queryReversalMutation.variables?.params.id === record.id,
          onClick: () => { void handleQueryReversal(record); },
        }] : []),
      ],
    }),
  ];

  const handleReceiverSearch = () => {
    setRPage(1);
    setSubmittedReceiverKeyword(receiverKeyword);
    void queryClient.invalidateQueries({ queryKey: paymentSharingKeys.receiverLists });
  };
  const handleReceiverReset = () => {
    setReceiverKeyword('');
    setRPage(1);
    setSubmittedReceiverKeyword('');
    void queryClient.invalidateQueries({ queryKey: paymentSharingKeys.receiverLists });
  };
  const handleOrderSearch = () => {
    setOPage(1);
    setSubmittedOrderParams({ keyword: orderKeyword, status: orderStatus });
    void queryClient.invalidateQueries({ queryKey: paymentSharingKeys.orderLists });
  };
  const handleOrderReset = () => {
    setOrderKeyword('');
    setOrderStatus(undefined);
    setOPage(1);
    setSubmittedOrderParams({ keyword: '' });
    void queryClient.invalidateQueries({ queryKey: paymentSharingKeys.orderLists });
  };
  const handleReversalSearch = () => {
    setVPage(1);
    setSubmittedReversalStatus(reversalStatus);
    void queryClient.invalidateQueries({ queryKey: paymentSharingKeys.reversalLists });
  };
  const handleReversalReset = () => {
    setReversalStatus(undefined);
    setVPage(1);
    setSubmittedReversalStatus(undefined);
    void queryClient.invalidateQueries({ queryKey: paymentSharingKeys.reversalLists });
  };

  const renderReceiverKeywordSearch = () => (
    <KeywordInput placeholder="名称..." value={receiverKeyword} onChange={setReceiverKeyword} onSearch={handleReceiverSearch} width={200} />
  );
  const renderReceiverSearchButton = () => <SearchButton onClick={handleReceiverSearch} />;
  const renderReceiverResetButton = () => <ResetButton onClick={handleReceiverReset} />;
  const renderReceiverCreateButton = () => canManage ? (
    <CreateButton onClick={receiverModal.openCreate} />
  ) : null;

  const renderOrderKeywordSearch = () => (
    <KeywordInput placeholder="订单号..." value={orderKeyword} onChange={setOrderKeyword} onSearch={handleOrderSearch} width={200} />
  );
  const renderOrderStatusFilter = () => (
    <StatusSelect
      items={PAYMENT_SHARING_ORDER_STATUS_OPTIONS}
      value={orderStatus}
      onChange={setOrderStatus}
    />
  );
  const renderOrderSearchButton = () => <SearchButton onClick={handleOrderSearch} />;
  const renderOrderResetButton = () => <ResetButton onClick={handleOrderReset} />;
  const renderDispatchButton = () => canDispatch ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openDispatch}>发起分账</Button>
  ) : null;
  const renderReversalStatusFilter = () => (
    <StatusSelect
      items={PAYMENT_SHARING_REVERSAL_STATUS_OPTIONS}
      value={reversalStatus}
      onChange={setReversalStatus}
    />
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as 'receivers' | 'orders' | 'reversals')} type="line" lazyRender keepDOM={false}>
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
            bordered columns={receiverColumns} dataSource={receiverData} loading={receiverQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void receiverQuery.refetch()} refreshLoading={receiverQuery.isFetching} pagination={buildRPagination(receiverTotal)}
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
            bordered columns={orderColumns} dataSource={orderData} loading={orderQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void orderQuery.refetch()} refreshLoading={orderQuery.isFetching} pagination={buildOPagination(orderTotal)}
          />
        </TabPane>
        <TabPane tab="冲正记录" itemKey="reversals">
          <SearchToolbar
            primary={(
              <>
                {renderReversalStatusFilter()}
                <SearchButton onClick={handleReversalSearch} />
                <ResetButton onClick={handleReversalReset} />
              </>
            )}
            mobilePrimary={<SearchButton onClick={handleReversalSearch} />}
            mobileFilters={renderReversalStatusFilter()}
            filterTitle="冲正记录筛选"
            onFilterApply={handleReversalSearch}
            onFilterReset={handleReversalReset}
          />
          <ConfigurableTable
            bordered columns={reversalColumns} dataSource={reversalData} loading={reversalQuery.isFetching} rowKey="id" size="small" empty="暂无冲正记录"
            onRefresh={() => void reversalQuery.refetch()} refreshLoading={reversalQuery.isFetching} pagination={buildVPagination(reversalTotal)}
          />
        </TabPane>
      </Tabs>

      <AppModal {...receiverModal.modalProps} width={520}>
        <Form key={receiverModal.formKey} {...receiverModal.formProps}>
          <Form.Input field="name" label="名称" placeholder="如：合作商户 A" rules={[{ required: true, message: '名称不能为空' }]} />
          <Form.Select field="receiverType" label="类型" style={{ width: '100%' }} optionList={receiverTypeOptions} rules={[{ required: true, message: '请选择类型' }]} />
          <Form.Input field="account" label="账号" placeholder="商户号 / 个人 openid" rules={[{ required: true, message: '账号不能为空' }]} />
          <Form.InputNumber field="ratioPercent" label="默认比例(%)" min={0} max={100} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选，发起分账时可覆盖" />
          <Form.Switch field="autoShare" label="自动分账" extraText="开启后支付成功将按默认比例自动向该接收方发起分账" />
          <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal {...dispatchModal.modalProps} title="发起分账" width={520}>
        <Form key={dispatchModal.formKey} {...dispatchModal.formProps}>
          <Form.Input field="orderNo" label="订单号" placeholder="已支付成功的支付订单号" rules={[{ required: true, message: '订单号不能为空' }]} />
          <Form.Select field="receiverId" label="接收方" style={{ width: '100%' }} rules={[{ required: true, message: '请选择接收方' }]}
            optionList={dispatchReceivers.map((r) => ({ value: r.id, label: `${r.name}（${PAYMENT_SHARING_RECEIVER_TYPE_LABELS[r.receiverType]}）` }))} />
          <Form.InputNumber field="amountYuan" label="分账金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} placeholder="留空=按接收方默认比例计算" />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal
        title="发起分账冲正"
        visible={!!reverseTarget}
        onCancel={closeReverse}
        onOk={submitReverse}
        okText="继续确认"
        okButtonProps={{ type: 'danger', theme: 'solid', loading: reverseOrderMutation.isPending }}
        width={520}
        closeOnEsc
      >
        {reverseTarget && (
          <Form labelPosition="left" labelWidth={100}>
            <Form.Slot label="分账单号">{reverseTarget.sharingNo}</Form.Slot>
            <Form.Slot label="冲正金额">{yuan(reverseTarget.amount)}</Form.Slot>
            <Form.Slot label="当前版本">v{reverseTarget.version}</Form.Slot>
            <Form.Slot label="冲正原因">
              <TextArea value={reverseReason} onChange={setReverseReason} maxCount={256} autosize rows={3} placeholder="请填写冲正依据（必填）" />
            </Form.Slot>
          </Form>
        )}
      </AppModal>

      <SideSheet
        title={reversalDetail ? `分账冲正 · ${reversalDetail.reversalNo}` : '分账冲正详情'}
        visible={!!reversalDetailTarget}
        onCancel={() => setReversalDetailTarget(null)}
        width={680}
        closeOnEsc
      >
        <Spin spinning={reversalDetailQuery.isFetching}>
          {reversalDetail && (
            <Descriptions
              align="plain"
              layout="horizontal"
              column={2}
              data={[
                { key: '冲正单号', value: reversalDetail.reversalNo, span: 2 },
                { key: '分账单号', value: reversalDetail.sharingNo },
                { key: '订单号', value: reversalDetail.orderNo },
                { key: '冲正金额', value: yuan(reversalDetail.amount) },
                { key: '状态', value: PAYMENT_SHARING_REVERSAL_STATUS_LABELS[reversalDetail.status] },
                { key: '渠道冲正单号', value: reversalDetail.channelReversalNo ?? '-' },
                { key: '版本', value: `v${reversalDetail.version}` },
                { key: '尝试/查单', value: `${reversalDetail.attempts} / ${reversalDetail.queryAttempts}` },
                { key: '完成时间', value: reversalDetail.finishedAt ?? '-' },
                { key: '冲正原因', value: reversalDetail.reason, span: 2 },
                { key: '失败原因', value: reversalDetail.errorMessage ?? '-', span: 2 },
              ]}
            />
          )}
        </Spin>
      </SideSheet>
    </div>
  );
}
