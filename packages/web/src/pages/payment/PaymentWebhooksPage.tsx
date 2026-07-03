import { useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Space, Spin, Switch, Tabs, TabPane, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  paymentWebhookKeys,
  useDeletePaymentWebhookEndpoint,
  usePaymentWebhookDeliveries,
  usePaymentWebhookEndpointDetail,
  usePaymentWebhookEndpoints,
  useRedeliverPaymentWebhookDelivery,
  useSavePaymentWebhookEndpoint,
} from '@/hooks/queries/payment-webhooks';
import { PAYMENT_WEBHOOK_DELIVERY_STATUS_LABELS } from '@zenith/shared';
import type { PaymentWebhookDelivery, PaymentWebhookEndpoint } from '@zenith/shared';

const EVENT_OPTIONS = [
  { value: 'payment.succeeded', label: '支付成功' },
  { value: 'payment.closed', label: '支付关闭' },
  { value: 'payment.failed', label: '支付失败' },
  { value: 'refund.succeeded', label: '退款成功' },
  { value: 'refund.failed', label: '退款失败' },
];
const DELIVERY_STATUS_COLOR = { pending: 'grey', success: 'green', failed: 'red' } as const satisfies Record<PaymentWebhookDelivery['status'], string>;
const codeBlockStyle: CSSProperties = {
  maxHeight: 260, overflow: 'auto', fontSize: 12, background: 'var(--semi-color-fill-0)',
  padding: 12, borderRadius: 4, wordBreak: 'break-all', whiteSpace: 'pre-wrap', margin: 0,
};

interface EndpointSearchParams { keyword: string; status: string; }
const defaultEndpointSearch: EndpointSearchParams = { keyword: '', status: '' };

interface DeliverySearchParams { keyword: string; status: string; }
const defaultDeliverySearch: DeliverySearchParams = { keyword: '', status: '' };

interface EndpointFormValues {
  name: string;
  url: string;
  bizType?: string;
  events?: string[];
  status?: 'enabled' | 'disabled';
  secret?: string;
  remark?: string;
}

function formatRaw(raw: unknown): string {
  if (raw == null || raw === '') return '（无）';
  if (typeof raw !== 'string') return JSON.stringify(raw, null, 2) ?? String(raw);
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

export default function PaymentWebhooksPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const endpointFormApi = useRef<FormApi | null>(null);
  const [activeTab, setActiveTab] = useState<'endpoints' | 'deliveries'>('endpoints');

  const {
    page: endpointPage,
    pageSize: endpointPageSize,
    setPage: setEndpointPage,
    buildPagination: buildEndpointPagination,
  } = usePagination();
  const [endpointSearch, setEndpointSearch] = useState<EndpointSearchParams>(defaultEndpointSearch);
  const [submittedEndpointSearch, setSubmittedEndpointSearch] = useState<EndpointSearchParams>(defaultEndpointSearch);

  const {
    page: deliveryPage,
    pageSize: deliveryPageSize,
    setPage: setDeliveryPage,
    buildPagination: buildDeliveryPagination,
  } = usePagination();
  const [deliverySearch, setDeliverySearch] = useState<DeliverySearchParams>(defaultDeliverySearch);
  const [submittedDeliverySearch, setSubmittedDeliverySearch] = useState<DeliverySearchParams>(defaultDeliverySearch);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentWebhookEndpoint | null>(null);
  const [detailDelivery, setDetailDelivery] = useState<PaymentWebhookDelivery | null>(null);

  const endpointQuery = usePaymentWebhookEndpoints({
    page: endpointPage,
    pageSize: endpointPageSize,
    keyword: submittedEndpointSearch.keyword || undefined,
    status: submittedEndpointSearch.status || undefined,
  });
  const endpointData = endpointQuery.data?.list ?? [];
  const endpointTotal = endpointQuery.data?.total ?? 0;
  const deliveryQuery = usePaymentWebhookDeliveries({
    page: deliveryPage,
    pageSize: deliveryPageSize,
    keyword: submittedDeliverySearch.keyword || undefined,
    status: submittedDeliverySearch.status || undefined,
  });
  const deliveryData = deliveryQuery.data?.list ?? [];
  const deliveryTotal = deliveryQuery.data?.total ?? 0;
  const detailQuery = usePaymentWebhookEndpointDetail(editing?.id, modalVisible && !!editing);
  const editingDetail = editing ? (detailQuery.data ?? editing) : null;
  const detailLoading = !!editing && detailQuery.isFetching;
  const saveEndpointMutation = useSavePaymentWebhookEndpoint();
  const toggleEndpointMutation = useSavePaymentWebhookEndpoint();
  const deleteEndpointMutation = useDeletePaymentWebhookEndpoint();
  const redeliverMutation = useRedeliverPaymentWebhookDelivery();
  const togglingId = toggleEndpointMutation.isPending ? (toggleEndpointMutation.variables?.id ?? null) : null;
  const redeliveringId = redeliverMutation.isPending ? (redeliverMutation.variables ?? null) : null;

  function handleEndpointSearch() { setEndpointPage(1); setSubmittedEndpointSearch(endpointSearch); void queryClient.invalidateQueries({ queryKey: paymentWebhookKeys.endpointLists }); }
  function handleEndpointReset() { setEndpointSearch(defaultEndpointSearch); setEndpointPage(1); setSubmittedEndpointSearch(defaultEndpointSearch); void queryClient.invalidateQueries({ queryKey: paymentWebhookKeys.endpointLists }); }
  function handleDeliverySearch() { setDeliveryPage(1); setSubmittedDeliverySearch(deliverySearch); void queryClient.invalidateQueries({ queryKey: paymentWebhookKeys.deliveryLists }); }
  function handleDeliveryReset() { setDeliverySearch(defaultDeliverySearch); setDeliveryPage(1); setSubmittedDeliverySearch(defaultDeliverySearch); void queryClient.invalidateQueries({ queryKey: paymentWebhookKeys.deliveryLists }); }

  function openCreate() {
    setEditing(null);
    setModalVisible(true);
  }
  function openEdit(record: PaymentWebhookEndpoint) {
    setEditing(record);
    setModalVisible(true);
  }
  function closeModal() {
    setModalVisible(false);
    setEditing(null);
  }

  const formInit = editingDetail
    ? {
        name: editingDetail.name,
        url: editingDetail.url,
        bizType: editingDetail.bizType ?? '',
        events: editingDetail.events ?? [],
        status: editingDetail.status,
        secret: '',
        remark: editingDetail.remark ?? '',
      }
    : { status: 'enabled', events: [] };

  async function handleEndpointOk() {
    let values: EndpointFormValues;
    try {
      values = (await endpointFormApi.current?.validate()) as EndpointFormValues;
    } catch {
      throw new Error('validation');
    }
    const payload = {
      ...values,
      bizType: values.bizType || undefined,
      events: values.events ?? [],
      secret: values.secret || undefined,
      remark: values.remark || undefined,
    };
    await saveEndpointMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleToggle(record: PaymentWebhookEndpoint, checked: boolean) {
    await toggleEndpointMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } });
    Toast.success(checked ? '已启用' : '已停用');
  }

  async function handleDelete(id: number) {
    await deleteEndpointMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  async function handleRedeliver(record: PaymentWebhookDelivery) {
    await redeliverMutation.mutateAsync(record.id);
    Toast.success('重投成功');
  }

  const endpointColumns: ColumnProps<PaymentWebhookEndpoint>[] = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: 'URL', dataIndex: 'url', width: 260, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 240 }}>{v}</Typography.Text> },
    { title: '业务类型', dataIndex: 'bizType', width: 120, render: (v: string | null) => v || '全部' },
    { title: '事件', dataIndex: 'events', width: 260, render: (v: string[]) => (v.length ? <Space wrap>{v.map((e) => <Tag key={e} color="blue">{EVENT_OPTIONS.find((o) => o.value === e)?.label ?? e}</Tag>)}</Space> : '全部事件') },
    { title: '密钥', dataIndex: 'hasSecret', width: 90, render: (v: boolean) => (v ? '已配置' : '-') },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, r: PaymentWebhookEndpoint) => (
        <Switch checked={r.status === 'enabled'} loading={togglingId === r.id} disabled={!hasPermission('payment:webhook:update')} size="small" onChange={(c) => void handleToggle(r, c)} />
      ),
    },
    createOperationColumn<PaymentWebhookEndpoint>({
      width: 120,
      actions: (r) => [
        ...(hasPermission('payment:webhook:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(r),
        }] : []),
        ...(hasPermission('payment:webhook:delete') ? [{
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

  const deliveryColumns: ColumnProps<PaymentWebhookDelivery>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '端点', dataIndex: 'endpointName', width: 160, render: (v: string | null) => v || '-' },
    { title: '事件类型', dataIndex: 'eventType', width: 160 },
    { title: '订单号', dataIndex: 'orderNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '次数', dataIndex: 'attempts', width: 80 },
    { title: 'HTTP', dataIndex: 'httpStatus', width: 90, render: (v: number | null) => v ?? '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentWebhookDelivery['status']) => <Tag color={DELIVERY_STATUS_COLOR[v]}>{PAYMENT_WEBHOOK_DELIVERY_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentWebhookDelivery>({
      width: 120,
      actions: (r) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => setDetailDelivery(r),
        },
        ...(r.status !== 'success' ? [{
          key: 'redeliver',
          label: '重投',
          loading: redeliveringId === r.id,
          onClick: () => void handleRedeliver(r),
        }] : []),
      ],
    }),
  ];

  const renderEndpointKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="名称/URL..."
      value={endpointSearch.keyword}
      onChange={(v) => setEndpointSearch((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 200 }}
      onEnterPress={handleEndpointSearch}
    />
  );
  const renderEndpointStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={endpointSearch.status || undefined}
      onChange={(v) => setEndpointSearch((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]}
    />
  );
  const renderEndpointSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleEndpointSearch}>查询</Button>;
  const renderEndpointResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleEndpointReset}>重置</Button>;
  const renderEndpointCreateButton = () => hasPermission('payment:webhook:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  const renderDeliveryKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="订单号..."
      value={deliverySearch.keyword}
      onChange={(v) => setDeliverySearch((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 200 }}
      onEnterPress={handleDeliverySearch}
    />
  );
  const renderDeliveryStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={deliverySearch.status || undefined}
      onChange={(v) => setDeliverySearch((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(PAYMENT_WEBHOOK_DELIVERY_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );
  const renderDeliverySearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleDeliverySearch}>查询</Button>;
  const renderDeliveryResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleDeliveryReset}>重置</Button>;

  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as 'endpoints' | 'deliveries')} type="line" lazyRender keepDOM={false}>
        <TabPane tab="端点配置" itemKey="endpoints">
          <SearchToolbar
            primary={(
              <>
                {renderEndpointKeywordSearch()}
                {renderEndpointStatusFilter()}
                {renderEndpointSearchButton()}
                {renderEndpointResetButton()}
                {renderEndpointCreateButton()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderEndpointKeywordSearch()}
                {renderEndpointSearchButton()}
                {renderEndpointCreateButton()}
              </>
            )}
            mobileFilters={renderEndpointStatusFilter()}
            filterTitle="Webhook 端点筛选"
            onFilterApply={handleEndpointSearch}
            onFilterReset={handleEndpointReset}
          />
          <ConfigurableTable
            bordered columns={endpointColumns} dataSource={endpointData} loading={endpointQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void endpointQuery.refetch()} refreshLoading={endpointQuery.isFetching} pagination={buildEndpointPagination(endpointTotal)}
          />
        </TabPane>
        <TabPane tab="投递日志" itemKey="deliveries">
          <SearchToolbar
            primary={(
              <>
                {renderDeliveryKeywordSearch()}
                {renderDeliveryStatusFilter()}
                {renderDeliverySearchButton()}
                {renderDeliveryResetButton()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderDeliveryKeywordSearch()}
                {renderDeliverySearchButton()}
              </>
            )}
            mobileFilters={renderDeliveryStatusFilter()}
            filterTitle="Webhook 投递筛选"
            onFilterApply={handleDeliverySearch}
            onFilterReset={handleDeliveryReset}
          />
          <ConfigurableTable
            bordered columns={deliveryColumns} dataSource={deliveryData} loading={deliveryQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void deliveryQuery.refetch()} refreshLoading={deliveryQuery.isFetching} pagination={buildDeliveryPagination(deliveryTotal)}
          />
        </TabPane>
      </Tabs>

      <AppModal title={editing ? '编辑 Webhook 端点' : '新增 Webhook 端点'} visible={modalVisible} onOk={handleEndpointOk} onCancel={closeModal} okButtonProps={{ loading: saveEndpointMutation.isPending, disabled: detailLoading }} width={680} closeOnEsc>
        <Spin spinning={detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={editing?.id ?? 'new'} getFormApi={(api) => { endpointFormApi.current = api; }} allowEmpty initValues={formInit} labelPosition="left" labelWidth={96}>
            <Form.Input field="name" label="名称" placeholder="如：订单系统回调" rules={[{ required: true, message: '名称不能为空' }]} />
            <Form.Input field="url" label="URL" placeholder="https://example.com/payment/webhook" rules={[{ required: true, message: 'URL 不能为空' }]} />
            <Form.Input field="bizType" label="业务类型" placeholder="留空=全部" />
            <Form.Select field="events" label="事件" multiple maxTagCount={3} style={{ width: '100%' }} optionList={EVENT_OPTIONS} placeholder="留空=全部事件" />
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
            <Form.Input field="secret" label="密钥" mode="password" placeholder={editing?.hasSecret ? '已配置，留空则不修改' : '请输入'} />
            <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
          </Form>
        </Spin>
      </AppModal>

      <AppModal title={`投递详情（#${detailDelivery?.id ?? ''}）`} visible={!!detailDelivery} onCancel={() => setDetailDelivery(null)} footer={null} width={760} closeOnEsc>
        {detailDelivery && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>Payload</Typography.Text>
              <pre style={codeBlockStyle}>{formatRaw(detailDelivery.payload)}</pre>
            </div>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>Response Body</Typography.Text>
              <pre style={codeBlockStyle}>{formatRaw(detailDelivery.responseBody)}</pre>
            </div>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>Last Error</Typography.Text>
              <pre style={codeBlockStyle}>{formatRaw(detailDelivery.lastError)}</pre>
            </div>
          </div>
        )}
      </AppModal>
    </div>
  );
}
