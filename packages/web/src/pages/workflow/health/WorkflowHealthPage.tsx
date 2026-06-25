import { useCallback, useEffect, useState } from 'react';
import { Button, InputNumber, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import type { WorkflowHealthIssue, WorkflowHealthSummary } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';

const ISSUE_LABELS: Record<WorkflowHealthIssue['type'], string> = {
  external_dispatch_failed: '外部审批失败',
  external_dispatch_pending: '外部审批未派发',
  trigger_waiting_no_execution: '触发器无执行记录',
  subprocess_waiting: '子流程等待',
  delay_overdue: '延迟未唤醒',
  task_timeout_overdue: '任务超时',
  workflow_event_outbox_failed: 'Outbox 失败',
  workflow_event_outbox_pending: 'Outbox 待处理',
  waiting_task_stuck: '任务等待过久',
};

function SummaryItem({ label, value, danger }: Readonly<{ label: string; value: number; danger?: boolean }>) {
  return (
    <div style={{ minWidth: 120, padding: '10px 12px', border: '1px solid var(--semi-color-border)', borderRadius: 8 }}>
      <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
      <div style={{ fontSize: 22, fontWeight: 600, color: danger ? 'var(--semi-color-danger)' : 'var(--semi-color-text-0)' }}>{value}</div>
    </div>
  );
}

export default function WorkflowHealthPage() {
  const [thresholdMinutes, setThresholdMinutes] = useState(30);
  const [data, setData] = useState<WorkflowHealthSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (threshold = thresholdMinutes) => {
    setLoading(true);
    try {
      const res = await request.get<WorkflowHealthSummary>(`/api/workflows/health?thresholdMinutes=${threshold}`);
      if (res.code === 0) setData(res.data);
      else Toast.error(res.message || '巡检失败');
    } finally {
      setLoading(false);
    }
  }, [thresholdMinutes]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleSearch = () => {
    void fetchData(thresholdMinutes);
  };

  const handleReset = () => {
    setThresholdMinutes(30);
    void fetchData(30);
  };

  const columns: ColumnProps<WorkflowHealthIssue>[] = [
    {
      title: '级别',
      dataIndex: 'severity',
      width: 90,
      fixed: 'right',
      render: (v: WorkflowHealthIssue['severity']) => (
        <Tag color={v === 'critical' ? 'red' : 'orange'} size="small">{v === 'critical' ? '严重' : '警告'}</Tag>
      ),
    },
    {
      title: '问题类型',
      dataIndex: 'type',
      width: 150,
      render: (v: WorkflowHealthIssue['type']) => ISSUE_LABELS[v] ?? v,
    },
    {
      title: '说明',
      dataIndex: 'title',
      ellipsis: { showTitle: true },
      render: (_: unknown, row) => (
        <div>
          <Typography.Text strong>{row.title}</Typography.Text>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>{row.description}</Typography.Text>
        </div>
      ),
    },
    { title: '实例', dataIndex: 'instanceId', width: 180, render: (_: unknown, row) => row.instanceId ? `#${row.instanceId} ${row.instanceTitle ?? ''}` : '—' },
    { title: '任务', dataIndex: 'taskId', width: 90, render: (v: number | null) => v ? `#${v}` : '—' },
    { title: '节点', dataIndex: 'nodeName', width: 160, render: (_: unknown, row) => row.nodeName ?? row.nodeKey ?? '—' },
    { title: '状态', dataIndex: 'status', width: 110, render: (v: string | null) => v ?? '—' },
    { title: '等待时长', dataIndex: 'ageMinutes', width: 110, render: (v: number) => `${v} 分钟` },
    { title: '创建时间', dataIndex: 'createdAt', width: 170 },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <InputNumber
          value={thresholdMinutes}
          onChange={(v) => setThresholdMinutes(typeof v === 'number' ? v : 30)}
          min={1}
          max={1440}
          step={5}
          placeholder="阈值（分钟）"
          style={{ width: 140 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
      </SearchToolbar>

      <Space wrap style={{ marginBottom: 12 }}>
        <SummaryItem label="问题总数" value={data?.stats.total ?? 0} danger={(data?.stats.total ?? 0) > 0} />
        <SummaryItem label="严重" value={data?.stats.critical ?? 0} danger={(data?.stats.critical ?? 0) > 0} />
        <SummaryItem label="警告" value={data?.stats.warning ?? 0} />
        <SummaryItem label="外部审批失败" value={data?.stats.externalFailed ?? 0} danger={(data?.stats.externalFailed ?? 0) > 0} />
        <SummaryItem label="触发器卡住" value={data?.stats.triggerStuck ?? 0} danger={(data?.stats.triggerStuck ?? 0) > 0} />
        <SummaryItem label="Outbox 失败" value={data?.stats.outboxFailed ?? 0} danger={(data?.stats.outboxFailed ?? 0) > 0} />
      </Space>

      <ConfigurableTable
        bordered
        rowKey="id"
        loading={loading}
        dataSource={data?.issues ?? []}
        columns={columns}
        pagination={false}
        onRefresh={fetchData}
        refreshLoading={loading}
      />
    </div>
  );
}
