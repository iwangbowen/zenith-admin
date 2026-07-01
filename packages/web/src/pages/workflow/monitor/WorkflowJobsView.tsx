import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Button,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  JsonViewer,
  Modal,
  Popconfirm,
  Radio,
  RadioGroup,
  Row,
  Select,
  SideSheet,
  Space,
  Table,
  Tabs,
  TabPane,
  Tag,
  Timeline,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Download, RotateCcw, Search } from 'lucide-react';
import type { PaginatedResponse, WorkflowJob, WorkflowJobBatchResult, WorkflowJobChain, WorkflowJobExecution, WorkflowJobStatus, WorkflowJobSummaryItem, WorkflowJobType } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'orange' | 'red' | 'violet';

const JOB_TYPE_META: Record<WorkflowJobType, { text: string; color: TagColor }> = {
  delay_wake: { text: '延时唤醒', color: 'cyan' },
  task_timeout: { text: '任务超时', color: 'amber' },
  trigger_dispatch: { text: '触发器调度', color: 'blue' },
  external_dispatch: { text: '外部审批', color: 'violet' },
  subprocess_spawn: { text: '子流程派生', color: 'green' },
  subprocess_join: { text: '子流程汇聚', color: 'green' },
  event_dispatch: { text: '事件派发', color: 'orange' },
  webhook_delivery: { text: 'Webhook 投递', color: 'orange' },
};

const JOB_TYPES = Object.keys(JOB_TYPE_META) as WorkflowJobType[];
const JOB_TYPE_OPTIONS = JOB_TYPES.map((value) => ({ value, label: JOB_TYPE_META[value].text }));

// ── 死信聚类 / 条件重放（A2 限流 + B1 多维聚类） ──
type ClusterDimension = 'reason' | 'jobType' | 'instance' | 'trace';
interface FailureCluster {
  dimension: ClusterDimension;
  key: string;
  label: string;
  count: number;
  jobTypes: string[];
  instanceId: number | null;
  traceId: string | null;
  reasonKeyword: string | null;
}
interface WorkflowJobReplayResult {
  total: number;
  success: number;
  skipped: number;
  matched: number;
  ratePerSecond: number;
  limit: number;
}
interface WorkflowJobRuntimeStatus {
  activeWorkers: number;
  totalWorkers: number;
  workers: Array<{ nodeId: string; hostname: string | null; runningJobCount: number; lastHeartbeatAt: string | null; fresh: boolean }>;
  runningJobs: number;
  stuckRunningJobs: number;
  backlog: number;
  deadLetter: number;
  lastClaimedAt: string | null;
  failureRate: number;
  avgDurationMs: number | null;
  recentExecutions: number;
}
interface ReplayFilterState {
  status: 'dead' | 'failed';
  jobType?: WorkflowJobType;
  instanceId?: number;
  traceId?: string;
  reasonKeyword?: string;
  olderThanMinutes?: number;
  ratePerSecond: number;
  limit: number;
}
const CLUSTER_DIM_OPTIONS: Array<{ value: ClusterDimension; label: string }> = [
  { value: 'reason', label: '错误原因' },
  { value: 'jobType', label: '作业类型' },
  { value: 'instance', label: '实例' },
  { value: 'trace', label: 'TraceId' },
];
const REPLAY_STATUS_OPTIONS = [
  { value: 'dead', label: '死信 (dead)' },
  { value: 'failed', label: '失败 (failed)' },
];

const JOB_STATUS_META: Record<WorkflowJobStatus, { text: string; color: TagColor }> = {
  pending: { text: '待处理', color: 'grey' },
  running: { text: '运行中', color: 'blue' },
  succeeded: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'orange' },
  dead: { text: '死信', color: 'red' },
  canceled: { text: '已取消', color: 'grey' },
};

const EXEC_STATUS_META: Record<WorkflowJobExecution['status'], { text: string; color: TagColor }> = {
  running: { text: '执行中', color: 'blue' },
  succeeded: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'red' },
};

const EXEC_TIMELINE_TYPE: Record<WorkflowJobExecution['status'], 'ongoing' | 'success' | 'error'> = {
  running: 'ongoing',
  succeeded: 'success',
  failed: 'error',
};

/** 执行记录时间线：按尝试次序升序，请求/响应/错误仅在有值时内联 */
function renderExecutionTimeline(executions: WorkflowJobExecution[]) {
  const sorted = [...executions].sort((a, b) => a.attempt - b.attempt);
  return (
    <Timeline>
      {sorted.map((ex) => {
        const m = EXEC_STATUS_META[ex.status];
        return (
          <Timeline.Item key={ex.id} type={EXEC_TIMELINE_TYPE[ex.status] ?? 'default'} time={ex.finishedAt ?? ex.createdAt}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Typography.Text strong size="small">第 {ex.attempt} 次</Typography.Text>
              <Tag size="small" color={m?.color ?? 'grey'}>{m?.text ?? ex.status}</Tag>
              {ex.durationMs != null && <Typography.Text size="small" type="tertiary">{ex.durationMs}ms</Typography.Text>}
            </div>
            {ex.requestUrl && (
              <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ display: 'block', maxWidth: 560, marginTop: 2 }}>
                {ex.requestMethod ? `${ex.requestMethod} ` : ''}{ex.requestUrl}{ex.responseStatus != null ? ` → ${ex.responseStatus}` : ''}
              </Typography.Text>
            )}
            {ex.errorMessage && (
              <Typography.Paragraph size="small" type="danger" style={{ margin: '2px 0 0', wordBreak: 'break-all' }}>{ex.errorMessage}</Typography.Paragraph>
            )}
          </Timeline.Item>
        );
      })}
    </Timeline>
  );
}

const JOB_STATUS_OPTIONS = (Object.keys(JOB_STATUS_META) as WorkflowJobStatus[]).map((value) => ({ value, label: JOB_STATUS_META[value].text }));

type WorkflowJobDetail = WorkflowJob & { executions: WorkflowJobExecution[] };

const EMPTY_SUMMARY = (jobType: WorkflowJobType): WorkflowJobSummaryItem => ({ jobType, total: 0, pending: 0, running: 0, succeeded: 0, failed: 0, dead: 0, canceled: 0 });

function renderStatusTag(status: WorkflowJobStatus) {
  const meta = JOB_STATUS_META[status];
  return <Tag color={meta?.color ?? 'grey'} size="small">{meta?.text ?? status}</Tag>;
}

/** 从 payload 中提取最能区分同类型作业的摘要（如事件派发的事件类型） */
function jobSummaryText(record: WorkflowJob): string {
  const p = (record.payload ?? {}) as Record<string, unknown>;
  const event = p.event as Record<string, unknown> | undefined;
  switch (record.jobType) {
    case 'event_dispatch':
      return (event?.type as string) ?? '—';
    case 'webhook_delivery': {
      const sub = p.subscriptionId != null ? `#${p.subscriptionId} ` : '';
      return `${sub}${(event?.type as string) ?? ''}`.trim() || '—';
    }
    case 'trigger_dispatch':
      return p.kind != null ? `kind=${p.kind}` : (record.nodeKey ?? '—');
    case 'external_dispatch': {
      const method = p.method != null ? `${p.method} ` : '';
      const endpoint = (p.endpoint as string) ?? '';
      return `${method}${endpoint}`.trim() || (record.nodeKey ?? '—');
    }
    case 'subprocess_join':
      return p.childInstanceId != null ? `child #${p.childInstanceId}` : '—';
    case 'subprocess_spawn':
      return p.childDefinitionId != null ? `def #${p.childDefinitionId}` : (record.nodeKey ?? '—');
    default:
      return record.nodeKey ?? '—';
  }
}

// ───────────────────────── 单作业类型明细面板 ─────────────────────────

interface JobTypePanelProps {
  jobType: WorkflowJobType;
  summary: WorkflowJobSummaryItem;
  onMutated: () => void;
}

function JobTypePanel({ jobType, summary, onMutated }: JobTypePanelProps) {
  const { hasPermission } = usePermission();
  const canOperate = hasPermission('workflow:engine:operate');

  const [data, setData] = useState<PaginatedResponse<WorkflowJob> | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<WorkflowJobStatus | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const { page, pageSize, setPage, resetPage, buildPagination } = usePagination();

  const [detail, setDetail] = useState<WorkflowJobDetail | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [execView, setExecView] = useState<'timeline' | 'table'>('timeline');
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [clusters, setClusters] = useState<FailureCluster[] | null>(null);
  const [clusterDim, setClusterDim] = useState<ClusterDimension>('reason');
  const [clusterLoading, setClusterLoading] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [replayPreview, setReplayPreview] = useState<number | null>(null);
  const [replayFilter, setReplayFilter] = useState<ReplayFilterState>({ status: 'dead', jobType, ratePerSecond: 20, limit: 500 });
  const [replayFormKey, setReplayFormKey] = useState(0);

  const openClusters = async (dim: ClusterDimension = clusterDim) => {
    setClusterDim(dim);
    setClusters((prev) => prev ?? []);
    setClusterLoading(true);
    try {
      const r = await request.get<FailureCluster[]>(`/api/workflows/engine/jobs/failure-clusters?dimension=${dim}`);
      setClusters(r.data ?? []);
    } finally {
      setClusterLoading(false);
    }
  };

  const openReplay = (prefill?: Partial<ReplayFilterState>) => {
    setReplayFilter({ status: 'dead', jobType, ratePerSecond: 20, limit: 500, ...prefill });
    setReplayPreview(null);
    setReplayFormKey((k) => k + 1);
    setReplayOpen(true);
  };

  const replayCluster = (c: FailureCluster) => {
    const prefill: Partial<ReplayFilterState> =
      c.dimension === 'jobType' ? { jobType: c.key as WorkflowJobType, reasonKeyword: undefined, instanceId: undefined, traceId: undefined }
        : c.dimension === 'instance' ? { instanceId: c.instanceId ?? undefined, jobType: undefined, reasonKeyword: undefined, traceId: undefined }
          : c.dimension === 'trace' ? { traceId: c.traceId ?? undefined, jobType: undefined, reasonKeyword: undefined, instanceId: undefined }
            : { reasonKeyword: c.reasonKeyword ?? undefined, jobType: undefined, instanceId: undefined, traceId: undefined };
    setClusters(null);
    openReplay(prefill);
  };

  const buildReplayBody = (f: ReplayFilterState) => ({
    status: f.status,
    jobType: f.jobType,
    instanceId: f.instanceId,
    traceId: f.traceId?.trim() || undefined,
    reasonKeyword: f.reasonKeyword?.trim() || undefined,
    olderThanMinutes: f.olderThanMinutes,
  });

  const doPreview = async () => {
    setPreviewLoading(true);
    try {
      const r = await request.post<{ matched: number }>('/api/workflows/engine/jobs/replay-preview', buildReplayBody(replayFilter));
      if (r.code === 0) setReplayPreview(r.data?.matched ?? 0);
    } finally {
      setPreviewLoading(false);
    }
  };

  const doReplay = async () => {
    setReplayLoading(true);
    try {
      const r = await request.post<WorkflowJobReplayResult>('/api/workflows/engine/jobs/replay-dead', { ...buildReplayBody(replayFilter), ratePerSecond: replayFilter.ratePerSecond, limit: replayFilter.limit });
      if (r.code === 0 && r.data) {
        Toast.success(r.message || `已重放 ${r.data.success}/${r.data.total}`);
        setReplayOpen(false);
        void fetchList();
        onMutated();
      } else {
        Toast.warning(r.message || '重放失败');
      }
    } finally {
      setReplayLoading(false);
    }
  };
  const [batchLoading, setBatchLoading] = useState(false);
  const [chain, setChain] = useState<WorkflowJobChain | null>(null);
  const [chainVisible, setChainVisible] = useState(false);
  const [chainLoading, setChainLoading] = useState(false);

  const fetchList = useCallback(async (p = page, ps = pageSize, st = status, kw = keyword) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), pageSize: String(ps), jobType });
      if (st) qs.set('status', st);
      if (kw.trim()) qs.set('keyword', kw.trim());
      const res = await request.get<PaginatedResponse<WorkflowJob>>(`/api/workflows/engine/jobs?${qs.toString()}`);
      if (res.code === 0) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, keyword, jobType]);

  useEffect(() => {
    void fetchList(1, pageSize, undefined, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobType]);

  const handleSearch = useCallback(() => {
    setSelectedRowKeys([]);
    resetPage();
    void fetchList(1, pageSize, status, keyword);
  }, [fetchList, pageSize, resetPage, status, keyword]);

  const handleReset = useCallback(() => {
    setStatus(undefined);
    setKeyword('');
    setSelectedRowKeys([]);
    resetPage();
    void fetchList(1, pageSize, undefined, '');
  }, [fetchList, pageSize, resetPage]);

  // 4C 死信中心：点状态汇总徽标即按该状态快速筛选（配合批量重试/跳过形成 DLQ 处置闭环）
  const filterByStatus = useCallback((st: WorkflowJobStatus) => {
    setStatus(st);
    setSelectedRowKeys([]);
    resetPage();
    void fetchList(1, pageSize, st, keyword);
  }, [fetchList, pageSize, keyword, resetPage]);

  const handleBatch = useCallback(async (action: 'retry' | 'skip') => {
    if (selectedRowKeys.length === 0) return;
    setBatchLoading(true);
    try {
      const res = await request.post<WorkflowJobBatchResult>(`/api/workflows/engine/jobs/batch-${action}`, { ids: selectedRowKeys });
      if (res.code === 0) {
        Toast.success(res.message || `已${action === 'retry' ? '重试' : '跳过'} ${res.data.success} 项`);
        setSelectedRowKeys([]);
        await fetchList();
        onMutated();
      } else {
        Toast.warning(res.message || '批量操作失败');
      }
    } catch {
      Toast.error('批量操作失败');
    } finally {
      setBatchLoading(false);
    }
  }, [selectedRowKeys, fetchList, onMutated]);

  const openDetail = useCallback(async (id: number) => {
    setDetailVisible(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await request.get<WorkflowJobDetail>(`/api/workflows/engine/jobs/${id}`);
      if (res.code === 0) setDetail(res.data);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openChain = useCallback(async (traceId: string) => {
    setChainVisible(true);
    setChain(null);
    setChainLoading(true);
    try {
      const res = await request.get<WorkflowJobChain>(`/api/workflows/engine/jobs/chain/${encodeURIComponent(traceId)}`);
      if (res.code === 0) setChain(res.data);
    } finally {
      setChainLoading(false);
    }
  }, []);

  // 4A traceId 诊断包：聚合该链路涉及实例的诊断/轨迹/Token，导出 JSON 供工单留档/离线分析
  const [bundleLoading, setBundleLoading] = useState(false);
  const downloadTraceBundle = useCallback(async (traceId: string) => {
    setBundleLoading(true);
    try {
      const res = await request.get<unknown>(`/api/workflows/engine/jobs/chain/${encodeURIComponent(traceId)}/diagnostic-bundle`);
      if (res.code !== 0) { Toast.warning(res.message || '导出失败'); return; }
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workflow-trace-${traceId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      Toast.error('导出失败');
    } finally {
      setBundleLoading(false);
    }
  }, []);

  const handleRetry = useCallback(async (id: number) => {
    setActingId(id);
    try {
      const res = await request.post<WorkflowJob>(`/api/workflows/engine/jobs/${id}/retry`);
      if (res.code === 0) {
        Toast.success('已重新入队');
        await fetchList();
        onMutated();
        if (detail?.id === id) await openDetail(id);
      } else {
        Toast.warning(res.message || '重试失败');
      }
    } catch {
      Toast.error('重试失败');
    } finally {
      setActingId(null);
    }
  }, [detail?.id, fetchList, onMutated, openDetail]);

  const handleSkip = useCallback(async (id: number) => {
    setActingId(id);
    try {
      const res = await request.post<WorkflowJob>(`/api/workflows/engine/jobs/${id}/skip`);
      if (res.code === 0) {
        Toast.success('已跳过');
        await fetchList();
        onMutated();
        if (detail?.id === id) await openDetail(id);
      } else {
        Toast.warning(res.message || '跳过失败');
      }
    } catch {
      Toast.error('跳过失败');
    } finally {
      setActingId(null);
    }
  }, [detail?.id, fetchList, onMutated, openDetail]);

  const columns: ColumnProps<WorkflowJob>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: WorkflowJobStatus) => renderStatusTag(v) },
    {
      title: '摘要',
      dataIndex: 'summary',
      width: 180,
      render: (_: unknown, record: WorkflowJob) => {
        const text = jobSummaryText(record);
        return text === '—'
          ? <Typography.Text size="small" type="tertiary">—</Typography.Text>
          : <Tooltip content={text}><Tag size="small" color="light-blue" type="light">{text}</Tag></Tooltip>;
      },
    },
    {
      title: '流程 / 实例',
      dataIndex: 'instanceId',
      width: 240,
      render: (_: unknown, record: WorkflowJob) => (
        record.instanceId ? (
          <div style={{ minWidth: 0 }}>
            <Typography.Text size="small" strong ellipsis={{ showTooltip: true }} style={{ display: 'block', maxWidth: 224 }}>
              {record.definitionName ?? '未知流程'}
            </Typography.Text>
            <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ display: 'block', maxWidth: 224 }}>
              #{record.instanceId}{record.instanceTitle ? ` · ${record.instanceTitle}` : ''}{record.nodeKey ? ` · ${record.nodeKey}` : ''}
            </Typography.Text>
          </div>
        ) : (
          <Typography.Text size="small" type="tertiary">系统事件{record.nodeKey ? ` · ${record.nodeKey}` : ''}</Typography.Text>
        )
      ),
    },
    {
      title: '尝试',
      dataIndex: 'attempts',
      width: 80,
      render: (_: unknown, record: WorkflowJob) => (
        <Typography.Text size="small" type={record.attempts >= record.maxAttempts && record.status !== 'succeeded' ? 'danger' : 'secondary'}>
          {record.attempts}/{record.maxAttempts}
        </Typography.Text>
      ),
    },
    { title: '计划执行', dataIndex: 'runAt', width: 160, render: (v: string) => <Typography.Text size="small" type="tertiary">{formatDateTime(v)}</Typography.Text> },
    {
      title: '最近错误',
      dataIndex: 'lastError',
      render: (v: string | null) => v
        ? <Tooltip content={<div style={{ maxWidth: 360, wordBreak: 'break-all' }}>{v}</div>}><Typography.Text size="small" type="danger" ellipsis={{ rows: 1 }} style={{ maxWidth: 240 }}>{v}</Typography.Text></Tooltip>
        : <Typography.Text size="small" type="tertiary">—</Typography.Text>,
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 160, render: (v: string) => <Typography.Text size="small" type="tertiary">{formatDateTime(v)}</Typography.Text> },
    createOperationColumn<WorkflowJob>({
      width: 170,
      desktopInlineKeys: ['detail', 'retry', 'skip'],
      actions: (record) => {
        const retryable = record.status === 'failed' || record.status === 'dead' || record.status === 'canceled';
        const skippable = record.status === 'pending' || record.status === 'failed' || record.status === 'dead';
        return [
          { key: 'detail', label: '详情', onClick: () => void openDetail(record.id) },
          {
            key: 'retry',
            label: (
              <Popconfirm title="确定重新入队该作业？" content="将重置尝试次数并立即排队执行" onConfirm={() => void handleRetry(record.id)}>
                <span>重试</span>
              </Popconfirm>
            ),
            hidden: !canOperate || !retryable,
            loading: actingId === record.id,
          },
          {
            key: 'skip',
            label: (
              <Popconfirm title="确定跳过该作业？" content="作业将被标记为已取消，不再执行" onConfirm={() => void handleSkip(record.id)}>
                <span>跳过</span>
              </Popconfirm>
            ),
            danger: true,
            hidden: !canOperate || !skippable,
            loading: actingId === record.id,
          },
        ];
      },
    }),
  ];

  const execColumns: ColumnProps<WorkflowJobExecution>[] = [
    { title: '#', dataIndex: 'attempt', width: 56 },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: WorkflowJobExecution['status']) => { const m = EXEC_STATUS_META[v]; return <Tag color={m?.color ?? 'grey'} size="small">{m?.text ?? v}</Tag>; } },
    {
      title: '请求',
      dataIndex: 'requestUrl',
      render: (_: unknown, r: WorkflowJobExecution) => r.requestUrl
        ? <Typography.Text size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{r.requestMethod ? `${r.requestMethod} ` : ''}{r.requestUrl}</Typography.Text>
        : <Typography.Text size="small" type="tertiary">—</Typography.Text>,
    },
    { title: '响应码', dataIndex: 'responseStatus', width: 80, render: (v: number | null) => v ?? '—' },
    { title: '耗时', dataIndex: 'durationMs', width: 90, render: (v: number | null) => v != null ? `${v}ms` : '—' },
    {
      title: '错误',
      dataIndex: 'errorMessage',
      render: (v: string | null) => v
        ? <Tooltip content={<div style={{ maxWidth: 360, wordBreak: 'break-all' }}>{v}</div>}><Typography.Text size="small" type="danger" ellipsis={{ rows: 1 }} style={{ maxWidth: 200 }}>{v}</Typography.Text></Tooltip>
        : <Typography.Text size="small" type="tertiary">—</Typography.Text>,
    },
    { title: '完成时间', dataIndex: 'finishedAt', width: 160, render: (v: string | null) => <Typography.Text size="small" type="tertiary">{v ? formatDateTime(v) : '—'}</Typography.Text> },
  ];

  const chainColumns: ColumnProps<WorkflowJob & { executions: WorkflowJobExecution[] }>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 150, render: (v: string) => <Typography.Text size="small">{formatDateTime(v)}</Typography.Text> },
    { title: '类型', dataIndex: 'jobType', width: 104, render: (v: WorkflowJobType) => <Tag color={JOB_TYPE_META[v].color} size="small">{JOB_TYPE_META[v].text}</Tag> },
    { title: '状态', dataIndex: 'status', width: 76, render: (v: WorkflowJobStatus) => renderStatusTag(v) },
    { title: '节点 / 实例', render: (_: unknown, r: WorkflowJob) => <Typography.Text size="small">{r.nodeKey ?? '—'}{r.instanceId ? ` · #${r.instanceId}` : ''}</Typography.Text> },
    { title: '尝试', width: 64, render: (_: unknown, r: WorkflowJob) => `${r.attempts}/${r.maxAttempts}` },
  ];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Tag size="large" color={JOB_TYPE_META[jobType].color}>{JOB_TYPE_META[jobType].text}</Tag>
        <Tag size="large" color="grey">总数 {summary.total}</Tag>
        <Tag size="large" color="grey">待处理 {summary.pending}</Tag>
        <Tag size="large" color="blue">运行中 {summary.running}</Tag>
        <Tag size="large" color="orange" style={{ cursor: summary.failed > 0 ? 'pointer' : 'default' }} onClick={() => { if (summary.failed > 0) filterByStatus('failed'); }}>失败 {summary.failed}</Tag>
        <Tag size="large" color="red" style={{ cursor: summary.dead > 0 ? 'pointer' : 'default' }} onClick={() => { if (summary.dead > 0) filterByStatus('dead'); }}>死信 {summary.dead}</Tag>
        <Tag size="large" color="green">成功 {summary.succeeded}</Tag>
        <Tag size="large" color="grey">已取消 {summary.canceled}</Tag>
      </div>

      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="幂等键 / TraceId / 节点"
              value={keyword}
              showClear
              style={{ width: 220 }}
              onChange={setKeyword}
              onEnterPress={handleSearch}
            />
            <Select
              placeholder="状态"
              value={status}
              optionList={JOB_STATUS_OPTIONS}
              showClear
              style={{ width: 130 }}
              onChange={(v) => setStatus(v as WorkflowJobStatus | undefined)}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            <Button type="tertiary" onClick={() => void openClusters()}>失败聚类</Button>
            {canOperate && (
              <Button type="warning" onClick={() => openReplay()}>重放死信</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="幂等键 / TraceId / 节点"
              value={keyword}
              showClear
              onChange={setKeyword}
              onEnterPress={handleSearch}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          </>
        )}
        mobileFilters={(
          <Select placeholder="状态" value={status} optionList={JOB_STATUS_OPTIONS} showClear style={{ width: '100%' }} onChange={(v) => setStatus(v as WorkflowJobStatus | undefined)} />
        )}
        filterTitle={`${JOB_TYPE_META[jobType].text}筛选`}
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {canOperate && selectedRowKeys.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '8px 12px', background: 'var(--semi-color-primary-light-default)', borderRadius: 6 }}>
          <Typography.Text size="small">已选 <b>{selectedRowKeys.length}</b> 项</Typography.Text>
          <Popconfirm title={`确定批量重试选中的 ${selectedRowKeys.length} 项？`} content="不满足条件（成功/运行中）的将自动跳过" onConfirm={() => void handleBatch('retry')}>
            <Button size="small" type="primary" loading={batchLoading}>批量重试</Button>
          </Popconfirm>
          <Popconfirm title={`确定批量跳过选中的 ${selectedRowKeys.length} 项？`} content="作业将被标记为已取消，不再执行" onConfirm={() => void handleBatch('skip')}>
            <Button size="small" type="danger" loading={batchLoading}>批量跳过</Button>
          </Popconfirm>
          <Button size="small" theme="borderless" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
        </div>
      )}

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
        scroll={{ x: 1340 }}
        rowSelection={canOperate ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]),
          getCheckboxProps: (record: WorkflowJob) => ({
            disabled: !(record.status === 'pending' || record.status === 'failed' || record.status === 'dead' || record.status === 'canceled'),
          }),
        } : undefined}
        pagination={buildPagination(data?.total ?? 0, (p, ps) => { setPage(p); void fetchList(p, ps); })}
      />

      <SideSheet
        title={detail ? `作业 #${detail.id} 详情` : '作业详情'}
        visible={detailVisible}
        onCancel={() => setDetailVisible(false)}
        width="min(720px, 96vw)"
      >
        {detailLoading && <Empty description="加载中…" />}
        {!detailLoading && detail && (
          <Space vertical align="start" style={{ width: '100%' }} spacing={16}>
            <Descriptions
              align="left"
              size="small"
              data={[
                { key: '作业类型', value: <Tag color={JOB_TYPE_META[detail.jobType].color} size="small">{JOB_TYPE_META[detail.jobType].text}</Tag> },
                { key: '状态', value: renderStatusTag(detail.status) },
                { key: '流程', value: detail.definitionName ?? '—' },
                { key: '实例', value: detail.instanceId ? `#${detail.instanceId}${detail.instanceTitle ? ` · ${detail.instanceTitle}` : ''}` : '系统事件' },
                { key: '任务 / 节点', value: `${detail.taskId ? `#${detail.taskId}` : '—'}${detail.nodeKey ? ` / ${detail.nodeKey}` : ''}` },
                { key: '尝试次数', value: `${detail.attempts}/${detail.maxAttempts}` },
                { key: '优先级', value: detail.priority },
                { key: '计划执行', value: formatDateTime(detail.runAt) },
                { key: '幂等键', value: detail.idempotencyKey ?? '—' },
                { key: 'TraceId', value: detail.traceId
                  ? <Button theme="borderless" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => detail.traceId && void openChain(detail.traceId)}>{detail.traceId} · 查看链路</Button>
                  : '—' },
                { key: '锁定', value: detail.lockedBy ? `${detail.lockedBy}（${detail.lockedAt ? formatDateTime(detail.lockedAt) : '—'}）` : '—' },
                { key: '创建时间', value: formatDateTime(detail.createdAt) },
                { key: '更新时间', value: formatDateTime(detail.updatedAt) },
              ]}
            />

            {detail.lastError && (
              <div style={{ width: '100%' }}>
                <Typography.Text strong type="danger">最近错误</Typography.Text>
                <div style={{ marginTop: 4, padding: 8, background: 'var(--semi-color-danger-light-default)', borderRadius: 6, wordBreak: 'break-all', fontSize: 12 }}>{detail.lastError}</div>
              </div>
            )}

            <div style={{ width: '100%' }}>
              <Typography.Text strong>Payload</Typography.Text>
              <div style={{ marginTop: 4 }}>
                <JsonViewer
                  value={JSON.stringify(detail.payload ?? {}, null, 2)}
                  height={Math.min(240, Math.max(80, JSON.stringify(detail.payload ?? {}, null, 2).split('\n').length * 18))}
                  width="100%"
                  options={{ readOnly: true, autoWrap: true }}
                />
              </div>
            </div>

            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Typography.Text strong>执行记录（{detail.executions.length}）</Typography.Text>
                {detail.executions.length > 0 && (
                  <RadioGroup type="button" value={execView} onChange={(e) => setExecView(e.target.value as 'timeline' | 'table')}>
                    <Radio value="timeline">时间线</Radio>
                    <Radio value="table">表格</Radio>
                  </RadioGroup>
                )}
              </div>
              {detail.executions.length > 0
                ? (execView === 'timeline'
                    ? renderExecutionTimeline(detail.executions)
                    : <Table bordered size="small" columns={execColumns} dataSource={detail.executions} rowKey="id" pagination={false} />)
                : <Empty description="暂无执行记录" />}
            </div>

            {canOperate && (
              <Space>
                {(detail.status === 'failed' || detail.status === 'dead' || detail.status === 'canceled') && (
                  <Popconfirm title="确定重新入队该作业？" onConfirm={() => void handleRetry(detail.id)}>
                    <Button type="primary" loading={actingId === detail.id}>重试</Button>
                  </Popconfirm>
                )}
                {(detail.status === 'pending' || detail.status === 'failed' || detail.status === 'dead') && (
                  <Popconfirm title="确定跳过该作业？" onConfirm={() => void handleSkip(detail.id)}>
                    <Button type="danger" loading={actingId === detail.id}>跳过</Button>
                  </Popconfirm>
                )}
              </Space>
            )}
          </Space>
        )}
      </SideSheet>

      <SideSheet
        title={chain ? `作业链路（${chain.stats.total}）` : '作业链路'}
        visible={chainVisible}
        onCancel={() => setChainVisible(false)}
        width="min(720px, 96vw)"
      >
        {chainLoading && <Empty description="加载中…" />}
        {!chainLoading && chain && (
          <Space vertical align="start" style={{ width: '100%' }} spacing={12}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 8 }}>
              <Typography.Text size="small" type="tertiary" style={{ wordBreak: 'break-all' }}>traceId：{chain.traceId}</Typography.Text>
              <Button size="small" theme="borderless" icon={<Download size={14} />} loading={bundleLoading} onClick={() => void downloadTraceBundle(chain.traceId)}>
                导出诊断包
              </Button>
            </div>
            <Space wrap spacing={6}>
              <Tag color="grey">共 {chain.stats.total}</Tag>
              {chain.stats.pending > 0 && <Tag color="amber">待处理 {chain.stats.pending}</Tag>}
              {chain.stats.running > 0 && <Tag color="blue">运行中 {chain.stats.running}</Tag>}
              {chain.stats.succeeded > 0 && <Tag color="green">成功 {chain.stats.succeeded}</Tag>}
              {chain.stats.failed > 0 && <Tag color="orange">失败 {chain.stats.failed}</Tag>}
              {chain.stats.dead > 0 && <Tag color="red">死信 {chain.stats.dead}</Tag>}
              {chain.stats.canceled > 0 && <Tag color="grey">已取消 {chain.stats.canceled}</Tag>}
              <Tag color="violet">涉及实例 {chain.stats.instanceIds.length}</Tag>
            </Space>
            <Table
              bordered
              size="small"
              style={{ width: '100%' }}
              dataSource={chain.jobs}
              rowKey="id"
              pagination={false}
              onRow={(record) => ({ onClick: () => { if (record) void openDetail(record.id); }, style: { cursor: 'pointer' } })}
              columns={chainColumns}
            />
          </Space>
        )}
      </SideSheet>
      <Modal title="失败原因聚类" visible={clusters !== null} onCancel={() => setClusters(null)} footer={null} width={680}>
        <div style={{ marginBottom: 12 }}>
          <RadioGroup type="button" value={clusterDim} onChange={(e) => void openClusters(e.target.value as ClusterDimension)}>
            {CLUSTER_DIM_OPTIONS.map((o) => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}
          </RadioGroup>
        </div>
        {clusterLoading ? (
          <Typography.Text type="tertiary">加载中…</Typography.Text>
        ) : clusters?.length ? clusters.map((c, i) => {
          const canReplayCluster = canOperate && (c.dimension !== 'reason' || !!c.reasonKeyword);
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--semi-color-border)' }}>
              <Typography.Text style={{ maxWidth: 380 }} ellipsis={{ showTooltip: true }}>{c.label}</Typography.Text>
              <Space>
                <Typography.Text type="tertiary" size="small">{c.jobTypes.join(',')} · {c.count}</Typography.Text>
                {canReplayCluster && <Button theme="borderless" size="small" onClick={() => replayCluster(c)}>重放该簇</Button>}
              </Space>
            </div>
          );
        }) : <Typography.Text type="tertiary">暂无失败/死信作业</Typography.Text>}
      </Modal>

      <Modal
        title="条件重放（死信 / 失败作业）"
        visible={replayOpen}
        onCancel={() => setReplayOpen(false)}
        okText="确认重放"
        cancelText="取消"
        onOk={() => void doReplay()}
        okButtonProps={{ loading: replayLoading, type: 'warning' }}
        width={640}
      >
        <Form
          key={replayFormKey}
          labelPosition="left"
          labelWidth={100}
          initValues={replayFilter}
          onValueChange={(values, changed) => {
            setReplayFilter((s) => ({
              ...s,
              ...values,
              ratePerSecond: typeof values.ratePerSecond === 'number' ? values.ratePerSecond : s.ratePerSecond,
              limit: typeof values.limit === 'number' ? values.limit : s.limit,
            }));
            const key = Object.keys(changed ?? {})[0];
            if (key && key !== 'ratePerSecond' && key !== 'limit') setReplayPreview(null);
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="status" label="目标状态" style={{ width: '100%' }} optionList={REPLAY_STATUS_OPTIONS} />
            </Col>
            <Col span={12}>
              <Form.Select field="jobType" label="作业类型" placeholder="全部类型" showClear style={{ width: '100%' }} optionList={JOB_TYPE_OPTIONS} />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="instanceId" label="实例 ID" placeholder="不限" min={1} style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Form.Input field="traceId" label="TraceId" placeholder="不限" showClear />
            </Col>
            <Col span={12}>
              <Form.Input field="reasonKeyword" label="错误关键字" placeholder="按 lastError 模糊匹配" showClear />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="olderThanMinutes" label="入库超过" placeholder="不限" min={0} suffix="分钟" style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="ratePerSecond" label="限流速率" min={1} max={200} suffix="条/秒" style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="limit" label="单次上限" min={1} max={500} suffix="条" style={{ width: '100%' }} />
            </Col>
          </Row>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
            <Button size="small" theme="light" loading={previewLoading} onClick={() => void doPreview()}>预览匹配数</Button>
            {replayPreview !== null && (
              <Typography.Text type="tertiary" size="small">
                匹配 <b>{replayPreview}</b> 条，本次将重放 <b>{Math.min(replayPreview, replayFilter.limit)}</b> 条，预计约 {Math.max(1, Math.ceil(Math.min(replayPreview, replayFilter.limit) / Math.max(1, replayFilter.ratePerSecond)))} 秒错峰完成
                {replayPreview > replayFilter.limit && '（超上限部分需再次重放）'}
              </Typography.Text>
            )}
          </div>
        </Form>
      </Modal>
    </>
  );
}

// ───────────────────────── 作业账本（按类型分 Tab） ─────────────────────────

const RT_STAT: CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 84 };

function RuntimeStatusBar() {
  const [status, setStatus] = useState<WorkflowJobRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await request.get<WorkflowJobRuntimeStatus>('/api/workflows/engine/jobs/runtime-status');
      if (r.code === 0) setStatus(r.data);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const stat = (label: string, value: ReactNode, danger?: boolean) => (
    <div style={RT_STAT}>
      <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
      <Typography.Text strong style={danger ? { color: 'var(--semi-color-danger)' } : undefined}>{value}</Typography.Text>
    </div>
  );

  const workerTip = status?.workers.length
    ? status.workers.map((w) => `${w.hostname ?? w.nodeId}｜在途 ${w.runningJobCount}｜心跳 ${w.lastHeartbeatAt ?? '—'}${w.fresh ? '' : '（离线）'}`).join('\n')
    : '暂无注册节点';

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24, padding: '10px 16px', marginBottom: 12, border: '1px solid var(--semi-color-border)', borderRadius: 8, background: 'var(--semi-color-bg-1)' }}>
      <Typography.Text strong style={{ marginRight: 4 }}>运行状态</Typography.Text>
      <Tooltip content={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{workerTip}</pre>}>
        <div>{stat('存活 Worker', `${status?.activeWorkers ?? '-'} / ${status?.totalWorkers ?? '-'}`)}</div>
      </Tooltip>
      {stat('在途作业', status?.runningJobs ?? '-')}
      {stat('卡死', status?.stuckRunningJobs ?? '-', !!status && status.stuckRunningJobs > 0)}
      {stat('积压', status?.backlog ?? '-', !!status && status.backlog > 0)}
      {stat('死信', status?.deadLetter ?? '-', !!status && status.deadLetter > 0)}
      {stat('最后领取', status?.lastClaimedAt ?? '—')}
      {stat('失败率(1h)', status ? `${status.failureRate}%` : '-', !!status && status.failureRate >= 20)}
      {stat('平均耗时(1h)', status?.avgDurationMs != null ? `${status.avgDurationMs}ms` : '—')}
      <Button size="small" theme="borderless" icon={<RotateCcw size={14} />} loading={loading} onClick={() => void load()} style={{ marginLeft: 'auto' }}>刷新</Button>
    </div>
  );
}

export default function WorkflowJobsView() {
  const [activeType, setActiveType] = useState<WorkflowJobType>(JOB_TYPES[0]);
  const [summaryMap, setSummaryMap] = useState<Record<string, WorkflowJobSummaryItem>>({});

  const loadSummary = useCallback(async () => {
    const res = await request.get<WorkflowJobSummaryItem[]>('/api/workflows/engine/jobs/summary');
    if (res.code === 0) {
      const next: Record<string, WorkflowJobSummaryItem> = {};
      for (const item of res.data) next[item.jobType] = item;
      setSummaryMap(next);
    }
  }, []);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  return (
    <>
      <RuntimeStatusBar />
      <Tabs
        type="card"
        collapsible
        activeKey={activeType}
        onChange={(k) => setActiveType(k as WorkflowJobType)}
      >
        {JOB_TYPES.map((t) => {
          const item = summaryMap[t] ?? EMPTY_SUMMARY(t);
          const problem = item.failed + item.dead;
          return (
            <TabPane
              key={t}
              itemKey={t}
              tab={(
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {JOB_TYPE_META[t].text}
                  <Tag
                    size="small"
                    color={problem > 0 ? 'red' : 'grey'}
                    style={{ minWidth: 18, textAlign: 'center', padding: '0 6px', borderRadius: 9 }}
                  >
                    {item.total}
                  </Tag>
                </span>
              )}
            >
              {activeType === t && <JobTypePanel jobType={t} summary={item} onMutated={loadSummary} />}
            </TabPane>
          );
        })}
      </Tabs>
    </>
  );
}
