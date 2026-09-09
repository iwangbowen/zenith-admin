/**
 * 工作流触发器执行记录
 * 列表 + 详情抽屉，支持按状态 / 实例 ID / 节点 key 过滤
 */
import { useState } from 'react';
import { InputNumber, SideSheet, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTime } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowInstanceCell from '@/components/workflow/WorkflowInstanceCell';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import type {
  WorkflowTriggerExecution,
  WorkflowTriggerExecutionStatus,
  WorkflowTriggerType,
} from '@zenith/shared/workflow';
import {
  useWorkflowTriggerExecutionDetail,
  useWorkflowTriggerExecutionList,
  workflowTriggerExecutionKeys,
} from '@/hooks/queries/workflow-trigger-executions';

import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { useListSearch } from '@/hooks/useListSearch';
import { JsonBlock } from '@/components/JsonBlock';

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
  ...(Object.entries(STATUS_MAP) as [WorkflowTriggerExecutionStatus, { label: string }][]).map(
    ([value, meta]) => ({ value, label: meta.label }),
  ),
];

export default function WorkflowTriggerExecutionsPage() {

  interface SearchParams { status?: WorkflowTriggerExecutionStatus; instanceId: number | undefined; nodeKey: string }
  const defaultSearchParams: SearchParams = { status: undefined, instanceId: undefined, nodeKey: '' };
  const {
    page, pageSize, buildPagination,
    draftParams, setField, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: workflowTriggerExecutionKeys.lists });

  const listQuery = useWorkflowTriggerExecutionList({
    page,
    pageSize,
    status: submittedParams.status || undefined,
    instanceId: submittedParams.instanceId,
    nodeKey: submittedParams.nodeKey || undefined,
  });
  const [detailId, setDetailId] = useState<number | null>(null);
  const detailQuery = useWorkflowTriggerExecutionDetail(detailId, detailId !== null);
  const detail = detailQuery.data ?? null;
  const [detailInstanceId, setDetailInstanceId] = useState<number | null>(null);

  const openDetail = (row: WorkflowTriggerExecution) => {
    setDetailId(row.id);
  };

  const columns: ColumnProps<WorkflowTriggerExecution>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '实例', dataIndex: 'instanceId', width: 200, render: (v: number, r) => <WorkflowInstanceCell size="small" instanceId={v} title={r.instanceTitle} showSub={false} onOpen={(id) => setDetailInstanceId(id)} /> },
    {
      title: '节点',
      dataIndex: 'nodeName',
      // 副行 nodeKey 为生成串（如 trigger_1787286640649_116），240 可完整展示典型长度
      width: 240,
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
    { title: '尝试次数', dataIndex: 'attempt', width: 90, align: 'right' },
    {
      title: '响应码',
      dataIndex: 'responseStatus',
      width: 90,
      render: (v: number | null) => v ?? '-',
    },
    {
      title: '耗时',
      align: 'right',
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
    // 固定列必须连续贴在两端：状态若夹在中间，会被抽到右侧固定层，原位留下空洞，表头表体错位
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
    createOperationColumn<WorkflowTriggerExecution>({
      width: 100,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => openDetail(record) },
      ],
    }),
  ];

  const renderNodeKeySearch = () => (
    <KeywordInput placeholder="节点 key" value={draftParams.nodeKey} onChange={setField('nodeKey')} width={180} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={STATUS_OPTIONS}
      value={draftParams.status}
      onChange={setField('status')}
    />
  );

  const renderInstanceIdFilter = () => (
    <InputNumber
      value={draftParams.instanceId}
      onChange={(v) => setField('instanceId')(typeof v === 'number' ? v : undefined)}
      placeholder="实例 ID"
      min={1}
      style={{ width: 140 }}
    />
  );


  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={renderNodeKeySearch()}
        filters={(
          <>
            {renderStatusFilter()}
            {renderInstanceIdFilter()}
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="执行记录筛选"
      />

      <ConfigurableTable<WorkflowTriggerExecution>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <SideSheet
        title={`执行记录详情 #${detail?.id ?? ''}`}
        visible={detailId !== null}
        onCancel={() => setDetailId(null)}
        width={720}
      >
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Row label="实例">{detail.instanceTitle ? `#${detail.instanceId} · ${detail.instanceTitle}` : `#${detail.instanceId}`}</Row>
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
                <pre style={{ background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 'var(--semi-border-radius-small)', marginTop: 4, color: 'var(--semi-color-danger)' }}>
                  {detail.errorMessage}
                </pre>
              </div>
            )}
          </div>
        )}
      </SideSheet>

      <WorkflowInstanceDetailSheet
        instanceId={detailInstanceId}
        visible={detailInstanceId != null}
        onClose={() => setDetailInstanceId(null)}
      />
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
      <JsonBlock value={pretty} maxHeight={320} style={{ marginTop: 4 }} />
    </div>
  );
}
