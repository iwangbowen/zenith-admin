import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Descriptions,
  Empty,
  Input,
  JsonViewer,
  Popconfirm,
  Radio,
  RadioGroup,
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
import { RotateCcw, Search } from 'lucide-react';
import type { PaginatedResponse, WorkflowJob, WorkflowJobBatchResult, WorkflowJobExecution, WorkflowJobStatus, WorkflowJobSummaryItem, WorkflowJobType } from '@zenith/shared';
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
  const [batchLoading, setBatchLoading] = useState(false);

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

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Tag size="large" color={JOB_TYPE_META[jobType].color}>{JOB_TYPE_META[jobType].text}</Tag>
        <Tag size="large" color="grey">总数 {summary.total}</Tag>
        <Tag size="large" color="grey">待处理 {summary.pending}</Tag>
        <Tag size="large" color="blue">运行中 {summary.running}</Tag>
        <Tag size="large" color="orange">失败 {summary.failed}</Tag>
        <Tag size="large" color="red">死信 {summary.dead}</Tag>
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
                { key: 'TraceId', value: detail.traceId ?? '—' },
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
    </>
  );
}

// ───────────────────────── 作业账本（按类型分 Tab） ─────────────────────────

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
  );
}
