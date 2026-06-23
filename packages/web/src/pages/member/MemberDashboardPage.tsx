import { useEffect, useState } from 'react';
import { Card, Typography, Skeleton, Empty } from '@douyinfe/semi-ui';
import {
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Users, UserPlus, CalendarPlus, Activity, Coins, Wallet, CalendarCheck, Ticket } from 'lucide-react';
import type { MemberStatsOverview, MemberStatsCharts } from '@zenith/shared';
import { request } from '@/utils/request';

const { Text } = Typography;

const PIE_COLORS = ['#07c160', '#4A90E2', '#FA8C16', '#722ED1', '#F5222D', '#13C2C2', '#EB2F96', '#1677FF'];

function shortDate(dateStr: string) {
  return dateStr.slice(5);
}

interface StatItem {
  key: keyof MemberStatsOverview;
  label: string;
  icon: React.ReactNode;
  color: string;
  format?: (v: number) => string;
}

const STAT_ITEMS: StatItem[] = [
  { key: 'totalMembers', label: '总会员数', icon: <Users size={20} />, color: '#07c160' },
  { key: 'todayNewMembers', label: '今日新增', icon: <UserPlus size={20} />, color: '#4A90E2' },
  { key: 'monthNewMembers', label: '本月新增', icon: <CalendarPlus size={20} />, color: '#722ED1' },
  { key: 'activeMembers30d', label: '近30天活跃', icon: <Activity size={20} />, color: '#13C2C2' },
  { key: 'totalPoints', label: '积分总量', icon: <Coins size={20} />, color: '#FA8C16' },
  { key: 'totalWalletBalance', label: '钱包余额(元)', icon: <Wallet size={20} />, color: '#1677FF', format: (v) => (v / 100).toFixed(2) },
  { key: 'todayCheckins', label: '今日签到', icon: <CalendarCheck size={20} />, color: '#EB2F96' },
  { key: 'availableCoupons', label: '可用券数', icon: <Ticket size={20} />, color: '#F5222D' },
];

function StatCard({ item, value, sub }: Readonly<{ item: StatItem; value: number; sub?: string }>) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180, background: 'var(--semi-color-bg-2)', border: '1px solid var(--semi-color-border)', borderRadius: 10, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${item.color}1a`, color: item.color, flexShrink: 0 }}>
        {item.icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, color: 'var(--semi-color-text-0)' }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 2 }}>{item.label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--semi-color-text-3)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <Card style={{ flex: '1 1 460px', minWidth: 360 }} bodyStyle={{ padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--semi-color-text-0)' }}>{title}</div>
      {children}
    </Card>
  );
}

export default function MemberDashboardPage() {
  const [overview, setOverview] = useState<MemberStatsOverview | null>(null);
  const [charts, setCharts] = useState<MemberStatsCharts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      request.get<MemberStatsOverview>('/api/member-stats/overview'),
      request.get<MemberStatsCharts>('/api/member-stats/charts'),
    ])
      .then(([o, c]) => {
        if (o.code === 0) setOverview(o.data);
        if (c.code === 0) setCharts(c.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    const skeletonPlaceholder = (
      <div className="page-container">
        {/* 统计卡片骨架 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ flex: '1 1 200px', minWidth: 180, background: 'var(--semi-color-bg-2)', border: '1px solid var(--semi-color-border)', borderRadius: 10, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <Skeleton.Avatar style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Skeleton.Title style={{ width: '60%', marginBottom: 8 }} />
                <Skeleton.Paragraph rows={1} style={{ width: '80%', marginBottom: 0 }} />
              </div>
            </div>
          ))}
        </div>
        {/* 图表卡片骨架 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ flex: '1 1 460px', minWidth: 360, background: 'var(--semi-color-bg-2)', border: '1px solid var(--semi-color-border)', borderRadius: 10, padding: 16 }}>
              <Skeleton.Title style={{ width: 140, marginBottom: 16 }} />
              <Skeleton.Image style={{ width: '100%', height: 260, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      </div>
    );
    return <Skeleton loading active placeholder={skeletonPlaceholder}>{null}</Skeleton>;
  }

  return (
    <div className="page-container">
      {/* 概览卡片 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        {overview && STAT_ITEMS.map((item) => {
          const raw = overview[item.key];
          const value = item.format ? item.format(raw) : raw;
          const sub = item.key === 'todayCheckins' ? `签到率 ${overview.todayCheckinRate}%` : undefined;
          return <StatCard key={item.key} item={item} value={value as number} sub={sub} />;
        })}
      </div>

      {/* 图表区 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <ChartCard title="近30天注册趋势">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={charts?.registerTrend ?? []} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="memReg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#07c160" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#07c160" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--semi-color-border)" />
              <XAxis dataKey="date" tickFormatter={shortDate} fontSize={12} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Area type="monotone" dataKey="count" name="注册数" stroke="#07c160" fill="url(#memReg)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="会员等级分布">
          {(charts?.levelDistribution?.length ?? 0) > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={charts?.levelDistribution ?? []} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(p) => `${p.name}: ${p.value}`}>
                  {(charts?.levelDistribution ?? []).map((entry, i) => <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty description="暂无数据" style={{ padding: '60px 0' }} />}
        </ChartCard>

        <ChartCard title="近30天积分收支">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={charts?.pointTrend ?? []} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--semi-color-border)" />
              <XAxis dataKey="date" tickFormatter={shortDate} fontSize={12} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="earned" name="发放" stroke="#07c160" dot={false} />
              <Line type="monotone" dataKey="spent" name="消耗" stroke="#F5222D" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="近7天签到人数">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts?.checkinTrend ?? []} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--semi-color-border)" />
              <XAxis dataKey="date" tickFormatter={shortDate} fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Bar dataKey="count" name="签到人数" fill="#07c160" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
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
