/**
 * 工作流事件订阅管理页面
 *
 * 提供事件订阅 CRUD + 启用/禁用 + 投递记录查看与重试。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  SideSheet,
  Spin,
  Switch,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type {
  PaginatedResponse,
  WorkflowDefinition,
  WorkflowEventDelivery,
  WorkflowEventSubscription,
  WorkflowEventType,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';

const EVENT_OPTIONS: Array<{ value: WorkflowEventType; label: string }> = [
  { value: 'instance.created',   label: '实例创建' },
  { value: 'instance.approved',  label: '实例通过' },
  { value: 'instance.rejected',  label: '实例驳回' },
  { value: 'instance.withdrawn', label: '实例撤回' },
  { value: 'node.entered',       label: '节点进入' },
  { value: 'node.left',          label: '节点离开' },
  { value: 'task.created',       label: '任务创建' },
  { value: 'task.assigned',      label: '任务分配' },
  { value: 'task.approved',      label: '任务通过' },
  { value: 'task.rejected',      label: '任务驳回' },
  { value: 'task.skipped',       label: '任务跳过' },
  { value: 'task.transferred',   label: '任务转交' },
];
const EVENT_LABEL_MAP = Object.fromEntries(EVENT_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>;

const DELIVERY_STATUS_MAP: Record<string, { text: string; color: 'green' | 'red' | 'orange' | 'grey' }> = {
  pending: { text: '待发送', color: 'grey' },
  success: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'red' },
  retrying: { text: '重试中', color: 'orange' },
};

interface FormValues {
  name: string;
  description?: string;
  definitionId?: number | null;
  events: WorkflowEventType[];
  url: string;
  secret?: string;
  signMode: 'hmacSha256' | 'none';
  headers?: string;
  enabled?: boolean;
}

export default function WorkflowEventSubscriptionsPage() {
  const formApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<WorkflowEventSubscription[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [definitionId, setDefinitionId] = useState<number | ''>('');
  const [enabledFilter, setEnabledFilter] = useState<'' | 'true' | 'false'>('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [defs, setDefs] = useState<WorkflowDefinition[]>([]);

  // 编辑弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<WorkflowEventSubscription | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);

  // 投递抽屉
  const [deliveryVisible, setDeliveryVisible] = useState(false);
  const [deliverySubId, setDeliverySubId] = useState<number | null>(null);
  const [deliveries, setDeliveries] = useState<WorkflowEventDelivery[]>([]);
  const [deliveriesTotal, setDeliveriesTotal] = useState(0);
  const { page: deliveryPage, setPage: setDeliveryPage, buildPagination: buildDeliveryPagination } = usePagination(20);
  const [deliveryLoading, setDeliveryLoading] = useState(false);

  const fetchData = useCallback(async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (keyword) q.set('keyword', keyword);
      if (definitionId !== '') q.set('definitionId', String(definitionId));
      if (enabledFilter) q.set('enabled', enabledFilter);
      const res = await request.get<PaginatedResponse<WorkflowEventSubscription>>(
        `/api/workflows/event-subscriptions?${q.toString()}`,
      );
      if (res.code === 0) {
        setList(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, definitionId, enabledFilter, refreshKey]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // 流程定义下拉
  useEffect(() => {
    request
      .get<PaginatedResponse<WorkflowDefinition>>('/api/workflows/definitions?page=1&pageSize=200')
      .then((res) => { if (res.code === 0) setDefs(res.data.list); })
      .catch(() => { /* ignore */ });
  }, []);

  const handleSearch = () => { setKeyword(keywordInput.trim()); setPage(1); setRefreshKey((k) => k + 1); };
  const handleReset = () => {
    setKeywordInput(''); setKeyword(''); setDefinitionId(''); setEnabledFilter(''); setPage(1); setRefreshKey((k) => k + 1);
  };

  const openCreate = () => {
    setEditing(null);
    setModalVisible(true);
    setTimeout(() => formApi.current?.setValues({
      name: '', description: '', definitionId: null, events: [], url: '', secret: '',
      signMode: 'hmacSha256', headers: '', enabled: true,
    }), 0);
  };

  const openEdit = async (row: WorkflowEventSubscription) => {
    setEditing(row);
    setModalVisible(true);
    setTimeout(() => formApi.current?.setValues({
      name: row.name,
      description: row.description ?? '',
      definitionId: row.definitionId,
      events: row.events,
      url: row.url,
      secret: '',
      signMode: row.signMode,
      headers: row.headers ? JSON.stringify(row.headers, null, 2) : '',
      enabled: row.enabled,
    }), 0);
    setModalDetailLoading(true);
    const res = await request.get<WorkflowEventSubscription>(`/api/workflows/event-subscriptions/${row.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditing(res.data);
      setTimeout(() => formApi.current?.setValues({
        name: res.data.name,
        description: res.data.description ?? '',
        definitionId: res.data.definitionId,
        events: res.data.events,
        url: res.data.url,
        secret: '',
        signMode: res.data.signMode,
        headers: res.data.headers ? JSON.stringify(res.data.headers, null, 2) : '',
        enabled: res.data.enabled,
      }), 0);
    } else {
      Toast.error(res.message || '获取订阅信息失败');
    }
  };

  const handleSubmit = async (vals: FormValues) => {
    let headers: Record<string, string> | null = null;
    if (vals.headers?.trim()) {
      try { headers = JSON.parse(vals.headers); } catch { Toast.error('Headers 必须是合法 JSON'); return; }
    }
    const body = {
      name: vals.name,
      description: vals.description ?? null,
      definitionId: vals.definitionId ?? null,
      events: vals.events,
      url: vals.url,
      ...(vals.secret ? { secret: vals.secret } : {}),
      signMode: vals.signMode,
      headers,
      enabled: vals.enabled ?? true,
    };
    setSaving(true);
    try {
      const res = editing
        ? await request.put<WorkflowEventSubscription>(`/api/workflows/event-subscriptions/${editing.id}`, body)
        : await request.post<WorkflowEventSubscription>(`/api/workflows/event-subscriptions`, body);
      if (res.code === 0) {
        Toast.success(editing ? '已更新' : '已创建');
        setModalVisible(false);
        await fetchData();
      }
    } finally { setSaving(false); }
  };

  const handleToggle = async (row: WorkflowEventSubscription) => {
    const res = await request.patch<WorkflowEventSubscription>(
      `/api/workflows/event-subscriptions/${row.id}/toggle`,
      { enabled: !row.enabled },
    );
    if (res.code === 0) { Toast.success('已切换'); await fetchData(); }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/workflows/event-subscriptions/${id}`);
    if (res.code === 0) { Toast.success('已删除'); await fetchData(); }
  };

  const handleViewSecret = async (id: number) => {
    const res = await request.get<{ secret: string }>(`/api/workflows/event-subscriptions/${id}/secret`);
    if (res.code === 0) {
      Modal.info({ title: '订阅 Secret', content: <Typography.Text copyable>{res.data.secret}</Typography.Text> });
    }
  };

  const fetchDeliveries = useCallback(async (p = deliveryPage) => {
    if (deliverySubId === null) return;
    setDeliveryLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(p), pageSize: String(deliveryPageSize), subscriptionId: String(deliverySubId),
      });
      const res = await request.get<PaginatedResponse<WorkflowEventDelivery>>(
        `/api/workflows/event-subscriptions/deliveries/list?${q.toString()}`,
      );
      if (res.code === 0) { setDeliveries(res.data.list); setDeliveriesTotal(res.data.total); }
    } finally { setDeliveryLoading(false); }
  }, [deliverySubId, deliveryPage]);

  useEffect(() => { if (deliveryVisible) void fetchDeliveries(); }, [deliveryVisible, fetchDeliveries]);

  const openDeliveries = (row: WorkflowEventSubscription) => {
    setDeliverySubId(row.id); setDeliveryPage(1); setDeliveryVisible(true);
  };

  const handleRetryDelivery = async (id: number) => {
    const res = await request.post(`/api/workflows/event-subscriptions/deliveries/${id}/retry`);
    if (res.code === 0) { Toast.success('已加入重试'); await fetchDeliveries(); }
  };

  const columns: ColumnProps<WorkflowEventSubscription>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '名称', dataIndex: 'name', width: 180 },
    {
      title: '范围', dataIndex: 'definitionName', width: 160,
      render: (_v, r) => r.definitionId === null
        ? <Tag color="blue">全局</Tag>
        : <Typography.Text>{r.definitionName ?? `#${r.definitionId}`}</Typography.Text>,
    },
    {
      title: '订阅事件', dataIndex: 'events', width: 280,
      render: (v: WorkflowEventType[]) => (
        <Space wrap spacing={4}>
          {v.map((e) => <Tag key={e} size="small">{EVENT_LABEL_MAP[e] ?? e}</Tag>)}
        </Space>
      ),
    },
    { title: 'URL', dataIndex: 'url', width: 240, ellipsis: { showTitle: true } },
    { title: '签名', dataIndex: 'signMode', width: 100,
      render: (v: string) => v === 'hmacSha256' ? <Tag color="green" size="small">HMAC</Tag> : <Tag size="small">无</Tag>,
    },
    {
      title: '状态', dataIndex: 'enabled', width: 90,
      render: (v: boolean, r) => <Switch checked={v} onChange={() => handleToggle(r)} />,
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 160, render: (v: string) => formatDateTime(v) },
    {
      title: '操作', dataIndex: 'op', width: 280, fixed: 'right',
      render: (_v, r) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Button theme="borderless" size="small" onClick={() => openDeliveries(r)}>投递</Button>
          <Button theme="borderless" size="small" onClick={() => handleViewSecret(r.id)}>密钥</Button>
          <Popconfirm title="确定要删除该订阅吗？" onConfirm={() => handleDelete(r.id)}>
            <Button theme="borderless" type="danger" size="small">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const deliveryColumns: ColumnProps<WorkflowEventDelivery>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '事件', dataIndex: 'eventType', width: 140,
      render: (v: string) => EVENT_LABEL_MAP[v] ?? v,
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string) => {
        const m = DELIVERY_STATUS_MAP[v] ?? { text: v, color: 'grey' as const };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    { title: '次数', dataIndex: 'attempt', width: 70 },
    { title: 'HTTP', dataIndex: 'responseStatus', width: 80, render: (v: number | null) => v ?? '-' },
    { title: '耗时', dataIndex: 'durationMs', width: 90, render: (v: number | null) => v == null ? '-' : `${v}ms` },
    { title: '错误', dataIndex: 'errorMessage', width: 220, ellipsis: { showTitle: true } },
    { title: '时间', dataIndex: 'createdAt', width: 160, render: (v: string) => formatDateTime(v) },
    {
      title: '操作', dataIndex: 'op', width: 100, fixed: 'right',
      render: (_v, r) => (r.status === 'failed' || r.status === 'retrying')
        ? <Button theme="borderless" size="small" onClick={() => handleRetryDelivery(r.id)}>重试</Button>
        : null,
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="名称 / URL"
          value={keywordInput}
          onChange={setKeywordInput}
          showClear
          style={{ width: 220 }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
        <Select
          placeholder="所属流程"
          value={definitionId === '' ? undefined : definitionId}
          onChange={(v) => setDefinitionId((v as number) ?? '')}
          showClear style={{ width: 200 }}
          optionList={[{ value: '', label: '全部（含全局）' }, ...defs.map((d) => ({ value: d.id, label: d.name }))]}
        />
        <Select
          placeholder="状态"
          value={enabledFilter || undefined}
          onChange={(v) => setEnabledFilter((v as 'true' | 'false') ?? '')}
          showClear style={{ width: 120 }}
          optionList={[
            { value: 'true', label: '启用' },
            { value: 'false', label: '禁用' },
          ]}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
      </SearchToolbar>

      <ConfigurableTable<WorkflowEventSubscription>
        bordered
        loading={loading}
        rowKey="id"
        dataSource={list}
        columns={columns}
        pagination={buildPagination(total, fetchData)}
        onRefresh={() => void fetchData()}
        refreshLoading={loading}
      />

      <Modal
        title={editing ? '编辑订阅' : '新增订阅'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditing(null); setModalDetailLoading(false); }}
        onOk={() => formApi.current?.submitForm()}
        confirmLoading={saving}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={680}
        maskClosable={false}
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form<FormValues> getFormApi={(api) => (formApi.current = api)} onSubmit={handleSubmit} allowEmpty labelPosition="top">
          <Form.Input field="name" label="名称" maxLength={64} rules={[{ required: true, message: '请输入名称' }]} />
          <Form.TextArea field="description" label="描述" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
          <Form.Select
            field="definitionId" label="所属流程（不选则订阅全局）" showClear
            optionList={defs.map((d) => ({ value: d.id, label: d.name }))}
          />
          <Form.Select
            field="events" label="订阅事件" multiple maxTagCount={5}
            rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个事件' }]}
            optionList={EVENT_OPTIONS}
          />
          <Form.Input field="url" label="回调 URL" placeholder="https://example.com/webhook"
            rules={[{ required: true, message: '请输入 URL' }, { pattern: /^https?:\/\//i, message: '必须以 http:// 或 https:// 开头' }]} />
          <Form.Input field="secret" label={editing ? '签名密钥（留空保持不变）' : '签名密钥'} placeholder="留空将自动生成" maxLength={256} />
          <Form.Select field="signMode" label="签名模式" optionList={[
            { value: 'hmacSha256', label: 'HMAC-SHA256' },
            { value: 'none', label: '不签名' },
          ]} />
          <Form.TextArea field="headers" label="自定义请求头（JSON 对象，可留空）" autosize={{ minRows: 2, maxRows: 6 }}
            placeholder={'{\n  "X-Source": "zenith"\n}'} />
          <Form.Switch field="enabled" label="启用" />
        </Form>
        </Spin>
      </Modal>

      <SideSheet
        title="投递记录"
        visible={deliveryVisible}
        onCancel={() => setDeliveryVisible(false)}
        width={1000}
      >
        <ConfigurableTable<WorkflowEventDelivery>
          bordered
          loading={deliveryLoading}
          rowKey="id"
          dataSource={deliveries}
          columns={deliveryColumns}
          pagination={{...buildDeliveryPagination(deliveriesTotal, (p) => void fetchDeliveries(p)), showSizeChanger: false}}
          onRefresh={() => void fetchDeliveries(deliveryPage)}
          refreshLoading={deliveryLoading}
        />
      </SideSheet>
    </div>
  );
}
