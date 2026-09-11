import type React from 'react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Typography, Skeleton, Empty } from '@douyinfe/semi-ui';
import {
  AreaChart,
  BarChart,
  LineChart,
  PieChart,
  chartOptions,
  makeAreaSpec,
  makeBarSpec,
  makeLineSpec,
  makePieSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import { Users, UserPlus, CalendarPlus, Activity, Coins, Wallet, CalendarCheck, Ticket } from 'lucide-react';
import type { MemberStatsOverview } from '@zenith/shared/member';
import { useMemberStatsCharts, useMemberStatsOverview } from '@/hooks/queries/member-admin';
import { shortDate } from '@/utils/date';

const { Text } = Typography;

const PIE_COLORS = ['#07c160', '#4A90E2', '#FA8C16', '#722ED1', '#F5222D', '#13C2C2', '#EB2F96', '#1677FF'];

interface StatItem {
  key: keyof MemberStatsOverview;
  label: string;
  icon: React.ReactNode;
  color: string;
  format?: (v: number) => string;
  /** 点击下钻的目标管理页 */
  to?: string;
}

const STAT_ITEMS: StatItem[] = [
  { key: 'totalMembers', label: '总会员数', icon: <Users size={20} />, color: '#07c160', to: '/member/members' },
  { key: 'todayNewMembers', label: '今日新增', icon: <UserPlus size={20} />, color: '#4A90E2', to: '/member/members' },
  { key: 'monthNewMembers', label: '本月新增', icon: <CalendarPlus size={20} />, color: '#722ED1', to: '/member/members' },
  { key: 'activeMembers30d', label: '近30天活跃', icon: <Activity size={20} />, color: '#13C2C2', to: '/member/members' },
  { key: 'totalPoints', label: '积分总量', icon: <Coins size={20} />, color: '#FA8C16', to: '/member/points' },
  { key: 'totalWalletBalance', label: '钱包余额(元)', icon: <Wallet size={20} />, color: '#1677FF', format: (v) => (v / 100).toFixed(2), to: '/member/wallets' },
  { key: 'todayCheckins', label: '今日签到', icon: <CalendarCheck size={20} />, color: '#EB2F96', to: '/member/checkin-logs' },
  { key: 'availableCoupons', label: '可用券数', icon: <Ticket size={20} />, color: '#F5222D', to: '/member/coupon-records' },
];

function ChartCard({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <Card bodyStyle={{ padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--semi-color-text-0)' }}>{title}</div>
      {children}
    </Card>
  );
}

export default function MemberDashboardPage() {
  const navigate = useNavigate();
  const palette = useChartPalette();
  const overviewQuery = useMemberStatsOverview();
  const chartsQuery = useMemberStatsCharts();
  const overview = overviewQuery.data ?? null;
  const charts = chartsQuery.data ?? null;
  const loading = overviewQuery.isLoading || chartsQuery.isLoading;

  const registerSpec = useMemo(() => makeAreaSpec({
    data: charts?.registerTrend ?? [],
    xField: 'date',
    series: [{ field: 'count', name: '注册数', color: '#07c160' }],
    palette,
    axis: { xLabel: shortDate },
  }), [charts?.registerTrend, palette]);

  const levelSpec = useMemo(() => makePieSpec({
    data: charts?.levelDistribution ?? [],
    categoryField: 'name',
    valueField: 'value',
    donut: false,
    colors: (charts?.levelDistribution ?? []).map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
    palette,
  }), [charts?.levelDistribution, palette]);

  const pointSpec = useMemo(() => makeLineSpec({
    data: charts?.pointTrend ?? [],
    xField: 'date',
    series: [
      { field: 'earned', name: '发放', color: '#07c160' },
      { field: 'spent', name: '消耗', color: '#F5222D' },
    ],
    palette,
    axis: { xLabel: shortDate },
  }), [charts?.pointTrend, palette]);

  const checkinSpec = useMemo(() => makeBarSpec({
    data: charts?.checkinTrend ?? [],
    xField: 'date',
    series: [{ field: 'count', name: '签到人数', color: '#07c160' }],
    palette,
    axis: { xLabel: shortDate },
  }), [charts?.checkinTrend, palette]);

  const activitySpec = useMemo(() => makePieSpec({
    data: charts?.activitySegments ?? [],
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: (charts?.activitySegments ?? []).map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
    palette,
  }), [charts?.activitySegments, palette]);

  const rechargeSpec = useMemo(() => makeBarSpec({
    data: charts?.rechargeSegments ?? [],
    xField: 'name',
    series: [{ field: 'value', name: '会员数', color: '#1677FF' }],
    palette,
  }), [charts?.rechargeSegments, palette]);

  // 累计会员增长：现存总量减去区间尾部逐日新增，反推每日累计值
  const cumulativeTrend = useMemo(() => {
    const trend = charts?.registerTrend ?? [];
    const total = overview?.totalMembers ?? 0;
    let acc = total;
    const result: { date: string; total: number }[] = [];
    for (let i = trend.length - 1; i >= 0; i--) {
      result.unshift({ date: trend[i].date, total: acc });
      acc -= trend[i].count;
    }
    return result;
  }, [charts?.registerTrend, overview?.totalMembers]);

  const cumulativeSpec = useMemo(() => makeAreaSpec({
    data: cumulativeTrend,
    xField: 'date',
    series: [{ field: 'total', name: '累计会员', color: '#722ED1' }],
    palette,
    axis: { xLabel: shortDate },
  }), [cumulativeTrend, palette]);

  const walletSpec = useMemo(() => makeLineSpec({
    data: (charts?.walletTrend ?? []).map((d) => ({ date: d.date, income: d.income / 100, expense: d.expense / 100 })),
    xField: 'date',
    series: [
      { field: 'income', name: '入账(元)', color: '#07c160' },
      { field: 'expense', name: '支出(元)', color: '#FA8C16' },
    ],
    palette,
    axis: { xLabel: shortDate },
  }), [charts?.walletTrend, palette]);

  const sourceSpec = useMemo(() => makePieSpec({
    data: charts?.sourceDistribution ?? [],
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: (charts?.sourceDistribution ?? []).map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
    palette,
  }), [charts?.sourceDistribution, palette]);

  const couponSpec = useMemo(() => makeBarSpec({
    data: charts?.couponStatusDistribution ?? [],
    xField: 'name',
    series: [{ field: 'value', name: '券数', color: '#EB2F96' }],
    palette,
  }), [charts?.couponStatusDistribution, palette]);

  if (loading) {
    const skeletonPlaceholder = (
      <div className="page-container zx-flat-panels">
        {/* 统计卡片骨架 */}
        <StatGrid minItemWidth={300} style={{ marginBottom: 16 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <Skeleton.Title style={{ width: 64, height: 26, marginBottom: 10 }} />
              <Skeleton.Paragraph rows={1} style={{ width: 80, marginBottom: 0 }} />
            </div>
          ))}
        </StatGrid>
        {/* 图表骨架：外层 .chart-grid 已提供分隔与内边距，骨架不画外壳，
            否则加载前后观感会跳变 */}
        <div className="chart-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton.Title style={{ width: 140, marginBottom: 16 }} />
              <Skeleton.Image style={{ width: '100%', height: 260, borderRadius: 'var(--semi-border-radius-medium)' }} />
            </div>
          ))}
        </div>
      </div>
    );
    return <Skeleton loading active placeholder={skeletonPlaceholder}>{null}</Skeleton>;
  }

  return (
    <div className="page-container zx-flat-panels">
      {/* 概览卡片：点击下钻到对应管理页 */}
      <StatGrid minItemWidth={300} style={{ marginBottom: 16 }}>
        {overview && STAT_ITEMS.map((item) => {
          const raw = overview[item.key];
          const value = item.format ? item.format(raw) : raw;
          const sub = item.key === 'todayCheckins' ? `签到率 ${overview.todayCheckinRate}%` : undefined;
          return <StatCard key={item.key} title={item.label} value={value} icon={item.icon} accent={item.color} sub={sub} onClick={item.to ? () => navigate(item.to!) : undefined} />;
        })}
      </StatGrid>

      {/* 图表区 */}
      <div className="chart-grid">
        <ChartCard title="近30天注册趋势">
          <AreaChart {...registerSpec} options={chartOptions} height={260} />
        </ChartCard>

        <ChartCard title="会员等级分布">
          {(charts?.levelDistribution?.length ?? 0) > 0 ? (
            <PieChart {...levelSpec} options={chartOptions} height={260} />
          ) : <Empty description="暂无数据" style={{ padding: '60px 0' }} />}
        </ChartCard>

        <ChartCard title="近30天积分收支">
          <LineChart {...pointSpec} options={chartOptions} height={260} />
        </ChartCard>

        <ChartCard title="近7天签到人数">
          <BarChart {...checkinSpec} options={chartOptions} height={260} />
        </ChartCard>

        <ChartCard title="会员活跃分层（最近登录）">
          {(charts?.activitySegments?.length ?? 0) > 0 ? (
            <PieChart {...activitySpec} options={chartOptions} height={260} />
          ) : <Empty description="暂无数据" style={{ padding: '60px 0' }} />}
        </ChartCard>

        <ChartCard title="充值能力分层（累计充值）">
          <BarChart {...rechargeSpec} options={chartOptions} height={260} />
        </ChartCard>

        <ChartCard title="累计会员增长（近30天）">
          <AreaChart {...cumulativeSpec} options={chartOptions} height={260} />
        </ChartCard>

        <ChartCard title="近30天钱包收支（元）">
          <LineChart {...walletSpec} options={chartOptions} height={260} />
        </ChartCard>

        <ChartCard title="注册来源分布">
          {(charts?.sourceDistribution?.length ?? 0) > 0 ? (
            <PieChart {...sourceSpec} options={chartOptions} height={260} />
          ) : <Empty description="暂无数据" style={{ padding: '60px 0' }} />}
        </ChartCard>

        <ChartCard title="卡券状态分布">
          <BarChart {...couponSpec} options={chartOptions} height={260} />
        </ChartCard>
      </div>

      {overview && (
        <div style={{ marginTop: 12 }}>
          <Text type="tertiary" size="small">钱包余额合计 {(overview.totalWalletBalance / 100).toFixed(2)} 元 · 积分总量 {overview.totalPoints}</Text>
        </div>
      )}
    </div>
  );
}
