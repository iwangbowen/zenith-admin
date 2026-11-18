import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Empty, Select, SideSheet, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { WORKFLOW_INSTANCE_STATUS_LABELS } from '@zenith/shared/workflow';
import { formatDateTime } from '@/utils/date';
import { formatSecondsHuman } from '@/utils/format';
import { useApprovalMe } from '../lib/queries';
import { canViewApprovalStatistics, useApprovalStatistics, useApprovalStatisticsDefinitions, useApprovalStatisticsDetail, type StatisticsDetail } from '../lib/statistics';

const Charts = lazy(() => import('../components/ApprovalStatisticsCharts'));

export default function StatisticsPage() {
  const navigate = useNavigate();
  const me = useApprovalMe();
  const allowed = canViewApprovalStatistics(me.data?.permissions);
  const [definitionId, setDefinitionId] = useState<number>();
  const [detail, setDetail] = useState<StatisticsDetail | null>(null);
  const [page, setPage] = useState(1);
  const stats = useApprovalStatistics(definitionId, allowed);
  const definitions = useApprovalStatisticsDefinitions(allowed);
  const details = useApprovalStatisticsDetail(detail, definitionId, page, allowed);
  const data = stats.data;
  const open = (kind: StatisticsDetail) => { setPage(1); setDetail(kind); };
  const running = data?.statusCounts.find(row => row.status === 'running')?.count ?? 0;
  return <div className="ap-page">
    <div className="ap-header"><Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate('/')} aria-label="返回工作台" /><span className="ap-header__title">审批统计</span>{allowed && <Button theme="borderless" icon={<RefreshCw size={18} />} loading={stats.isFetching} onClick={() => { void stats.refetch(); }} aria-label="刷新统计" />}</div>
    <div className="ap-body">
      {me.isLoading ? <Spin /> : !allowed ? <Empty title="没有统计查看权限" description="请联系管理员开通流程监控权限。" /> : <>
        <div className="ap-section"><Select style={{ width: '100%' }} placeholder="全部流程" showClear filter loading={definitions.isLoading} value={definitionId} optionList={(definitions.data ?? []).map(item => ({ value: item.id, label: item.name }))} onChange={value => { setDefinitionId(typeof value === 'number' ? value : undefined); setDetail(null); }} />{definitions.isError && <Button onClick={() => { void definitions.refetch(); }}>流程选项加载失败，重试</Button>}<Typography.Text size="small" type="tertiary">按当前账号及租户视角统计 · {stats.dataUpdatedAt ? `更新于 ${formatDateTime(new Date(stats.dataUpdatedAt))}` : '加载中'}</Typography.Text></div>
        {stats.isError && <Banner type="warning" closeIcon={null} description={<>{stats.error.message}<Button onClick={() => { void stats.refetch(); }}>重试</Button></>} />}
        {stats.isLoading && <Spin />}
        {data && <>
          <div className="ap-stat-grid">{[
            { label: '实例总数（含草稿）', value: data.total, kind: 'all' as const },
            { label: '运行中实例', value: running, kind: 'running' as const },
            { label: '待办任务', value: data.pendingTaskCount, kind: 'pending' as const },
            { label: '已超时任务', value: data.overdueTaskCount, kind: 'overdue' as const },
          ].map(item => <button className="ap-stat-metric" key={item.kind} onClick={() => open(item.kind)}><span>{item.label}</span><strong>{item.value}</strong><small>查看明细 ›</small></button>)}</div>
          <div className="ap-section"><Typography.Text>24 小时内即将超时：{data.dueSoonTaskCount} 个任务</Typography.Text><br /><Typography.Text>近 168 小时创建：{data.recentCreated} 个实例</Typography.Text><br /><Typography.Text>已完结平均耗时：{formatSecondsHuman(data.avgDurationSec)}</Typography.Text></div>
          <div className="ap-section"><div className="ap-section__title">近 14 天趋势</div><Suspense fallback={<Spin />}><Charts trend={data.trend} /></Suspense><Typography.Text size="small" type="tertiary">创建包含草稿；完结包含通过、驳回、撤回和取消，按当前终态的更新时间归属。</Typography.Text></div>
          <div className="ap-section"><div className="ap-section__title">实例状态分布</div><div className="ap-stat-status">{data.statusCounts.map(row => <Button key={row.status} theme="light" onClick={() => open(row.status)}>{WORKFLOW_INSTANCE_STATUS_LABELS[row.status]} <Tag>{row.count}</Tag></Button>)}</div>{!data.total && <Empty description="当前范围暂无流程实例" />}</div>
          <div className="ap-section"><div className="ap-section__title">流程分布（前 12 项）</div>{data.definitionStats.map(row => <button className="ap-stat-row" key={row.definitionId} onClick={() => { setDefinitionId(row.definitionId); setDetail(null); }}><span>{row.definitionName}</span><strong>{row.total} 个 · 运行中 {row.running}</strong></button>)}</div>
          <div className="ap-section"><div className="ap-section__title">节点积压（前 10 项）</div>{data.nodeBottlenecks.map(row => <div className="ap-stat-row" key={`${row.definitionId}-${row.nodeKey}`}><span>{row.definitionName} / {row.nodeName}</span><span>待办 {row.pendingCount} · 平均 {formatSecondsHuman(row.avgHandleSec)}</span></div>)}</div>
          <Typography.Text size="small" type="tertiary">实例和任务分别计数，同一实例可有多个待办。超时沿用流程监控中已到期、尚待执行的超时作业口径；汇总与明细在不同刷新时刻可能变化。</Typography.Text>
        </>}
      </>}
    </div>
    <SideSheet title="统计明细" placement="bottom" height="85dvh" className="ap-sheet" visible={detail != null && allowed} onCancel={() => setDetail(null)}>
      <div className="ap-sheet__body">{details.isFetching && <Spin />}{details.isError && <Banner type="warning" description={<>{details.error?.message}<Button onClick={() => { void details.refetch(); }}>重试</Button></>} />}
        {details.rows.map(row => <button className="ap-stat-row" key={row.key} onClick={() => navigate(`/detail/${row.id}`)}><span>{row.title}</span><small>{row.subtitle}</small></button>)}
        {!details.isFetching && !details.isError && details.rows.length === 0 && <Empty description="当前条件暂无记录" />}
        <div className="ap-sheet__actions"><Button disabled={page === 1 || details.isFetching} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page} 页 · 共 {details.data?.total ?? 0} 条</span><Button disabled={page * 20 >= (details.data?.total ?? 0) || details.isFetching} onClick={() => setPage(value => value + 1)}>下一页</Button></div>
      </div>
    </SideSheet>
  </div>;
}
