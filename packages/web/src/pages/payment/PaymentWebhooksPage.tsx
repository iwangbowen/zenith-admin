import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Button, Form, Input, Popconfirm, Select, Space, Spin, Switch, Tabs, TabPane, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_WEBHOOK_DELIVERY_STATUS_LABELS } from '@zenith/shared';
import type { PaginatedResponse, PaymentWebhookDelivery, PaymentWebhookEndpoint } from '@zenith/shared';

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
  const endpointFormApi = useRef<FormApi | null>(null);
  const [activeTab, setActiveTab] = useState<'endpoints' | 'deliveries'>('endpoints');

  const [endpointData, setEndpointData] = useState<PaginatedResponse<PaymentWebhookEndpoint> | null>(null);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const {
    page: endpointPage,
    pageSize: endpointPageSize,
    setPage: setEndpointPage,
    setPageSize: setEndpointPageSize,
    buildPagination: buildEndpointPagination,
  } = usePagination();
  const [endpointSearch, setEndpointSearch] = useState<EndpointSearchParams>(defaultEndpointSearch);
  const endpointSearchRef = useRef<EndpointSearchParams>(defaultEndpointSearch);
  endpointSearchRef.current = endpointSearch;

  const [deliveryData, setDeliveryData] = useState<PaginatedResponse<PaymentWebhookDelivery> | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const {
    page: deliveryPage,
    pageSize: deliveryPageSize,
    setPage: setDeliveryPage,
    setPageSize: setDeliveryPageSize,
    buildPagination: buildDeliveryPagination,
  } = usePagination();
  const [deliverySearch, setDeliverySearch] = useState<DeliverySearchParams>(defaultDeliverySearch);
  const deliverySearchRef = useRef<DeliverySearchParams>(defaultDeliverySearch);
  deliverySearchRef.current = deliverySearch;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentWebhookEndpoint | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
  const [detailDelivery, setDetailDelivery] = useState<PaymentWebhookDelivery | null>(null);
  const [redeliveringIds, setRedeliveringIds] = useState<Set<number>>(new Set());

  const fetchEndpoints = useCallback(
    async (p = endpointPage, ps = endpointPageSize, params?: EndpointSearchParams) => {
      const active = params ?? endpointSearchRef.current;
      setEndpointLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (active.keyword) query.keyword = active.keyword;
        if (active.status) query.status = active.status;
        const res = await request.get<PaginatedResponse<PaymentWebhookEndpoint>>(`/api/payment/webhooks/endpoints?${new URLSearchParams(query)}`);
        if (res.code === 0) { setEndpointData(res.data); setEndpointPage(res.data.page); setEndpointPageSize(res.data.pageSize); }
      } finally {
        setEndpointLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpointPage, endpointPageSize],
  );

  const fetchDeliveries = useCallback(
    async (p = deliveryPage, ps = deliveryPageSize, params?: DeliverySearchParams) => {
      const active = params ?? deliverySearchRef.current;
      setDeliveryLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (active.keyword) query.keyword = active.keyword;
        if (active.status) query.status = active.status;
        const res = await request.get<PaginatedResponse<PaymentWebhookDelivery>>(`/api/payment/webhooks/deliveries?${new URLSearchParams(query)}`);
        if (res.code === 0) { setDeliveryData(res.data); setDeliveryPage(res.data.page); setDeliveryPageSize(res.data.pageSize); }
      } finally {
        setDeliveryLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deliveryPage, deliveryPageSize],
  );

  useEffect(() => {
    void fetchEndpoints();
    void fetchDeliveries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleEndpointSearch() { setEndpointPage(1); void fetchEndpoints(1, endpointPageSize); }
  function handleEndpointReset() { setEndpointSearch(defaultEndpointSearch); setEndpointPage(1); void fetchEndpoints(1, endpointPageSize, defaultEndpointSearch); }
  function handleDeliverySearch() { setDeliveryPage(1); void fetchDeliveries(1, deliveryPageSize); }
  function handleDeliveryReset() { setDeliverySearch(defaultDeliverySearch); setDeliveryPage(1); void fetchDeliveries(1, deliveryPageSize, defaultDeliverySearch); }

  function openCreate() {
    setEditing(null);
    setModalVisible(true);
  }
  async function openEdit(record: PaymentWebhookEndpoint) {
    setEditing(record);
    setModalVisible(true);
    setDetailLoading(true);
    const res = await request.get<PaymentWebhookEndpoint>(`/api/payment/webhooks/endpoints/${record.id}`);
    setDetailLoading(false);
    if (res.code === 0 && res.data) setEditing(res.data);
  }
  function closeModal() {
    setModalVisible(false);
    setEditing(null);
    setDetailLoading(false);
  }

  const formInit = editing
    ? {
        name: editing.name,
        url: editing.url,
        bizType: editing.bizType ?? '',
        events: editing.events ?? [],
        status: editing.status,
        secret: '',
        remark: editing.remark ?? '',
      }
    : { status: 'enabled', events: [] };

  async function handleEndpointOk() {
    let values: EndpointFormValues;
    try {
      values = (await endpointFormApi.current?.validate()) as EndpointFormValues;
    } catch {
      throw new Error('validation');
    }
    setSubmitting(true);
    try {
      const payload = {
        ...values,
        bizType: values.bizType || undefined,
        events: values.events ?? [],
        secret: values.secret || undefined,
        remark: values.remark || undefined,
      };
      const res = editing
        ? await request.put<PaymentWebhookEndpoint>(`/api/payment/webhooks/endpoints/${editing.id}`, payload)
        : await request.post<PaymentWebhookEndpoint>('/api/payment/webhooks/endpoints', payload);
      if (res.code === 0) {
        Toast.success(editing ? '更新成功' : '创建成功');
        closeModal();
        void fetchEndpoints();
      } else {
        throw new Error(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleToggle(record: PaymentWebhookEndpoint, checked: boolean) {
    setTogglingIds((prev) => new Set(prev).add(record.id));
    request
      .put<PaymentWebhookEndpoint>(`/api/payment/webhooks/endpoints/${record.id}`, { status: checked ? 'enabled' : 'disabled' })
      .then((res) => {
        if (res.code === 0) {
          Toast.success(checked ? '已启用' : '已停用');
          void fetchEndpoints();
        }
      })
      .finally(() => setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/payment/webhooks/endpoints/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchEndpoints();
    }
  }

  function handleRedeliver(record: PaymentWebhookDelivery) {
    setRedeliveringIds((prev) => new Set(prev).add(record.id));
    request
      .post<PaymentWebhookDelivery>(`/api/payment/webhooks/deliveries/${record.id}/redeliver`, {})
      .then((res) => {
        if (res.code === 0) {
          Toast.success('重投成功');
          void fetchDeliveries();
        } else {
          Toast.error(`重投失败：${res.message}`);
        }
      })
      .finally(() => setRedeliveringIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
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
        <Switch checked={r.status === 'enabled'} loading={togglingIds.has(r.id)} disabled={!hasPermission('payment:webhook:update')} size="small" onChange={(c) => handleToggle(r, c)} />
      ),
    },
    {
      title: '操作', fixed: 'right', width: 120,
      render: (_: unknown, r: PaymentWebhookEndpoint) => (
        <Space>
          {hasPermission('payment:webhook:update') && <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>}
          {hasPermission('payment:webhook:delete') && (
            <Popconfirm title="确定要删除吗？" content="删除后不可恢复" onConfirm={() => handleDelete(r.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
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
    {
      title: '操作', fixed: 'right', width: 120,
      render: (_: unknown, r: PaymentWebhookDelivery) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => setDetailDelivery(r)}>详情</Button>
          {r.status !== 'success' && <Button theme="borderless" size="small" loading={redeliveringIds.has(r.id)} onClick={() => handleRedeliver(r)}>重投</Button>}
        </Space>
      ),
    },
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
    <div className="page-container">
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
            bordered columns={endpointColumns} dataSource={endpointData?.list ?? []} loading={endpointLoading} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void fetchEndpoints()} refreshLoading={endpointLoading} pagination={buildEndpointPagination(endpointData?.total ?? 0, fetchEndpoints)}
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
            bordered columns={deliveryColumns} dataSource={deliveryData?.list ?? []} loading={deliveryLoading} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void fetchDeliveries()} refreshLoading={deliveryLoading} pagination={buildDeliveryPagination(deliveryData?.total ?? 0, fetchDeliveries)}
          />
        </TabPane>
      </Tabs>

      <AppModal title={editing ? '编辑 Webhook 端点' : '新增 Webhook 端点'} visible={modalVisible} onOk={handleEndpointOk} onCancel={closeModal} okButtonProps={{ loading: submitting, disabled: detailLoading }} width={680} closeOnEsc>
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
