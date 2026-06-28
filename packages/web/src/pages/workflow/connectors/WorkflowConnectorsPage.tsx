import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button, Form, Input, Select, Spin, Toast, Switch, Modal,
  Row, Col, Typography, Tag, Banner, SideSheet, Table,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import type { WorkflowConnector, WorkflowConnectorType, WorkflowConnectorBreakerState, WorkflowConnectorInvokeResult, WorkflowConnectorHttpConfig, WorkflowConnectorStats, WorkflowConnectorInvocation, PaginatedResponse } from '@zenith/shared';

const TYPE_OPTIONS: Array<{ value: WorkflowConnectorType; label: string }> = [
  { value: 'http', label: 'HTTP' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'email', label: '邮件' },
  { value: 'sms', label: '短信' },
  { value: 'wecom', label: '企业微信' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'feishu', label: '飞书' },
  { value: 'mq', label: '消息队列' },
  { value: 'database', label: '数据库' },
];
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.value, t.label])) as Record<WorkflowConnectorType, string>;
const STATUS_OPTIONS = [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }];
const SOURCE_LABEL: Record<WorkflowConnectorInvocation['source'], string> = {
  test: '测试', trigger: '触发器', external: '外部审批', webhook: '事件订阅', manual: '手动',
};
const BREAKER_META: Record<WorkflowConnectorBreakerState, { text: string; color: 'green' | 'red' | 'orange' }> = {
  closed: { text: '正常', color: 'green' },
  open: { text: '熔断', color: 'red' },
  halfOpen: { text: '半开', color: 'orange' },
};

interface SearchParams { keyword: string; type: string; status: string }
const defaultSearchParams: SearchParams = { keyword: '', type: '', status: '' };

interface ConnectorFormValues {
  name: string; code: string; description?: string; type: WorkflowConnectorType;
  baseUrl: string; method: string; authType: 'none' | 'bearer' | 'basic' | 'apiKey'; apiKeyHeader?: string;
  headersText?: string; queryText?: string;
  token?: string; username?: string; password?: string; apiKey?: string; clearCredentials?: boolean;
  timeoutMs: number; retryMax: number; circuitBreakerEnabled: boolean; failureThreshold: number; cooldownSec: number;
  rateLimitEnabled: boolean; rateLimitWindowSec: number; rateLimitMax: number;
  status: 'enabled' | 'disabled';
}

function parseJsonObject(text: string | undefined, label: string): Record<string, string> | undefined {
  if (!text?.trim()) return undefined;
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}需为 JSON 对象`);
  return parsed as Record<string, string>;
}

export default function WorkflowConnectorsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);

  const [data, setData] = useState<PaginatedResponse<WorkflowConnector> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<WorkflowConnector | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const [testVisible, setTestVisible] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testTarget, setTestTarget] = useState<WorkflowConnector | null>(null);
  const [testPath, setTestPath] = useState('');
  const [testResult, setTestResult] = useState<WorkflowConnectorInvokeResult | null>(null);

  const [monitorVisible, setMonitorVisible] = useState(false);
  const [monitorTarget, setMonitorTarget] = useState<WorkflowConnector | null>(null);
  const [monitorDays, setMonitorDays] = useState(7);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorStats, setMonitorStats] = useState<WorkflowConnectorStats | null>(null);
  const [monitorRows, setMonitorRows] = useState<WorkflowConnectorInvocation[]>([]);

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const active = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const queryObj: Record<string, string> = { page: String(p), pageSize: String(ps) };
      if (active.keyword) queryObj.keyword = active.keyword;
      if (active.type) queryObj.type = active.type;
      if (active.status) queryObj.status = active.status;
      const res = await request.get<PaginatedResponse<WorkflowConnector>>(`/api/workflows/connectors?${new URLSearchParams(queryObj).toString()}`);
      if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearchParams(defaultSearchParams); setPage(1); void fetchList(1, pageSize, defaultSearchParams); }
  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: WorkflowConnector) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const editCfg = (editing?.config ?? {}) as unknown as WorkflowConnectorHttpConfig;
  const formInitValues: ConnectorFormValues = editing
    ? {
        name: editing.name, code: editing.code, description: editing.description ?? '', type: editing.type,
        baseUrl: editCfg.baseUrl ?? '', method: editCfg.method ?? 'GET', authType: editCfg.authType ?? 'none', apiKeyHeader: editCfg.apiKeyHeader ?? '',
        headersText: editCfg.headers && Object.keys(editCfg.headers).length ? JSON.stringify(editCfg.headers, null, 2) : '',
        queryText: editCfg.query && Object.keys(editCfg.query).length ? JSON.stringify(editCfg.query, null, 2) : '',
        clearCredentials: false,
        timeoutMs: editing.timeoutMs, retryMax: editing.retryMax, circuitBreakerEnabled: editing.circuitBreakerEnabled,
        failureThreshold: editing.failureThreshold, cooldownSec: editing.cooldownSec,
        rateLimitEnabled: editing.rateLimitEnabled, rateLimitWindowSec: editing.rateLimitWindowSec, rateLimitMax: editing.rateLimitMax,
        status: editing.status,
      }
    : {
        name: '', code: '', description: '', type: 'http', baseUrl: '', method: 'GET', authType: 'none', apiKeyHeader: '',
        headersText: '', queryText: '', timeoutMs: 10000, retryMax: 0, circuitBreakerEnabled: true, failureThreshold: 5, cooldownSec: 60,
        rateLimitEnabled: false, rateLimitWindowSec: 1, rateLimitMax: 0, status: 'enabled',
      };

  async function handleModalOk() {
    let values: ConnectorFormValues;
    try { values = await formApi.current?.validate() as ConnectorFormValues; } catch { throw new Error('validation'); }
    let headers: Record<string, string> | undefined;
    let query: Record<string, string> | undefined;
    try {
      headers = parseJsonObject(values.headersText, '请求头');
      query = parseJsonObject(values.queryText, '查询参数');
    } catch (e) { Toast.error((e as Error).message); throw e; }

    const config: WorkflowConnectorHttpConfig = {
      baseUrl: values.baseUrl.trim(),
      method: values.method as WorkflowConnectorHttpConfig['method'],
      authType: values.authType,
      ...(values.authType === 'apiKey' && values.apiKeyHeader?.trim() ? { apiKeyHeader: values.apiKeyHeader.trim() } : {}),
      ...(headers ? { headers } : {}),
      ...(query ? { query } : {}),
    };
    const credEntries = { token: values.token, username: values.username, password: values.password, apiKey: values.apiKey };
    const hasCred = Object.values(credEntries).some((v) => v != null && v !== '');
    const payload: Record<string, unknown> = {
      name: values.name, code: values.code, description: values.description?.trim() || null, type: values.type,
      config, timeoutMs: values.timeoutMs, retryMax: values.retryMax,
      circuitBreakerEnabled: values.circuitBreakerEnabled, failureThreshold: values.failureThreshold, cooldownSec: values.cooldownSec,
      rateLimitEnabled: values.rateLimitEnabled, rateLimitWindowSec: values.rateLimitWindowSec, rateLimitMax: values.rateLimitMax,
      status: values.status,
    };
    if (hasCred) payload.credentials = credEntries;
    if (editing && values.clearCredentials) payload.clearCredentials = true;

    setSubmitting(true);
    try {
      const res = editing
        ? await request.put(`/api/workflows/connectors/${editing.id}`, payload)
        : await request.post('/api/workflows/connectors', payload);
      if (res.code === 0) { Toast.success(editing ? '更新成功' : '创建成功'); closeModal(); void fetchList(); }
      else throw new Error(res.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/workflows/connectors/${id}`);
    if (res.code === 0) { Toast.success('删除成功'); void fetchList(); }
  }

  function handleToggleStatus(record: WorkflowConnector, checked: boolean) {
    const doToggle = async () => {
      setTogglingIds((prev) => new Set(prev).add(record.id));
      try {
        await request.put(`/api/workflows/connectors/${record.id}`, { status: checked ? 'enabled' : 'disabled' });
        Toast.success(checked ? '已启用' : '已停用');
        void fetchList();
      } catch (err: unknown) {
        Toast.error((err as { message?: string })?.message || '操作失败');
      } finally {
        setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; });
      }
    };
    if (checked) void doToggle();
    else Modal.confirm({ title: '确认停用', content: `停用后「${record.name}」将无法被调用，确认停用？`, onOk: () => void doToggle() });
  }

  function openTest(record: WorkflowConnector) {
    setTestTarget(record); setTestPath(''); setTestResult(null); setTestVisible(true);
  }
  async function runTest() {
    if (!testTarget) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await request.post<WorkflowConnectorInvokeResult>(`/api/workflows/connectors/${testTarget.id}/test`, testPath.trim() ? { path: testPath.trim() } : {}, { silent: true });
      if (res.code === 0) setTestResult(res.data);
      else Toast.error(res.message || '测试失败');
    } finally {
      setTestLoading(false);
    }
  }

  const fetchMonitor = useCallback(async (id: number, days: number) => {
    setMonitorLoading(true);
    try {
      const [statsRes, invRes] = await Promise.all([
        request.get<WorkflowConnectorStats>(`/api/workflows/connectors/${id}/stats?days=${days}`, { silent: true }),
        request.get<WorkflowConnectorInvocation[]>(`/api/workflows/connectors/${id}/invocations?limit=50`, { silent: true }),
      ]);
      if (statsRes.code === 0) setMonitorStats(statsRes.data);
      if (invRes.code === 0) setMonitorRows(invRes.data);
    } finally {
      setMonitorLoading(false);
    }
  }, []);

  function openMonitor(record: WorkflowConnector) {
    setMonitorTarget(record); setMonitorDays(7); setMonitorStats(null); setMonitorRows([]); setMonitorVisible(true);
    void fetchMonitor(record.id, 7);
  }

  const columns: ColumnProps<WorkflowConnector>[] = [
    { title: '名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    { title: '编码', dataIndex: 'code', width: 140, render: (v: string) => <Typography.Text size="small" type="tertiary">{v}</Typography.Text> },
    { title: '类型', dataIndex: 'type', width: 100, render: (t: WorkflowConnectorType) => <Tag size="small" color={t === 'http' ? 'blue' : 'grey'}>{TYPE_LABEL[t] ?? t}</Tag> },
    { title: '地址', dataIndex: 'config', width: 240, render: (_: unknown, r: WorkflowConnector) => renderEllipsis((r.config as unknown as WorkflowConnectorHttpConfig)?.baseUrl ?? '—') },
    { title: '凭据', dataIndex: 'hasCredentials', width: 70, render: (v: boolean) => v ? <Tag size="small" color="green">已配</Tag> : <Tag size="small" color="grey">无</Tag> },
    { title: '熔断', dataIndex: 'breakerState', width: 80, render: (s: WorkflowConnectorBreakerState) => { const m = BREAKER_META[s] ?? BREAKER_META.closed; return <Tag size="small" color={m.color}>{m.text}</Tag>; } },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, record: WorkflowConnector) => (
        <Switch checked={record.status === 'enabled'} loading={togglingIds.has(record.id)} disabled={!hasPermission('workflow:connector:update')} onChange={(checked) => handleToggleStatus(record, checked)} size="small" />
      ),
    },
    createOperationColumn<WorkflowConnector>({
      width: 200,
      desktopInlineKeys: ['test', 'monitor', 'edit', 'delete'],
      actions: (record) => [
        { key: 'test', label: '测试', hidden: !hasPermission('workflow:connector:test'), onClick: () => openTest(record) },
        { key: 'monitor', label: '监控', hidden: !hasPermission('workflow:connector:list'), onClick: () => openMonitor(record) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('workflow:connector:update'), onClick: () => openEdit(record) },
        {
          key: 'delete', label: '删除', danger: true, hidden: !hasPermission('workflow:connector:delete'),
          onClick: () => { Modal.confirm({ title: '确定要删除吗？', content: '删除后引用该连接器的节点将无法调用', okButtonProps: { type: 'danger', theme: 'solid' }, onOk: () => handleDelete(record.id) }); },
        },
      ],
    }),
  ];

  const renderKeyword = () => (
    <Input prefix={<Search size={14} />} placeholder="搜索名称 / 编码..." value={searchParams.keyword} onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
  );
  const renderTypeFilter = () => (
    <Select placeholder="全部类型" value={searchParams.type || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, type: (v as string) ?? '' }))} showClear style={{ width: 130 }} optionList={TYPE_OPTIONS} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={searchParams.status || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))} showClear style={{ width: 120 }} optionList={STATUS_OPTIONS} />
  );
  const renderCreate = () => hasPermission('workflow:connector:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(<>{renderKeyword()}{renderTypeFilter()}{renderStatusFilter()}<Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button><Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>{renderCreate()}</>)}
        mobilePrimary={(<>{renderKeyword()}<Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>{renderCreate()}</>)}
        mobileFilters={(<>{renderTypeFilter()}{renderStatusFilter()}</>)}
        filterTitle="连接器筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={loading}
        rowKey="id"
        size="small"
        empty="暂无连接器"
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal title={editing ? '编辑连接器' : '新增连接器'} visible={modalVisible} onOk={handleModalOk} onCancel={closeModal} okButtonProps={{ loading: submitting }} width={720} closeOnEsc>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} allowEmpty initValues={formInitValues} labelPosition="left" labelWidth={104}>
          <Row gutter={16}>
            <Col span={12}><Form.Input field="name" label="名称" placeholder="请输入名称" rules={[{ required: true, message: '名称不能为空' }]} /></Col>
            <Col span={12}><Form.Input field="code" label="编码" placeholder="如 crm_http" disabled={!!editing} rules={[{ required: true, message: '编码不能为空' }, { pattern: /^[a-zA-Z][a-zA-Z0-9_-]*$/, message: '以字母开头，仅含字母/数字/下划线/连字符' }]} /></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Select field="type" label="类型" style={{ width: '100%' }} optionList={TYPE_OPTIONS} rules={[{ required: true, message: '请选择类型' }]} /></Col>
            <Col span={12}><Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={STATUS_OPTIONS} /></Col>
          </Row>
          <Form.Input field="description" label="描述" placeholder="可选" />

          <Typography.Title heading={6} style={{ margin: '8px 0' }}>HTTP 调用配置</Typography.Title>
          <Form.Input field="baseUrl" label="基础地址" placeholder="https://api.example.com" rules={[{ required: true, message: '基础地址不能为空' }, { pattern: /^https?:\/\/.+/i, message: '需以 http:// 或 https:// 开头' }]} />
          <Row gutter={16}>
            <Col span={12}><Form.Select field="method" label="默认方法" style={{ width: '100%' }} optionList={['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => ({ value: m, label: m }))} /></Col>
            <Col span={12}><Form.Select field="authType" label="鉴权方式" style={{ width: '100%' }} optionList={[{ value: 'none', label: '无' }, { value: 'bearer', label: 'Bearer Token' }, { value: 'basic', label: 'Basic' }, { value: 'apiKey', label: 'API Key' }]} /></Col>
          </Row>
          <Form.TextArea field="headersText" label="固定请求头(JSON)" placeholder='可选，如 {"X-Env":"prod"}' autosize={{ minRows: 1, maxRows: 4 }} />
          <Form.TextArea field="queryText" label="固定查询参数(JSON)" placeholder='可选，如 {"version":"v1"}' autosize={{ minRows: 1, maxRows: 4 }} />

          <Typography.Title heading={6} style={{ margin: '8px 0' }}>凭据（{editing ? '留空保留原凭据；' : ''}AES 加密存储，不回显）</Typography.Title>
          <Row gutter={16}>
            <Col span={12}><Form.Input field="apiKeyHeader" label="API Key 头名" placeholder="默认 X-API-Key" /></Col>
            <Col span={12}><Form.Input field="apiKey" label="API Key" mode="password" placeholder="apiKey 鉴权时填写" /></Col>
          </Row>
          <Form.Input field="token" label="Bearer Token" mode="password" placeholder="bearer 鉴权时填写" />
          <Row gutter={16}>
            <Col span={12}><Form.Input field="username" label="Basic 用户名" placeholder="basic 鉴权时填写" /></Col>
            <Col span={12}><Form.Input field="password" label="Basic 密码" mode="password" placeholder="basic 鉴权时填写" /></Col>
          </Row>
          {editing && <Form.Checkbox field="clearCredentials" noLabel>清空已配置凭据</Form.Checkbox>}

          <Typography.Title heading={6} style={{ margin: '8px 0' }}>调用策略 · 熔断 · 限流</Typography.Title>
          <Row gutter={16}>
            <Col span={12}><Form.InputNumber field="timeoutMs" label="超时(ms)" min={100} max={120000} step={500} style={{ width: '100%' }} /></Col>
            <Col span={12}><Form.InputNumber field="retryMax" label="重试次数" min={0} max={10} style={{ width: '100%' }} /></Col>
          </Row>
          <Form.Switch field="circuitBreakerEnabled" label="启用熔断" />
          <Row gutter={16}>
            <Col span={12}><Form.InputNumber field="failureThreshold" label="失败阈值" min={1} max={100} style={{ width: '100%' }} /></Col>
            <Col span={12}><Form.InputNumber field="cooldownSec" label="冷却(秒)" min={1} max={3600} style={{ width: '100%' }} /></Col>
          </Row>
          <Form.Switch field="rateLimitEnabled" label="启用限流" extraText="保护下游：滑动窗口内超过最大调用次数即快速失败（不计入熔断）" />
          <Row gutter={16}>
            <Col span={12}><Form.InputNumber field="rateLimitWindowSec" label="时间窗(秒)" min={1} max={3600} style={{ width: '100%' }} /></Col>
            <Col span={12}><Form.InputNumber field="rateLimitMax" label="窗口内上限" min={0} max={100000} style={{ width: '100%' }} extraText="0=不限制" /></Col>
          </Row>
        </Form>
      </AppModal>

      <AppModal
        title={`测试调用 · ${testTarget?.name ?? ''}`}
        visible={testVisible}
        onCancel={() => setTestVisible(false)}
        onOk={() => void runTest()}
        okText="发送测试"
        okButtonProps={{ loading: testLoading }}
        width={560}
        closeOnEsc
      >
        <Input prefix="路径" value={testPath} onChange={setTestPath} placeholder="可选，相对基础地址的路径，如 /health" style={{ marginBottom: 12 }} showClear />
        <Spin spinning={testLoading} wrapperClassName="modal-spin-wrapper">
          {!testResult ? (
            <Typography.Text type="tertiary" size="small">点击「发送测试」对连接器发起一次探测请求。</Typography.Text>
          ) : (
            <div>
              <Banner type={testResult.ok ? 'success' : 'danger'} fullMode={false} closeIcon={null}
                description={testResult.ok ? `调用成功 · HTTP ${testResult.status} · ${testResult.durationMs}ms` : `调用失败 · ${testResult.error ?? ''}${testResult.status ? ` · HTTP ${testResult.status}` : ''} · ${testResult.durationMs}ms`}
              />
              {testResult.responseSnippet && (
                <div style={{ marginTop: 10 }}>
                  <Typography.Text strong size="small">响应预览</Typography.Text>
                  <pre style={{ marginTop: 4, maxHeight: '40vh', overflow: 'auto', background: 'var(--semi-color-fill-0)', padding: 8, borderRadius: 6, fontSize: 12, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{testResult.responseSnippet}</pre>
                </div>
              )}
            </div>
          )}
        </Spin>
      </AppModal>

      <SideSheet
        title={`连接器监控 · ${monitorTarget?.name ?? ''}`}
        visible={monitorVisible}
        onCancel={() => setMonitorVisible(false)}
        width={760}
      >
        <Spin spinning={monitorLoading}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Typography.Text type="tertiary" size="small">统计窗口</Typography.Text>
            <Select
              size="small" value={monitorDays} style={{ width: 120 }}
              onChange={(v) => { const d = v as number; setMonitorDays(d); if (monitorTarget) void fetchMonitor(monitorTarget.id, d); }}
              optionList={[{ value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }, { value: 90, label: '近 90 天' }]}
            />
          </div>
          <Row gutter={12} style={{ marginBottom: 16 }}>
            {([
              { label: '调用总数', value: monitorStats?.total ?? 0, color: undefined },
              { label: '成功', value: monitorStats?.success ?? 0, color: 'var(--semi-color-success)' },
              { label: '失败', value: monitorStats?.failed ?? 0, color: 'var(--semi-color-danger)' },
              { label: '成功率', value: `${Math.round((monitorStats?.successRate ?? 0) * 100)}%`, color: undefined },
              { label: '平均耗时', value: `${monitorStats?.avgDurationMs ?? 0}ms`, color: undefined },
            ] as const).map((s) => (
              <Col span={Math.floor(24 / 5)} key={s.label}>
                <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 8, padding: '10px 12px' }}>
                  <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>{s.label}</Typography.Text>
                  <Typography.Text strong style={{ fontSize: 18, color: s.color }}>{s.value}</Typography.Text>
                </div>
              </Col>
            ))}
          </Row>
          <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 8 }}>最近调用记录</Typography.Text>
          <Table<WorkflowConnectorInvocation>
            size="small"
            rowKey="id"
            dataSource={monitorRows}
            pagination={false}
            empty="暂无调用记录"
            columns={[
              { title: '来源', dataIndex: 'source', width: 90, render: (s: WorkflowConnectorInvocation['source']) => <Tag size="small" color="blue">{SOURCE_LABEL[s] ?? s}</Tag> },
              { title: '结果', dataIndex: 'ok', width: 70, render: (ok: boolean) => <Tag size="small" color={ok ? 'green' : 'red'}>{ok ? '成功' : '失败'}</Tag> },
              { title: '状态码', dataIndex: 'status', width: 80, render: (v: number | null) => v ?? '—' },
              { title: '耗时', dataIndex: 'durationMs', width: 80, render: (v: number) => `${v}ms` },
              { title: '地址', dataIndex: 'requestUrl', width: 200, render: (v: string | null) => renderEllipsis(v ?? '—') },
              { title: '错误', dataIndex: 'error', width: 180, render: (v: string | null) => v ? renderEllipsis(v) : '—' },
              { title: '时间', dataIndex: 'createdAt', width: 150 },
            ]}
            scroll={{ y: '50vh' }}
          />
        </Spin>
      </SideSheet>
    </div>
  );
}
