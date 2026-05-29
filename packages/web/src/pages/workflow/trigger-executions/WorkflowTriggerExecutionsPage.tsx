/**
 * 工作流触发器执行记录
 * 列表 + 详情抽屉，支持按状态 / 实例 ID / 节点 key 过滤
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Input,
  InputNumber,
  Select,
  SideSheet,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import type {
  PaginatedResponse,
  WorkflowTriggerExecution,
  WorkflowTriggerExecutionStatus,
  WorkflowTriggerType,
} from '@zenith/shared/types';

const STATUS_MAP: Record<WorkflowTriggerExecutionStatus, { label: string; color: 'grey' | 'blue' | 'green' | 'red' | 'orange' }> = {
  pending: { label: '待执行', color: 'grey' },
  running: { label: '执行中', color: 'blue' },
  success: { label: '成功', color: 'green' },
  failed: { label: '失败', color: 'red' },
  retrying: { label: '重试中', color: 'orange' },
};

const TRIGGER_TYPE_LABEL: Record<WorkflowTriggerType, string> = {
  webhook: 'Webhook',
  callback: '回调',
  updateData: '更新数据',
  deleteData: '删除数据',
};

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  ...(Object.entries(STATUS_MAP) as [WorkflowTriggerExecutionStatus, { label: string }][]).map(
    ([value, meta]) => ({ value, label: meta.label }),
  ),
];

export default function WorkflowTriggerExecutionsPage() {
  const [list, setList] = useState<WorkflowTriggerExecution[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [statusInput, setStatusInput] = useState<WorkflowTriggerExecutionStatus | ''>('');
  const [status, setStatus] = useState<WorkflowTriggerExecutionStatus | ''>('');
  const [instanceIdInput, setInstanceIdInput] = useState<number | undefined>();
  const [instanceId, setInstanceId] = useState<number | undefined>();
  const [nodeKeyInput, setNodeKeyInput] = useState('');
  const [nodeKey, setNodeKey] = useState('');

  const [detail, setDetail] = useState<WorkflowTriggerExecution | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (status) params.set('status', status);
      if (instanceId) params.set('instanceId', String(instanceId));
      if (nodeKey) params.set('nodeKey', nodeKey);
      const res = await request.get<PaginatedResponse<WorkflowTriggerExecution>>(
        `/api/workflows/trigger-executions?${params.toString()}`,
      );
      if (res.code === 0) {
        setList(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, instanceId, nodeKey]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleSearch = () => {
    setStatus(statusInput);
    setInstanceId(instanceIdInput);
    setNodeKey(nodeKeyInput.trim());
    setPage(1);
  };
  const handleReset = () => {
    setStatusInput(''); setStatus('');
    setInstanceIdInput(undefined); setInstanceId(undefined);
    setNodeKeyInput(''); setNodeKey('');
    setPage(1);
  };

  const openDetail = async (row: WorkflowTriggerExecution) => {
    const res = await request.get<WorkflowTriggerExecution>(
      `/api/workflows/trigger-executions/${row.id}`,
    );
    if (res.code === 0) setDetail(res.data);
  };

  const columns: ColumnProps<WorkflowTriggerExecution>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '实例 ID', dataIndex: 'instanceId', width: 90 },
    {
      title: '节点',
      dataIndex: 'nodeName',
      width: 180,
      render: (_: unknown, r) => (
        <span>
          <Typography.Text>{r.nodeName || r.nodeKey}</Typography.Text>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>{r.nodeKey}</Typography.Text>
        </span>
      ),
    },
    {
      title: '触发类型',
      dataIndex: 'triggerType',
      width: 110,
      render: (v: WorkflowTriggerType) => TRIGGER_TYPE_LABEL[v] ?? v,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: WorkflowTriggerExecutionStatus) => {
        const meta = STATUS_MAP[v];
        return <Tag color={meta?.color ?? 'grey'} size="small">{meta?.label ?? v}</Tag>;
      },
    },
    { title: '尝试次数', dataIndex: 'attempt', width: 90 },
    {
      title: '响应码',
      dataIndex: 'responseStatus',
      width: 90,
      render: (v: number | null) => v ?? '-',
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (v: number | null) => (v == null ? '-' : `${v} ms`),
    },
    {
      title: '错误',
      dataIndex: 'errorMessage',
      ellipsis: { showTitle: true },
      render: (v: string | null) =>
        v ? <Typography.Text type="danger" ellipsis={{ rows: 1, showTooltip: true }}>{v}</Typography.Text> : '-',
    },
    createdAtColumn,
    {
      title: '操作',
      dataIndex: '__ops',
      width: 90,
      fixed: 'right',
      render: (_: unknown, r) => (
        <Button theme="borderless" size="small" onClick={() => openDetail(r)}>详情</Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Select
          value={statusInput}
          onChange={(v) => setStatusInput(v as WorkflowTriggerExecutionStatus | '')}
          style={{ width: 140 }}
          optionList={STATUS_OPTIONS}
        />
        <InputNumber
          value={instanceIdInput}
          onChange={(v) => setInstanceIdInput(typeof v === 'number' ? v : undefined)}
          placeholder="实例 ID"
          min={1}
          style={{ width: 140 }}
        />
        <Input
          prefix={<Search size={14} />}
          value={nodeKeyInput}
          onChange={setNodeKeyInput}
          placeholder="节点 key"
          showClear
          style={{ width: 180 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered
        rowKey="id"
        loading={loading}
        dataSource={list}
        columns={columns}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: (s: number) => { setPageSize(s); setPage(1); },
          showSizeChanger: true,
          showTotal: true,
        }}
      />

      <SideSheet
        title={`执行记录详情 #${detail?.id ?? ''}`}
        visible={!!detail}
        onCancel={() => setDetail(null)}
        width={720}
      >
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Row label="实例 ID">{detail.instanceId}</Row>
            <Row label="任务 ID">{detail.taskId ?? '-'}</Row>
            <Row label="节点">{detail.nodeName}（{detail.nodeKey}）</Row>
            <Row label="触发类型">{TRIGGER_TYPE_LABEL[detail.triggerType] ?? detail.triggerType}</Row>
            <Row label="状态">
              <Tag color={STATUS_MAP[detail.status]?.color ?? 'grey'} size="small">
                {STATUS_MAP[detail.status]?.label ?? detail.status}
              </Tag>
            </Row>
            <Row label="尝试次数">{detail.attempt}</Row>
            <Row label="请求 URL">{detail.requestUrl ?? '-'}</Row>
            <Row label="请求方法">{detail.requestMethod ?? '-'}</Row>
            <Row label="响应码">{detail.responseStatus ?? '-'}</Row>
            <Row label="耗时">{detail.durationMs == null ? '-' : `${detail.durationMs} ms`}</Row>
            <Row label="创建时间">{formatDateTime(detail.createdAt)}</Row>
            <CodeBlock label="请求体" content={detail.requestBody} />
            <CodeBlock label="响应体" content={detail.responseBody} />
            {detail.errorMessage && (
              <div>
                <Typography.Text type="tertiary" size="small">错误信息</Typography.Text>
                <pre style={{ background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 4, marginTop: 4, color: 'var(--semi-color-danger)' }}>
                  {detail.errorMessage}
                </pre>
              </div>
            )}
          </div>
        )}
      </SideSheet>
    </div>
  );
}

function Row({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <Typography.Text type="tertiary" size="small" style={{ width: 80, flexShrink: 0 }}>{label}</Typography.Text>
      <Typography.Text>{children}</Typography.Text>
    </div>
  );
}

function CodeBlock({ label, content }: Readonly<{ label: string; content: string | null }>) {
  if (!content) return null;
  let pretty = content;
  try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch { /* keep raw */ }
  return (
    <div>
      <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
      <pre style={{ background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 4, marginTop: 4, maxHeight: 320, overflow: 'auto' }}>
        {pretty}
      </pre>
    </div>
  );
}
