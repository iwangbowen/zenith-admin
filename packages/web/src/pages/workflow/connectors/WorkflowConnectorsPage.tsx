import { FormPasswordInput } from '@/components/PasswordInput';
import { useState } from 'react';
import { Form, Input, TextArea, Select, Spin, Toast, Row, Col, Typography, Tag, Banner, SideSheet, Table } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import AppModal from '@/components/AppModal';
import { createdAtColumn, dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { WORKFLOW_CONNECTOR_BREAKER_STATE_LABELS, WORKFLOW_CONNECTOR_INVOCATION_SOURCE_LABELS, WORKFLOW_CONNECTOR_TYPE_LABELS, WORKFLOW_CONNECTOR_RUNTIME_TYPE_OPTIONS, WORKFLOW_CONNECTOR_HTTP_METHOD_OPTIONS, WORKFLOW_CONNECTOR_AUTH_OPTIONS, WORKFLOW_CONNECTOR_CONTENT_OPTIONS, isWorkflowHttpConnector, workflowConnectorConfigFields, workflowConnectorConfigFromFields, type WorkflowConnectorConfigFields, type WorkflowConnector, type WorkflowConnectorType, type WorkflowConnectorBreakerState, type WorkflowConnectorInvokeResult, type WorkflowConnectorHttpConfig, type WorkflowConnectorInvocation, workflowConnectorContract } from '@zenith/shared/workflow';
import {
  useDeleteWorkflowConnectors,
  useSaveWorkflowConnector,
  useTestWorkflowConnector,
  useWorkflowConnectorList,
  useWorkflowConnectorMonitor,
} from '@/hooks/queries/workflow-connectors';
import { useDictItems } from '@/hooks/useDictItems';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect } from '@/components/search-filters';
import { ListSearchToolbar, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';
import { parseHeadersJson } from '../components/http-integration';
import { useEditModal } from '@/hooks/useEditModal';
import { useListPage } from '@/hooks/useListPage';
import { EditFormSheet } from '@/components/EditFormModal';
import { TextBlock } from '@/components/TextBlock';
import { abortSubmit } from '@/lib/abort-submit';
import { useSmsTemplateList } from '@/hooks/queries/sms-templates';

/** 可创建的连接器类型（与后端 workflowConnectorTypeSchema 对齐；mq/database 暂无运行时实现不开放） */
const TYPE_OPTIONS = WORKFLOW_CONNECTOR_RUNTIME_TYPE_OPTIONS;
const BREAKER_COLORS: Record<WorkflowConnectorBreakerState, 'green' | 'red' | 'orange'> = {
  closed: 'green',
  open: 'red',
  halfOpen: 'orange',
};

interface ConnectorFormValues extends WorkflowConnectorConfigFields {
  name: string; code: string; description?: string; type: WorkflowConnectorType;
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
  const { options: statusOptions } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const page = useListPage({
    contract: workflowConnectorContract,
    useList: useWorkflowConnectorList,
    table: { empty: '暂无连接器' },
  });
  const { tableProps } = page;

  const saveMutation = useSaveWorkflowConnector();
  const toggleStatusMutation = useSaveWorkflowConnector();
  const deleteMutation = useDeleteWorkflowConnectors();
  const testMutation = useTestWorkflowConnector();

  const [testVisible, setTestVisible] = useState(false);
  const [testTarget, setTestTarget] = useState<WorkflowConnector | null>(null);
  const [testPath, setTestPath] = useState('');
  const [testBodyText, setTestBodyText] = useState('');
  const [testResult, setTestResult] = useState<WorkflowConnectorInvokeResult | null>(null);

  const [authType, setAuthType] = useState<ConnectorFormValues['authType']>('none');
  const [connectorType, setConnectorType] = useState<WorkflowConnectorType>('http');

  const [monitorVisible, setMonitorVisible] = useState(false);
  const [monitorTarget, setMonitorTarget] = useState<WorkflowConnector | null>(null);
  const [monitorDays, setMonitorDays] = useState(7);
  const monitorQuery = useWorkflowConnectorMonitor(monitorTarget?.id, monitorDays, monitorVisible);
  const monitorStats = monitorQuery.data?.stats ?? null;
  const monitorRows: WorkflowConnectorInvocation[] = monitorQuery.data?.invocations ?? [];

  const connectorModal = useEditModal<WorkflowConnector, ConnectorFormValues, Record<string, unknown>>({
    entityName: '连接器',
    save: saveMutation,
    defaults: {
      name: '', code: '', description: '', type: 'http', ...workflowConnectorConfigFields({ subject: '工作流通知' }),
      headersText: '', queryText: '', timeoutMs: 10000, retryMax: 0, circuitBreakerEnabled: true, failureThreshold: 5, cooldownSec: 60,
      rateLimitEnabled: false, rateLimitWindowSec: 1, rateLimitMax: 0, status: 'enabled',
    },
    toValues: (record) => {
      const editCfg = (record.config ?? {}) as unknown as WorkflowConnectorHttpConfig;
      return {
        name: record.name, code: record.code, description: record.description ?? '', type: record.type,
        ...workflowConnectorConfigFields(record.config),
        headersText: editCfg.headers && Object.keys(editCfg.headers).length ? JSON.stringify(editCfg.headers, null, 2) : '',
        queryText: editCfg.query && Object.keys(editCfg.query).length ? JSON.stringify(editCfg.query, null, 2) : '',
        clearCredentials: false,
        timeoutMs: record.timeoutMs, retryMax: record.retryMax, circuitBreakerEnabled: record.circuitBreakerEnabled,
        failureThreshold: record.failureThreshold, cooldownSec: record.cooldownSec,
        rateLimitEnabled: record.rateLimitEnabled, rateLimitWindowSec: record.rateLimitWindowSec, rateLimitMax: record.rateLimitMax,
        status: record.status,
      };
    },
    beforeSave: (values, { isEdit }) => {
    const http = isWorkflowHttpConnector(values.type);
    const headers = http ? parseHeadersJson(values.headersText, { toastMessage: '请求头需为 JSON 对象' }) : undefined;
    let query: Record<string, string> | undefined;
    try {
      query = http ? parseJsonObject(values.queryText, '查询参数') : undefined;
    } catch (e) { Toast.error((e as Error).message); abortSubmit(); }

    const config = workflowConnectorConfigFromFields(values.type, values, headers, query);
    const credEntries = { token: values.token, username: values.username, password: values.password, apiKey: values.apiKey };
    const hasCred = Object.values(credEntries).some((v) => v != null && v !== '');
    const payload: Record<string, unknown> = {
      name: values.name, code: values.code, description: values.description?.trim() || null, type: values.type,
      config, timeoutMs: values.timeoutMs, retryMax: values.retryMax,
      circuitBreakerEnabled: values.circuitBreakerEnabled, failureThreshold: values.failureThreshold, cooldownSec: values.cooldownSec,
      rateLimitEnabled: values.rateLimitEnabled, rateLimitWindowSec: values.rateLimitWindowSec, rateLimitMax: values.rateLimitMax,
      status: values.status,
    };
    if (http && hasCred) payload.credentials = credEntries;
    if (isEdit && (values.clearCredentials || !http)) payload.clearCredentials = true;
    return payload;
    },
    labelWidth: 120,
  });
  const editing = connectorModal.editing;
  const templateQuery = useSmsTemplateList({ page: 1, pageSize: 100, status: 'enabled' }, connectorModal.visible && connectorType === 'sms' && hasPermission('system:sms-template:list'));

  function openCreate() {
    setAuthType('none');
    setConnectorType('http');
    connectorModal.openCreate();
  }
  function openEdit(record: WorkflowConnector) {
    const cfg = (record.config ?? {}) as unknown as WorkflowConnectorHttpConfig;
    setAuthType(cfg.authType ?? 'none');
    setConnectorType(record.type);
    connectorModal.openEdit(record);
  }

  const status = useStatusToggle<WorkflowConnector>({
    toggle: (record, checked) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ title: '确认停用', content: `停用后「${record.name}」将无法被调用，确认停用？` }),
    disabled: !hasPermission('workflow:connector:update'),
  });

  function openTest(record: WorkflowConnector) {
    setTestTarget(record); setTestPath(''); setTestBodyText(''); setTestResult(null); setTestVisible(true);
  }
  async function runTest() {
    if (!testTarget) return;
    setTestResult(null);
    try {
      const path = testPath.trim();
      let body: unknown;
      if (testBodyText.trim()) {
        if (testTarget.type === 'email' || ['wecom', 'dingtalk', 'feishu'].includes(testTarget.type)) body = testBodyText;
        else {
          try { body = JSON.parse(testBodyText); }
          catch { Toast.error('测试数据需为有效 JSON'); return; }
        }
      }
      setTestResult(await testMutation.mutateAsync({ params: { id: testTarget.id }, body: {
        ...(isWorkflowHttpConnector(testTarget.type) && path ? { path } : {}),
        ...(body !== undefined ? { body } : {}),
      } }));
    } catch (err) {
      Toast.error((err as Error).message || '测试失败');
    }
  }

  function openMonitor(record: WorkflowConnector) {
    setMonitorTarget(record); setMonitorDays(7); setMonitorVisible(true);
  }

  const operationColumn = useCrudOperationColumn<WorkflowConnector>({
    permission: 'workflow:connector',
    edit: openEdit,
    remove: deleteMutation,
    content: '删除后引用该连接器的节点将无法调用',
    extra: (record) => [
      { key: 'test', label: '测试', hidden: !hasPermission('workflow:connector:test'), onClick: () => openTest(record) },
      { key: 'monitor', label: '监控', hidden: !hasPermission('workflow:connector:list'), onClick: () => openMonitor(record) },
    ],
    width: 240,
    desktopInlineKeys: ['test', 'edit', 'delete'],
  });

  const columns: ColumnProps<WorkflowConnector>[] = [
    // 名称 / 编码：单行省略（Semi 列级 ellipsis，悬停出原生 title），不换行撑高行高
    { title: '名称', dataIndex: 'name', minWidth: 200, ellipsis: { showTitle: true }, render: (v: string) => v || EMPTY_PLACEHOLDER },
    { title: '编码', dataIndex: 'code', width: 270, className: 'table-cell-muted', ellipsis: { showTitle: true } },
    { title: '类型', dataIndex: 'type', width: 100, render: (t: WorkflowConnectorType) => <Tag size="small" color={t === 'http' ? 'blue' : 'grey'}>{WORKFLOW_CONNECTOR_TYPE_LABELS[t] ?? t}</Tag> },
    { title: '目标', dataIndex: 'config', width: 240, render: (_: unknown, r: WorkflowConnector) => {
      const target = r.type === 'email' ? r.config.to : r.type === 'sms' ? r.config.phone : r.config.baseUrl;
      return renderEllipsis(typeof target === 'string' ? target : null);
    } },
    { title: '凭据', dataIndex: 'hasCredentials', width: 80, render: (v: boolean) => v ? <Tag size="small" color="green">已配</Tag> : <Tag size="small" color="grey">无</Tag> },
    { title: '熔断', dataIndex: 'breakerState', width: 80, render: (s: WorkflowConnectorBreakerState) => { const color = BREAKER_COLORS[s] ?? BREAKER_COLORS.closed; return <Tag size="small" color={color}>{WORKFLOW_CONNECTOR_BREAKER_STATE_LABELS[s] ?? s}</Tag>; } },
    createdAtColumn,
    status.column(),
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'type', 'status']}
        overrides={{
          type: (p) => (
            <FilterSelect
              placeholder="全部类型"
              items={TYPE_OPTIONS}
              {...p.bind('type')}
            />
          ),
        }}
        create={<CreateButton permission="workflow:connector:create" onClick={openCreate} />}
        filterTitle="连接器筛选"
      />

      <ConfigurableTable<WorkflowConnector>
        columns={columns}
        {...tableProps}
      />

      <EditFormSheet modal={connectorModal} width={780} formProps={{ onValueChange: (values) => {
            const next = (values as Partial<ConnectorFormValues>).authType;
            if (next && next !== authType) setAuthType(next);
            const nextType = (values as Partial<ConnectorFormValues>).type;
            if (nextType && nextType !== connectorType) setConnectorType(nextType);
          } }}>
        <Form.Section text="基础信息">
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Input field="name" label="名称" placeholder="请输入名称" rules={[{ required: true, message: '名称不能为空' }]} /></Col>
            <Col xs={24} sm={12}><Form.Input field="code" label="编码" placeholder="如 crm_http" disabled={!!editing} rules={[{ required: true, message: '编码不能为空' }, { pattern: /^[a-zA-Z][a-zA-Z0-9_-]*$/, message: '以字母开头，仅含字母/数字/下划线/连字符' }]} /></Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Select field="type" label="类型" style={{ width: '100%' }} optionList={TYPE_OPTIONS} rules={[{ required: true, message: '请选择类型' }]} /></Col>
            <Col xs={24} sm={12}><Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} /></Col>
          </Row>
          <Form.Input field="description" label="描述" placeholder="可选" />
        </Form.Section>

        {connectorType === 'email' && <Form.Section text="邮件发送配置">
          <Form.Input field="emailTo" label="收件人" placeholder="如 finance@example.com，多人用逗号分隔" rules={[{ required: true, message: '请填写邮件收件人' }]} />
          <Form.Input field="emailSubject" label="邮件主题" rules={[{ required: true, message: '请填写邮件主题' }]} />
          <Typography.Text type="tertiary" size="small">正文由调用此连接器的流程提供，邮件通过系统启用的发信配置发送。</Typography.Text>
        </Form.Section>}
        {connectorType === 'sms' && <Form.Section text="短信发送配置">
          <Form.Input field="smsPhone" label="收件手机号" placeholder="请输入手机号，可包含国际区号" rules={[{ required: true, message: '请填写收件手机号' }]} />
          {hasPermission('system:sms-template:list') ? <Form.Select field="smsTemplateCode" label="短信模板" filter loading={templateQuery.isFetching}
            optionList={(templateQuery.data?.list ?? []).map(template => ({ value: template.code, label: `${template.name}（${template.code}）` }))}
            style={{ width: '100%' }} rules={[{ required: true, message: '请选择短信模板' }]} />
            : <Form.Input field="smsTemplateCode" label="短信模板编码" rules={[{ required: true, message: '请填写短信模板编码' }]} />}
          <Typography.Text type="tertiary" size="small">短信使用系统启用的服务商配置；流程传入的数据用于填充所选模板。</Typography.Text>
        </Form.Section>}
        {isWorkflowHttpConnector(connectorType) && <Form.Section text="HTTP 调用配置">
          <Form.Input field="baseUrl" label="基础地址" placeholder="https://api.example.com" rules={[{ required: true, message: '基础地址不能为空' }, { pattern: /^https?:\/\/.+/i, message: '需以 http:// 或 https:// 开头' }]} />
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Select field="method" label="默认方法" style={{ width: '100%' }} optionList={WORKFLOW_CONNECTOR_HTTP_METHOD_OPTIONS} /></Col>
            <Col xs={24} sm={12}><Form.Select field="authType" label="鉴权方式" style={{ width: '100%' }} optionList={WORKFLOW_CONNECTOR_AUTH_OPTIONS} /></Col>
          </Row>
          <Form.Select field="contentType" label="请求格式" style={{ width: '100%' }} optionList={WORKFLOW_CONNECTOR_CONTENT_OPTIONS} />
          <Form.TextArea field="headersText" label="固定请求头" placeholder='可选，JSON 对象，如 {"X-Env":"prod"}' autosize={{ minRows: 1, maxRows: 4 }} />
          <Form.TextArea field="queryText" label="固定查询参数" placeholder='可选，JSON 对象，如 {"version":"v1"}' autosize={{ minRows: 1, maxRows: 4 }} />
        </Form.Section>}

        {isWorkflowHttpConnector(connectorType) && <Form.Section text={`凭据（${editing ? '留空保留原凭据；' : ''}AES 加密存储，不回显）`}>
          {authType === 'none' && (
            <Typography.Text type="tertiary" size="small">当前鉴权方式为「无」，无需配置凭据。</Typography.Text>
          )}
          {authType === 'apiKey' && (
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Input field="apiKeyHeader" label="API Key 头名" placeholder="默认 X-API-Key" /></Col>
              <Col xs={24} sm={12}><FormPasswordInput field="apiKey" label="API Key" /></Col>
            </Row>
          )}
          {authType === 'bearer' && (
            <FormPasswordInput field="token" label="Bearer Token" />
          )}
          {authType === 'basic' && (
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Input field="username" label="Basic 用户名" /></Col>
              <Col xs={24} sm={12}><FormPasswordInput field="password" label="Basic 密码" /></Col>
            </Row>
          )}
          {editing && <Form.Checkbox field="clearCredentials" noLabel>清空已配置凭据</Form.Checkbox>}
        </Form.Section>}

        <Form.Section text="调用策略 · 熔断 · 限流">
          {isWorkflowHttpConnector(connectorType) && <Row gutter={16}>
            <Col xs={24} sm={12}><Form.InputNumber field="timeoutMs" label="超时(ms)" min={100} max={120000} step={500} style={{ width: '100%' }} /></Col>
            <Col xs={24} sm={12}><Form.InputNumber field="retryMax" label="重试次数" min={0} max={10} style={{ width: '100%' }} /></Col>
          </Row>}
          <Form.Switch field="circuitBreakerEnabled" label="启用熔断" />
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.InputNumber field="failureThreshold" label="失败阈值" min={1} max={100} style={{ width: '100%' }} /></Col>
            <Col xs={24} sm={12}><Form.InputNumber field="cooldownSec" label="冷却(秒)" min={1} max={3600} style={{ width: '100%' }} /></Col>
          </Row>
          <Form.Switch field="rateLimitEnabled" label="启用限流" extraText="保护下游：滑动窗口内超过最大调用次数即快速失败（不计入熔断）" />
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.InputNumber field="rateLimitWindowSec" label="时间窗(秒)" min={1} max={3600} style={{ width: '100%' }} /></Col>
            <Col xs={24} sm={12}><Form.InputNumber field="rateLimitMax" label="窗口内上限" min={0} max={100000} style={{ width: '100%' }} extraText="0=不限制" /></Col>
          </Row>
        </Form.Section>
      </EditFormSheet>

      <AppModal
        title={`测试调用 · ${testTarget?.name ?? ''}`}
        visible={testVisible}
        onCancel={() => setTestVisible(false)}
        onOk={() => void runTest()}
        okText="发送测试"
        okButtonProps={{ loading: testMutation.isPending }}
        width={560}
        closeOnEsc
      >
        {testTarget && isWorkflowHttpConnector(testTarget.type) && <Input prefix="路径" value={testPath} onChange={setTestPath} placeholder="可选，相对基础地址的路径，如 /health" style={{ marginBottom: 12 }} showClear />}
        {testTarget && <TextArea value={testBodyText} onChange={setTestBodyText} autosize={{ minRows: 3, maxRows: 8 }}
          placeholder={testTarget.type === 'email' || ['wecom', 'dingtalk', 'feishu'].includes(testTarget.type) ? '测试消息正文' : '可选，测试数据 JSON；短信填写模板变量'}
          style={{ marginBottom: 12 }} />}
        {testTarget && !isWorkflowHttpConnector(testTarget.type) && <Banner type="warning" fullMode={false} closeIcon={null}
          description={testTarget.type === 'email' ? `测试将向 ${String(testTarget.config.to ?? '')} 发送邮件。` : `测试将向 ${String(testTarget.config.phone ?? '')} 发送短信。`} />}
        <Spin spinning={testMutation.isPending}>
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
                  <TextBlock maxHeight="40vh" style={{ marginTop: 4 }}>{testResult.responseSnippet}</TextBlock>
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
        <Spin spinning={monitorQuery.isFetching}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Typography.Text type="tertiary" size="small">统计窗口</Typography.Text>
            <Select
              size="small" value={monitorDays} style={{ width: 120 }}
              onChange={(v) => setMonitorDays(v as number)}
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
                <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)', padding: '10px 12px' }}>
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
              { title: '来源', dataIndex: 'source', width: 100, render: (s: WorkflowConnectorInvocation['source']) => <Tag size="small" color="blue">{WORKFLOW_CONNECTOR_INVOCATION_SOURCE_LABELS[s] ?? s}</Tag> },
              { title: '结果', dataIndex: 'ok', width: 80, render: (ok: boolean) => <Tag size="small" color={ok ? 'green' : 'red'}>{ok ? '成功' : '失败'}</Tag> },
              { title: '状态码', dataIndex: 'status', width: 80, render: (v: number | null) => v ?? EMPTY_PLACEHOLDER },
              { title: '耗时', dataIndex: 'durationMs', width: 80, align: 'right', render: (v: number) => `${v}ms` },
              { title: '地址', dataIndex: 'requestUrl', width: 200, render: renderEllipsis },
              { title: '错误', dataIndex: 'error', width: 180, render: renderEllipsis },
              dateTimeColumn('时间', 'createdAt'),
            ]}
            scroll={{ y: '50vh' }}
          />
        </Spin>
      </SideSheet>
    </div>
  );
}
