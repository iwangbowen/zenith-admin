import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, JsonViewer, Select, Space, Spin, Tabs, TabPane, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Activity, AlertTriangle, CheckCircle2, DatabaseZap, Gauge, GitBranch, RefreshCw, TimerReset } from 'lucide-react';
import type {
  WorkflowEngineComponent,
  WorkflowEngineComponentStatus,
  WorkflowEngineDefinitionValidationItem,
  WorkflowEngineIntrospection,
  WorkflowEngineOutboxEvent,
  WorkflowEngineQueueKey,
  WorkflowEngineQueueSnapshot,
  WorkflowEngineRuntimeIssue,
  WorkflowEngineRuntimeTask,
  WorkflowEngineTriggerExecution,
} from '@zenith/shared';
import ConfigurableTable from '@/components/ConfigurableTable';
import { request } from '@/utils/request';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const STATUS_META: Record<WorkflowEngineComponentStatus, { text: string; color: TagColor }> = {
  healthy: { text: '正常', color: 'green' },
  warning: { text: '关注', color: 'orange' },
  critical: { text: '严重', color: 'red' },
};

const ISSUE_META: Record<WorkflowEngineRuntimeIssue['severity'], { text: string; color: TagColor }> = {
  info: { text: '信息', color: 'blue' },
  warning: { text: '警告', color: 'orange' },
  critical: { text: '严重', color: 'red' },
};

const QUEUE_LABEL: Record<WorkflowEngineQueueKey, string> = {
  humanTasks: '人工任务',
  delayWakeups: '延时唤醒',
  timeouts: '超时处理',
  triggerDispatch: '触发器调度',
  externalApprovals: '外部审批',
  subProcessJoin: '子流程汇聚',
  eventOutbox: '事件 Outbox',
};

const REF_TYPE_LABEL: Record<NonNullable<WorkflowEngineRuntimeIssue['refType']>, string> = {
  definition: '定义',
  instance: '实例',
  task: '任务',
  triggerExecution: '触发器执行',
  outbox: 'Outbox',
  scheduler: '调度器',
};

const NODE_TYPE_LABEL: Record<string, string> = {
  start: '开始',
  approve: '审批',
  handler: '办理',
  end: '结束',
  exclusiveGateway: '条件网关',
  parallelGateway: '并行网关',
  inclusiveGateway: '包容网关',
  routeGateway: '路由网关',
  ccNode: '抄送',
  delay: '延时',
  trigger: '触发器',
  subProcess: '子流程',
  catchNode: '捕获',
};

const THRESHOLD_OPTIONS = [
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '3 小时', value: 180 },
  { label: '12 小时', value: 720 },
];

const HEADER_TAG_STYLE = { height: 32, display: 'inline-flex', alignItems: 'center', borderRadius: 6, margin: 0 } as const;

function statusTag(status: WorkflowEngineComponentStatus) {
  const meta = STATUS_META[status];
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

function issueTag(severity: WorkflowEngineRuntimeIssue['severity']) {
  const meta = ISSUE_META[severity];
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

function rawTag(value: string | null | undefined, color: TagColor = 'grey') {
  return value ? <Tag color={color}>{value}</Tag> : <Typography.Text type="tertiary">—</Typography.Text>;
}

function formatAge(value: number | null | undefined) {
  if (value == null) return '—';
  if (value >= 24 * 60) {
    const days = Math.floor(value / (24 * 60));
    const hours = Math.floor((value % (24 * 60)) / 60);
    return `${days} 天 ${hours} 小时`;
  }
  if (value >= 60) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return `${value} 分钟`;
}

function formatMs(value: number | null | undefined) {
  if (value == null) return '—';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function renderJsonBlock(value: unknown) {
  return (
    <JsonViewer
      value={JSON.stringify(value, null, 2)}
      width="100%"
      height={520}
      showSearch
      options={{ readOnly: true, autoWrap: true, formatOptions: { tabSize: 2 } }}
    />
  );
}

function renderMetric(metric: WorkflowEngineComponent['metrics'][number]) {
  const value = metric.unit ? `${metric.value}${metric.unit}` : metric.value;
  return (
    <div
      key={`${metric.label}-${metric.value}`}
      style={{
        minWidth: 0,
        padding: '8px 10px',
        borderRadius: 6,
        background: 'var(--semi-color-fill-0)',
        border: '1px solid var(--semi-color-border)',
      }}
    >
      <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{metric.label}</Typography.Text>
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Typography.Text strong ellipsis={{ showTooltip: true }}>{value}</Typography.Text>
        {metric.status && statusTag(metric.status)}
      </div>
      {metric.hint && (
        <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{metric.hint}</Typography.Text>
      )}
    </div>
  );
}

function renderComponentIcon(component: WorkflowEngineComponent) {
  const statusColor = component.status === 'critical' ? '#ff4d4f' : component.status === 'warning' ? 'var(--semi-color-warning)' : 'var(--semi-color-success)';
  if (component.key === 'scheduler' || component.key === 'delayScheduler' || component.key === 'timeoutProcessor') {
    return <TimerReset size={18} color={statusColor} />;
  }
  if (component.key === 'eventBus' || component.key === 'outbox') {
    return <DatabaseZap size={18} color={statusColor} />;
  }
  if (component.key === 'dagExecutor' || component.key === 'subProcessRecovery') {
    return <GitBranch size={18} color={statusColor} />;
  }
  return <Activity size={18} color={statusColor} />;
}

export default function WorkflowEngineDiagnosticsView() {
  const [thresholdMinutes, setThresholdMinutes] = useState(30);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkflowEngineIntrospection | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<WorkflowEngineIntrospection>(`/api/workflows/engine/introspection?thresholdMinutes=${thresholdMinutes}`);
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [thresholdMinutes]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const criticalCount = useMemo(() => data?.issues.filter((item) => item.severity === 'critical').length ?? 0, [data]);
  const warningCount = useMemo(() => data?.issues.filter((item) => item.severity === 'warning').length ?? 0, [data]);
  const nodeTypeRows = useMemo(() => (
    Object.entries(data?.definitions.nodeTypeCounts ?? {}).map(([type, count]) => ({
      type,
      label: NODE_TYPE_LABEL[type] ?? type,
      count,
    }))
  ), [data]);

  const queueColumns: ColumnProps<WorkflowEngineQueueSnapshot>[] = [
    { title: '队列', dataIndex: 'name', width: 160, render: (_value, record) => <Typography.Text strong>{record.name}</Typography.Text> },
    { title: '状态', dataIndex: 'status', width: 90, render: (value) => statusTag(value as WorkflowEngineComponentStatus) },
    { title: 'Ready', dataIndex: 'ready', width: 90 },
    { title: 'Running', dataIndex: 'running', width: 90 },
    { title: 'Delayed', dataIndex: 'delayed', width: 90 },
    { title: 'Failed', dataIndex: 'failed', width: 90 },
    { title: '最老等待', dataIndex: 'oldestAgeMinutes', width: 120, render: (value) => formatAge(value as number | null) },
    {
      title: '细节',
      dataIndex: 'details',
      render: (_value, record) => {
        const entries = Object.entries(record.details ?? {});
        if (entries.length === 0) return <Typography.Text type="tertiary">—</Typography.Text>;
        return (
          <Space wrap>
            {entries.map(([key, value]) => <Tag key={key} color="grey">{key}: {value ?? '—'}</Tag>)}
          </Space>
        );
      },
    },
  ];

  const issueColumns: ColumnProps<WorkflowEngineRuntimeIssue>[] = [
    { title: '级别', dataIndex: 'severity', width: 90, render: (value) => issueTag(value as WorkflowEngineRuntimeIssue['severity']) },
    { title: '组件', dataIndex: 'component', width: 150, render: (value) => data?.components.find((item) => item.key === value)?.name ?? value },
    {
      title: '问题',
      dataIndex: 'title',
      width: 360,
      render: (_value, record) => (
        <div style={{ minWidth: 0 }}>
          <Typography.Text strong ellipsis={{ showTooltip: true }}>{record.title}</Typography.Text>
          <div><Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{record.description}</Typography.Text></div>
        </div>
      ),
    },
    {
      title: '对象',
      width: 150,
      render: (_value, record) => (
        record.refType ? `${REF_TYPE_LABEL[record.refType]}${record.refId != null ? ` #${record.refId}` : ''}` : '—'
      ),
    },
    { title: '等待时长', dataIndex: 'ageMinutes', width: 120, render: (value) => formatAge(value as number | null) },
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (value) => value || '—' },
  ];

  const taskColumns: ColumnProps<WorkflowEngineRuntimeTask>[] = [
    { title: '队列', dataIndex: 'queue', width: 120, render: (value) => <Tag color="blue">{QUEUE_LABEL[value as WorkflowEngineQueueKey]}</Tag> },
    { title: 'Task ID', dataIndex: 'taskId', width: 90 },
    {
      title: '实例',
      dataIndex: 'instanceTitle',
      width: 300,
      render: (_value, record) => (
        <div style={{ minWidth: 0 }}>
          <Typography.Text strong ellipsis={{ showTooltip: true }}>{record.instanceTitle}</Typography.Text>
          <div><Typography.Text type="tertiary" size="small">{record.serialNo ?? `#${record.instanceId}`}</Typography.Text></div>
        </div>
      ),
    },
    { title: '节点', dataIndex: 'nodeName', width: 180, render: (_value, record) => `${record.nodeName || record.nodeKey}${record.nodeType ? ` / ${NODE_TYPE_LABEL[record.nodeType] ?? record.nodeType}` : ''}` },
    { title: '状态', dataIndex: 'status', width: 100, render: (value) => rawTag(value as string, 'grey') },
    { title: '处理人', dataIndex: 'assigneeName', width: 110, render: (value) => value || '—' },
    { title: '触发器', dataIndex: 'triggerDispatchStatus', width: 110, render: (value) => rawTag(value as string | null, value === 'failed' ? 'red' : value === 'retrying' ? 'orange' : 'grey') },
    { title: '外部审批', dataIndex: 'externalDispatchStatus', width: 110, render: (value) => rawTag(value as string | null, value === 'failed' ? 'red' : 'grey') },
    { title: 'timeoutAt', dataIndex: 'timeoutAt', width: 170, render: (value) => value || '—' },
    { title: 'wakeAt', dataIndex: 'wakeAt', width: 170, render: (value) => value || '—' },
    { title: '年龄', dataIndex: 'ageMinutes', width: 110, render: (value) => formatAge(value as number | null) },
  ];

  const triggerColumns: ColumnProps<WorkflowEngineTriggerExecution>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '实例', dataIndex: 'instanceTitle', width: 260, render: (value, record) => value || `#${record.instanceId}` },
    { title: '节点', dataIndex: 'nodeName', width: 160, render: (value, record) => value || record.nodeKey },
    { title: '类型', dataIndex: 'triggerType', width: 120 },
    { title: '状态', dataIndex: 'status', width: 100, render: (value) => rawTag(value as string, value === 'failed' ? 'red' : value === 'retrying' ? 'orange' : 'blue') },
    { title: '尝试', dataIndex: 'attempt', width: 80 },
    { title: '耗时', dataIndex: 'durationMs', width: 100, render: (value) => value == null ? '—' : `${value}ms` },
    { title: '错误', dataIndex: 'errorMessage', width: 260, render: (value) => value || '—' },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
  ];

  const outboxColumns: ColumnProps<WorkflowEngineOutboxEvent>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '事件', dataIndex: 'eventType', width: 180 },
    { title: '实例', dataIndex: 'instanceTitle', width: 260, render: (value, record) => value || (record.instanceId != null ? `#${record.instanceId}` : '—') },
    { title: '状态', dataIndex: 'status', width: 100, render: (value) => rawTag(value as string, value === 'failed' ? 'red' : value === 'retrying' ? 'orange' : 'blue') },
    { title: '尝试', dataIndex: 'attempts', width: 80 },
    { title: '下次重试', dataIndex: 'nextRetryAt', width: 170, render: (value) => value || '—' },
    { title: '错误', dataIndex: 'errorMessage', width: 260, render: (value) => value || '—' },
    { title: '年龄', dataIndex: 'ageMinutes', width: 110, render: (value) => formatAge(value as number | null) },
  ];

  const invalidDefinitionColumns: ColumnProps<WorkflowEngineDefinitionValidationItem>[] = [
    { title: '定义 ID', dataIndex: 'definitionId', width: 100 },
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '状态', dataIndex: 'status', width: 100, render: (value) => rawTag(value as string, value === 'published' ? 'green' : 'grey') },
    { title: '版本', dataIndex: 'version', width: 80 },
    { title: '错误', dataIndex: 'errors', render: (value) => (Array.isArray(value) ? value.join('；') : '—') },
  ];

  const nodeTypeColumns: ColumnProps<{ type: string; label: string; count: number }>[] = [
    { title: '节点类型', dataIndex: 'label', width: 160 },
    { title: 'Key', dataIndex: 'type', width: 180 },
    { title: '数量', dataIndex: 'count', width: 100 },
  ];

  const listenerColumns: ColumnProps<WorkflowEngineIntrospection['eventBus']['listeners'][number]>[] = [
    { title: '事件类型', dataIndex: 'eventType' },
    { title: '监听器数', dataIndex: 'listenerCount', width: 120 },
  ];

  const recurringJobColumns: ColumnProps<WorkflowEngineIntrospection['telemetry']['recurringJobs'][number]>[] = [
    { title: '任务名', dataIndex: 'name' },
    { title: 'Cron', dataIndex: 'cronExpression', width: 150 },
    { title: '下次执行', dataIndex: 'nextRunAt', width: 180, render: (value) => value || '—' },
    { title: '注册时间', dataIndex: 'registeredAt', width: 180 },
  ];

  const queueWorkerColumns: ColumnProps<WorkflowEngineIntrospection['scheduler']['systemQueueWorkers'][number]>[] = [
    { title: 'Worker', dataIndex: 'name' },
    { title: '注册时间', dataIndex: 'registeredAt', width: 180 },
  ];

  const wipColumns: ColumnProps<WorkflowEngineIntrospection['scheduler']['wip'][number]>[] = [
    { title: '队列', dataIndex: 'name' },
    { title: '运行中', dataIndex: 'count', width: 100 },
  ];

  const taskRows = useMemo(() => (
    data?.runtime.taskQueue.map((item) => ({ ...item, rowId: `${item.queue}-${item.taskId}` })) ?? []
  ), [data]);

  const telemetryMetrics = useMemo<WorkflowEngineComponent['metrics']>(() => {
    if (!data) return [];
    const t = data.telemetry;
    const scoreStatus: WorkflowEngineComponentStatus = t.healthScore >= 90 ? 'healthy' : t.healthScore >= 70 ? 'warning' : 'critical';
    return [
      { label: '健康分', value: t.healthScore, status: scoreStatus, hint: '满分 100' },
      { label: '运行实例', value: t.instances.running, hint: `24h 新增 ${t.instances.createdLast24h}` },
      { label: '24h 完结', value: t.instances.completedLast24h, hint: `取消 ${t.instances.canceledLast24h}` },
      { label: '事件 1h', value: t.events.last1h.total, hint: `成功 ${t.events.last1h.success} / 失败 ${t.events.last1h.failed}` },
      { label: '事件 24h', value: t.events.last24h.total, status: t.events.last24h.failed > 0 ? 'warning' : null, hint: `成功 ${t.events.last24h.success} / 失败 ${t.events.last24h.failed}` },
      { label: '待重放事件', value: t.events.pendingRetry, status: t.events.pendingRetry > 0 ? 'warning' : null },
      { label: '事件延迟', value: formatMs(t.events.avgLatencyMs), hint: '近 24h 均值' },
      { label: '触发器 24h', value: t.triggers.last24h.total, status: t.triggers.last24h.failed > 0 ? 'critical' : null, hint: `失败 ${t.triggers.last24h.failed} / 重试 ${t.triggers.last24h.retrying}` },
      { label: '触发耗时', value: formatMs(t.triggers.avgDurationMs), hint: '近 24h 成功均值' },
    ];
  }, [data]);

  if (loading && !data) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (!data) {
    return <Empty description="暂无引擎内省数据" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Space wrap align="center">
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 32,
              padding: '0 12px',
              borderRadius: 6,
              border: '1px solid var(--semi-color-border)',
              background: data.healthy ? 'var(--semi-color-success-light-default)' : 'var(--semi-color-danger-light-default)',
            }}
          >
            {data.healthy ? <CheckCircle2 size={16} color="var(--semi-color-success)" /> : <AlertTriangle size={16} color="var(--semi-color-danger)" />}
            <Typography.Text strong>{data.healthy ? '引擎状态正常' : '引擎存在严重事项'}</Typography.Text>
            <Typography.Text type="tertiary" size="small">· {data.generatedAt} 生成 · 阈值 {data.thresholdMinutes} 分钟</Typography.Text>
          </div>
          <Tag size="large" style={HEADER_TAG_STYLE} color={data.telemetry.healthScore >= 90 ? 'green' : data.telemetry.healthScore >= 70 ? 'orange' : 'red'}>健康分 {data.telemetry.healthScore}</Tag>
          <Tag size="large" style={HEADER_TAG_STYLE} color={criticalCount > 0 ? 'red' : 'green'}>严重 {criticalCount}</Tag>
          <Tag size="large" style={HEADER_TAG_STYLE} color={warningCount > 0 ? 'orange' : 'grey'}>警告 {warningCount}</Tag>
          <Tag size="large" style={HEADER_TAG_STYLE} color="blue">运行实例 {data.runtime.runningInstances}</Tag>
          <Tag size="large" style={HEADER_TAG_STYLE} color="purple">监听器 {data.eventBus.totalListenerCount}</Tag>
        </Space>
        <Space wrap align="center">
          <Select
            value={thresholdMinutes}
            optionList={THRESHOLD_OPTIONS}
            style={{ width: 128 }}
            onChange={(value) => setThresholdMinutes(Number(value))}
          />
          <Button type="primary" icon={<RefreshCw size={14} />} loading={loading} onClick={() => void fetchData()}>刷新</Button>
        </Space>
      </div>

      <Card bordered bodyStyle={{ padding: 14 }} style={{ borderRadius: 8 }}>
        <div style={{ marginBottom: 10 }}>
          <Space spacing={8}>
            <Gauge size={18} color="var(--semi-color-primary)" />
            <Typography.Text strong>引擎遥测</Typography.Text>
            <Typography.Text type="tertiary" size="small">近 1h / 24h 吞吐、延迟与生命周期</Typography.Text>
          </Space>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {telemetryMetrics.map(renderMetric)}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {data.components.map((component) => (
          <Card
            key={component.key}
            bordered
            bodyStyle={{ padding: 14 }}
            style={{ borderRadius: 8, borderColor: component.status === 'critical' ? 'var(--semi-color-danger)' : component.status === 'warning' ? 'var(--semi-color-warning)' : 'var(--semi-color-border)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <Space spacing={8}>
                  {renderComponentIcon(component)}
                  <Typography.Text strong ellipsis={{ showTooltip: true }}>{component.name}</Typography.Text>
                </Space>
                <div style={{ marginTop: 4 }}>
                  <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{component.description}</Typography.Text>
                </div>
              </div>
              {statusTag(component.status)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
              {component.metrics.map(renderMetric)}
            </div>
          </Card>
        ))}
      </div>

      <ConfigurableTable<WorkflowEngineQueueSnapshot>
        bordered
        columnSettings={false}
        columns={queueColumns}
        dataSource={data.queues}
        rowKey="key"
        pagination={false}
        scroll={{ x: 860 }}
      />

      <Tabs type="line">
        <TabPane tab={`问题 ${data.issues.length}`} itemKey="issues">
          <ConfigurableTable<WorkflowEngineRuntimeIssue>
            bordered
            columnSettings={false}
            columns={issueColumns}
            dataSource={data.issues}
            rowKey="id"
            pagination={false}
            empty="未发现运行时问题"
            scroll={{ x: 1160 }}
          />
        </TabPane>
        <TabPane tab={`队列任务 ${data.runtime.taskQueue.length}`} itemKey="tasks">
          <ConfigurableTable<WorkflowEngineRuntimeTask>
            bordered
            columnSettings={false}
            columns={taskColumns}
            dataSource={taskRows}
            rowKey="rowId"
            pagination={false}
            empty="暂无内部队列任务"
            scroll={{ x: 1510 }}
          />
        </TabPane>
        <TabPane tab={`Outbox ${data.runtime.outboxEvents.length}`} itemKey="outbox">
          <ConfigurableTable<WorkflowEngineOutboxEvent>
            bordered
            columnSettings={false}
            columns={outboxColumns}
            dataSource={data.runtime.outboxEvents}
            rowKey="id"
            pagination={false}
            empty="暂无待处理 Outbox 事件"
            scroll={{ x: 1230 }}
          />
        </TabPane>
        <TabPane tab={`触发器 ${data.runtime.triggerExecutions.length}`} itemKey="triggers">
          <ConfigurableTable<WorkflowEngineTriggerExecution>
            bordered
            columnSettings={false}
            columns={triggerColumns}
            dataSource={data.runtime.triggerExecutions}
            rowKey="id"
            pagination={false}
            empty="暂无异常触发器执行"
            scroll={{ x: 1330 }}
          />
        </TabPane>
        <TabPane tab="定义校验" itemKey="definitions">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)', gap: 12 }}>
            <ConfigurableTable<WorkflowEngineDefinitionValidationItem>
              bordered
              columnSettings={false}
              columns={invalidDefinitionColumns}
              dataSource={data.definitions.invalidDefinitions}
              rowKey="definitionId"
              pagination={false}
              empty="流程定义均通过当前引擎校验"
              scroll={{ x: 820 }}
            />
            <ConfigurableTable<{ type: string; label: string; count: number }>
              bordered
              columnSettings={false}
              columns={nodeTypeColumns}
              dataSource={nodeTypeRows}
              rowKey="type"
              pagination={false}
              empty="暂无节点统计"
              scroll={{ x: 440 }}
            />
          </div>
        </TabPane>
        <TabPane tab="事件与调度" itemKey="scheduler">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <ConfigurableTable
              bordered
              columnSettings={false}
              columns={listenerColumns}
              dataSource={data.eventBus.listeners}
              rowKey="eventType"
              pagination={false}
              empty="暂无事件监听器"
            />
            <ConfigurableTable
              bordered
              columnSettings={false}
              columns={recurringJobColumns}
              dataSource={data.telemetry.recurringJobs}
              rowKey="name"
              pagination={false}
              empty="暂无系统周期任务"
            />
            <ConfigurableTable
              bordered
              columnSettings={false}
              columns={queueWorkerColumns}
              dataSource={data.scheduler.systemQueueWorkers}
              rowKey="name"
              pagination={false}
              empty="暂无系统队列 Worker"
            />
            <ConfigurableTable
              bordered
              columnSettings={false}
              columns={wipColumns}
              dataSource={data.scheduler.wip}
              rowKey="name"
              pagination={false}
              empty="暂无运行中 Job"
            />
          </div>
        </TabPane>
        <TabPane tab="原始快照" itemKey="raw">
          {renderJsonBlock(data)}
        </TabPane>
      </Tabs>
    </div>
  );
}
