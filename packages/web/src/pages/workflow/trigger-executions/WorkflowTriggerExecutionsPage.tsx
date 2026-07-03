/**
 * 工作流触发器执行记录
 * 列表 + 详情抽屉，支持按状态 / 实例 ID / 节点 key 过滤
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { formatDateTime } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import type {
  WorkflowTriggerExecution,
  WorkflowTriggerExecutionStatus,
  WorkflowTriggerType,
} from '@zenith/shared/types';
import {
  useWorkflowTriggerExecutionDetail,
  useWorkflowTriggerExecutionList,
  workflowTriggerExecutionKeys,
} from '@/hooks/queries/workflow-trigger-executions';

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
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();

  interface SearchParams { status: WorkflowTriggerExecutionStatus | ''; instanceId: number | undefined; nodeKey: string }
  const defaultSearchParams: SearchParams = { status: '', instanceId: undefined, nodeKey: '' };
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const listQuery = useWorkflowTriggerExecutionList({
    page,
    pageSize,
    status: submittedParams.status || undefined,
    instanceId: submittedParams.instanceId,
    nodeKey: submittedParams.nodeKey || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailQuery = useWorkflowTriggerExecutionDetail(detailId, detailId !== null);
  const detail = detailQuery.data ?? null;

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: workflowTriggerExecutionKeys.lists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowTriggerExecutionKeys.lists });
  };

  const openDetail = (row: WorkflowTriggerExecution) => {
    setDetailId(row.id);
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
      fixed: 'right',
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
    createOperationColumn<WorkflowTriggerExecution>({
      width: 90,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => openDetail(record) },
      ],
    }),
  ];

  const renderNodeKeySearch = () => (
    <Input
      prefix={<Search size={14} />}
      value={draftParams.nodeKey}
      onChange={(v) => setDraftParams(prev => ({ ...prev, nodeKey: v }))}
      placeholder="节点 key"
      showClear
      style={{ width: 180 }}
    />
  );

  const renderStatusFilter = () => (
    <Select
      value={draftParams.status}
      onChange={(v) => setDraftParams(prev => ({ ...prev, status: v as WorkflowTriggerExecutionStatus | '' }))}
      style={{ width: 140 }}
      optionList={STATUS_OPTIONS}
    />
  );

  const renderInstanceIdFilter = () => (
    <InputNumber
      value={draftParams.instanceId}
      onChange={(v) => setDraftParams(prev => ({ ...prev, instanceId: typeof v === 'number' ? v : undefined }))}
      placeholder="实例 ID"
      min={1}
      style={{ width: 140 }}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderNodeKeySearch()}
            {renderStatusFilter()}
            {renderInstanceIdFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderNodeKeySearch()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderStatusFilter()}
            {renderInstanceIdFilter()}
          </>
        )}
        filterTitle="执行记录筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        rowKey="id"
        loading={listQuery.isFetching}
        dataSource={list}
        columns={columns}
        pagination={buildPagination(total)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
      />

      <SideSheet
        title={`执行记录详情 #${detail?.id ?? ''}`}
        visible={detailId !== null}
        onCancel={() => setDetailId(null)}
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
