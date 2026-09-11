import { useMemo, useState } from 'react';
import { Button, Card, Empty, Spin, Typography } from '@douyinfe/semi-ui';
import { RotateCcw } from 'lucide-react';
import WorkflowInstanceCell from '@/components/workflow/WorkflowInstanceCell';
import {
  BarChart,
  LineChart,
  PieChart,
  chartOptions,
  makeBarSpec,
  makeLineSpec,
  makePieSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import type { WorkflowDefinition } from '@zenith/shared/workflow';
import { useWorkflowAnalytics, useWorkflowOverdueTasks } from '@/hooks/queries/workflow-monitor';
import { WORKFLOW_INSTANCE_STATUS_LABELS } from '@zenith/shared/workflow';
import { FilterSelect } from '@/components/search-filters';
import { shortDate } from '@/utils/date';

// 文案统一来自 @zenith/shared；hex 色值为图表 canvas 专用（Semi Tag 色名不适用）
const STATUS_META: Record<string, { text: string; color: string }> = {
  draft: { text: WORKFLOW_INSTANCE_STATUS_LABELS.draft, color: '#8c8c8c' },
  running: { text: WORKFLOW_INSTANCE_STATUS_LABELS.running, color: '#3370ff' },
  suspended: { text: WORKFLOW_INSTANCE_STATUS_LABELS.suspended, color: '#d97706' },
  approved: { text: WORKFLOW_INSTANCE_STATUS_LABELS.approved, color: '#0dc87c' },
  rejected: { text: WORKFLOW_INSTANCE_STATUS_LABELS.rejected, color: '#ff4d4f' },
  withdrawn: { text: WORKFLOW_INSTANCE_STATUS_LABELS.withdrawn, color: '#faad14' },
  cancelled: { text: WORKFLOW_INSTANCE_STATUS_LABELS.cancelled, color: '#8b5cf6' },
};

function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}秒`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60); const mm = m % 60;
  if (h < 24) return `${h}小时${mm}分`;
  const d = Math.floor(h / 24); const hh = h % 24;
  return `${d}天${hh}小时`;
}

function fmtPercent(rate: number | null): string {
  if (rate == null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function Kpi({ label, value, danger, warn }: Readonly<{ label: string; value: string | number; danger?: boolean; warn?: boolean }>) {
  const color = danger ? 'var(--semi-color-danger)' : warn ? 'var(--semi-color-warning)' : undefined;
  return <StatCard title={label} value={value} accent={color} />;
}

function ChartCard({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <Card bodyStyle={{ padding: '12px 16px' }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>{title}</Typography.Text>
      {children}
    </Card>
  );
}

export default function WorkflowAnalyticsView({ definitions }: Readonly<{ definitions: WorkflowDefinition[] }>) {
  const palette = useChartPalette();
  const [definitionId, setDefinitionId] = useState<number | undefined>();
  const analyticsQuery = useWorkflowAnalytics(definitionId);
  const overdueQuery = useWorkflowOverdueTasks(definitionId);
  const data = analyticsQuery.data ?? null;
  const overdue = overdueQuery.data?.list ?? [];

  const statusPie = useMemo(
    () => (data?.statusCounts ?? [])
      .filter((s) => s.count > 0)
      .map((s) => ({ name: STATUS_META[s.status]?.text ?? s.status, value: s.count, color: STATUS_META[s.status]?.color ?? '#999' })),
    [data],
  );

  const defBar = useMemo(
    () => (data?.definitionStats ?? []).map((d) => ({ name: d.definitionName, 进行中: d.running, 已通过: d.approved, 已驳回: d.rejected })),
    [data],
  );
  const approverWorkloadData = useMemo(
    () => (data?.approverWorkloads ?? []).map((a) => ({ name: a.userName, 待办: a.pendingCount, 已处理: a.handledCount })),
    [data],
  );
  const trendSpec = useMemo(() => makeLineSpec({
    data: data?.trend ?? [],
    xField: 'date',
    series: [
      { field: 'created', name: '发起', color: '#3370ff' },
      { field: 'completed', name: '完结', color: '#0dc87c' },
      { field: 'pending', name: '积压', color: '#fa8c16' },
    ],
    palette,
    axis: { xLabel: shortDate },
  }), [data, palette]);
  const statusPieSpec = useMemo(() => makePieSpec({
    data: statusPie,
    categoryField: 'name',
    valueField: 'value',
    donut: false,
    colors: statusPie.map((s) => s.color),
    palette,
    label: 'value',
  }), [palette, statusPie]);
  const defBarSpec = useMemo(() => makeBarSpec({
    data: defBar,
    xField: 'name',
    series: [
      { field: '进行中', name: '进行中', color: '#3370ff' },
      { field: '已通过', name: '已通过', color: '#0dc87c' },
      { field: '已驳回', name: '已驳回', color: '#ff4d4f' },
    ],
    palette,
    horizontal: true,
    stack: true,
    categoryAxisWidth: 120,
  }), [defBar, palette]);
  const approverWorkloadSpec = useMemo(() => makeBarSpec({
    data: approverWorkloadData,
    xField: 'name',
    series: [
      { field: '待办', name: '待办', color: '#3370ff' },
      { field: '已处理', name: '已处理', color: '#0dc87c' },
    ],
    palette,
    horizontal: true,
    categoryAxisWidth: 100,
  }), [approverWorkloadData, palette]);

  if (analyticsQuery.isFetching && !data) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;
  }
  if (!data) return <Empty title="暂无分析数据" style={{ padding: 60 }} />;

  return (
    <div className="zx-flat-panels" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <FilterSelect
          placeholder="全部流程"
          items={definitions.map((d) => ({ label: d.name, value: d.id }))}
          value={definitionId}
          onChange={(v) => setDefinitionId(v as number | undefined)}
          width={220}
        />
        <Button
          icon={<RotateCcw size={14} />}
          loading={analyticsQuery.isFetching || overdueQuery.isFetching}
          onClick={() => { void analyticsQuery.refetch(); void overdueQuery.refetch(); }}
        >
          刷新
        </Button>
      </div>

      {/* KPI */}
      <StatGrid minItemWidth={150}>
        <Kpi label="流程实例总数" value={data.total} />
        <Kpi label="平均审批耗时" value={fmtDuration(data.avgDurationSec)} />
        <Kpi label="当前待办总数" value={data.pendingTaskCount} />
        <Kpi label="已超时待办" value={data.overdueTaskCount} danger={data.overdueTaskCount > 0} />
        <Kpi label="24h内即将超时" value={data.dueSoonTaskCount} warn={data.dueSoonTaskCount > 0} />
        <Kpi label="近 7 天发起" value={data.recentCreated} />
        <Kpi label="驳回率" value={fmtPercent(data.rejectionRate)} warn={(data.rejectionRate ?? 0) >= 0.3} />
        <Kpi label="待办超时率" value={fmtPercent(data.timeoutRate)} danger={(data.timeoutRate ?? 0) >= 0.2} />
        <Kpi label="作业失败率" value={fmtPercent(data.automation?.jobFailRate)} danger={(data.automation?.jobFailRate ?? 0) >= 0.1} />
        <Kpi label="Webhook成功率" value={fmtPercent(data.automation?.webhookSuccessRate)} warn={(data.automation?.webhookSuccessRate ?? 1) < 0.9} />
        <Kpi label="子流程失败率" value={fmtPercent(data.automation?.subprocessFailRate)} warn={(data.automation?.subprocessFailRate ?? 0) >= 0.2} />
      </StatGrid>
      <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: -6 }}>
        比率类指标为全历史累计口径 · 作业失败率含触发器/延迟/Webhook 等全部引擎作业（死信 {data.automation?.jobsDead ?? 0} · 失败 {data.automation?.jobsFailed ?? 0} / 总 {data.automation?.jobsTotal ?? 0}）
      </div>

      {/* 超时待办预警 */}
      <ChartCard title={`超时待办预警${overdue.length > 0 ? `（${overdue.length}）` : ''}`}>
        {overdue.length === 0 ? <Empty title="暂无超时待办" style={{ padding: 32 }} /> : (
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--semi-color-text-2)' }}>
                  <th style={{ padding: '6px 8px' }}></th>
                  <th style={{ padding: '6px 8px' }}>申请</th>
                  <th style={{ padding: '6px 8px' }}>节点</th>
                  <th style={{ padding: '6px 8px' }}>处理人</th>
                  <th style={{ padding: '6px 8px' }}>应处理时限</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>已超时</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((o) => {
                  const days = o.overdueSec / 86400;
                  const lamp = days >= 1 ? 'var(--semi-color-danger)' : 'var(--semi-color-warning)';
                  return (
                    <tr key={o.taskId} style={{ borderTop: '1px solid var(--semi-color-border)' }}>
                      <td style={{ padding: '6px 8px' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: lamp }} /></td>
                      <td style={{ padding: '6px 8px' }}>
                        <WorkflowInstanceCell
                          size="small"
                          instanceId={o.instanceId}
                          title={o.instanceTitle}
                          serialNo={o.serialNo}
                          definitionName={o.definitionName}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>{o.nodeName}</td>
                      <td style={{ padding: '6px 8px' }}>{o.assigneeName ?? '—'}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--semi-color-text-2)' }}>{o.timeoutAt}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: lamp, fontWeight: 600 }}>{fmtDuration(o.overdueSec)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {/* 趋势 + 状态分布 */}
      <div className="chart-grid">
        <ChartCard title="近 14 天发起 / 完结 / 积压趋势">
          <LineChart {...trendSpec} options={chartOptions} height={260} />
        </ChartCard>
        <ChartCard title="状态分布">
          {statusPie.length === 0 ? <Empty title="暂无数据" style={{ padding: 40 }} /> : (
            <PieChart {...statusPieSpec} options={chartOptions} height={260} />
          )}
        </ChartCard>
      </div>

      {/* 各流程量 + 节点瓶颈 */}
      <div className="chart-grid">
        <ChartCard title="各流程实例量（Top 12）">
          {defBar.length === 0 ? <Empty title="暂无数据" style={{ padding: 40 }} /> : (
            <BarChart {...defBarSpec} options={chartOptions} height={Math.max(220, defBar.length * 34)} />
          )}
        </ChartCard>
        <ChartCard title="节点瓶颈（平均处理时长 / 待办数）">
          {data.nodeBottlenecks.length === 0 ? <Empty title="暂无数据" style={{ padding: 40 }} /> : (
            <div style={{ maxHeight: 280, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--semi-color-text-2)' }}>
                    <th style={{ padding: '6px 8px' }}>节点</th>
                    <th style={{ padding: '6px 8px' }}>流程</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>平均时长</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>待办</th>
                  </tr>
                </thead>
                <tbody>
                  {data.nodeBottlenecks.map((n) => (
                    <tr key={`${n.definitionId}-${n.nodeKey}`} style={{ borderTop: '1px solid var(--semi-color-border)' }}>
                      <td style={{ padding: '6px 8px' }}>{n.nodeName}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--semi-color-text-2)' }}>{n.definitionName}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtDuration(n.avgHandleSec)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: n.pendingCount > 0 ? 'var(--semi-color-warning)' : undefined }}>{n.pendingCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>

      {/* 审批人工作量 */}
      <ChartCard title="审批人工作量（待办 / 已处理，Top 10）">
        {data.approverWorkloads.length === 0 ? <Empty title="暂无待办" style={{ padding: 40 }} /> : (
          <BarChart {...approverWorkloadSpec} options={chartOptions} height={Math.max(200, data.approverWorkloads.length * 32)} />
        )}
      </ChartCard>
    </div>
  );
}
