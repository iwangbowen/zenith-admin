import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Spin, Select } from '@douyinfe/semi-ui';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
  PieChart,
  Pie,
  Legend,
} from 'recharts';
import dayjs from 'dayjs';
import { request } from '@/utils/request';
import { formatDate } from '@/utils/date';
import type { LoginLogStats } from '@zenith/shared';

const DAYS_OPTIONS = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '最近 90 天', value: 90 },
];

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const SUCCESS_COLOR = '#10b981';
const FAIL_COLOR = '#ef4444';

// Pie chart color palettes
const BROWSER_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6b7280'];
const OS_COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#10b981', '#f97316', '#ec4899', '#6b7280'];

function getHeatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'var(--semi-color-fill-1)';
  const pct = count / max;
  if (pct < 0.25) return '#dbeafe';
  if (pct < 0.5) return '#93c5fd';
  if (pct < 0.75) return '#3b82f6';
  return '#1d4ed8';
}

const sectionStyle: React.CSSProperties = {
  background: 'var(--semi-color-bg-1)',
  border: '1px solid var(--semi-color-border)',
  borderRadius: 6,
  padding: '16px 20px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--semi-color-text-0)',
  marginBottom: 12,
};

const tooltipStyle: React.CSSProperties = {
  backgroundColor: 'var(--semi-color-bg-2)',
  border: '1px solid var(--semi-color-border)',
  borderRadius: 6,
  fontSize: 12,
};

interface StatCardProps {
  readonly title: string;
  readonly value: string | number;
  readonly sub?: string;
  readonly accent?: string;
}

function StatCard({ title, value, sub, accent }: StatCardProps) {
  return (
    <div style={{ ...sectionStyle, display: 'flex', flexDirection: 'column', gap: 4, borderLeft: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--semi-color-text-0)', lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>{sub}</div>}
      <div style={{ fontSize: 13, color: 'var(--semi-color-text-1)', marginTop: 2 }}>{title}</div>
    </div>
  );
}

function EmptyChart({ height = 260 }: { readonly height?: number }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--semi-color-text-2)' }}>
      暂无数据
    </div>
  );
}

export default function LoginLogStatsPanel() {
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<LoginLogStats | null>(null);

  const fetchStats = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await request.get<LoginLogStats>(`/api/login-logs/stats?days=${d}`);
      setStats(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats(days);
  }, [days, fetchStats]);

  // Fill missing dates for continuous daily series
  const filledDailyStats = useMemo(() => {
    if (!stats) return [];
    const dataMap = new Map(stats.dailyStats.map((d) => [d.date, d]));
    const today = dayjs();
    return Array.from({ length: days }, (_, i) => {
      const date = today.subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
      return dataMap.get(date) ?? { date, count: 0, successCount: 0, failCount: 0 };
    });
  }, [stats, days]);

  // Build calendar heatmap grid (weeks × 7 days, aligned to Monday)
  const heatmapGrid = useMemo(() => {
    if (!stats) return [];
    const dataMap = new Map(stats.dailyStats.map((d) => [d.date, d.count]));
    const today = dayjs().startOf('day');
    const startDay = today.subtract(days - 1, 'day');
    const startMon = startDay.subtract((startDay.day() + 6) % 7, 'day');
    const weeks: { date: string; count: number; inRange: boolean }[][] = [];
    let cur = startMon;
    while (!cur.isAfter(today)) {
      const week: { date: string; count: number; inRange: boolean }[] = [];
      for (let di = 0; di < 7; di++) {
        const dt = cur.add(di, 'day');
        const dateStr = formatDate(dt.valueOf());
        week.push({ date: dateStr, count: dataMap.get(dateStr) ?? 0, inRange: !dt.isBefore(startDay) && !dt.isAfter(today) });
      }
      weeks.push(week);
      cur = cur.add(7, 'day');
    }
    return weeks;
  }, [stats, days]);

  const maxDailyCount = useMemo(
    () => Math.max(1, ...(stats?.dailyStats.map((d) => d.count) ?? [])),
    [stats],
  );

  // Security data
  const userChartData = useMemo(() => [...(stats?.userStats ?? [])].reverse(), [stats]);
  const ipFailChartData = useMemo(() => [...(stats?.ipFailStats ?? [])].reverse(), [stats]);

  // Device data with fill colors for PieChart
  const browserPieData = useMemo(
    () => (stats?.browserStats ?? []).map((d, i) => ({ ...d, fill: BROWSER_COLORS[i % BROWSER_COLORS.length] })),
    [stats],
  );
  const osPieData = useMemo(
    () => (stats?.osStats ?? []).map((d, i) => ({ ...d, fill: OS_COLORS[i % OS_COLORS.length] })),
    [stats],
  );

  // Success/fail pie
  const summary = stats?.summary;
  const successRate = summary == null || summary.total === 0
    ? null
    : ((summary.successCount / summary.total) * 100).toFixed(1);

  const statusPieData = summary
    ? [
        { name: '成功', value: summary.successCount, fill: SUCCESS_COLOR },
        { name: '失败', value: summary.failCount, fill: FAIL_COLOR },
      ]
    : [];

  const xTickInterval = (() => {
    if (days <= 7) return 0;
    if (days <= 30) return 4;
    return 12;
  })();

  return (
    <div>
      {/* 时间选择器 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Select value={days} onChange={(v) => setDays(v as number)} style={{ width: 140 }}>
          {DAYS_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>
          ))}
        </Select>
      </div>

      <Spin spinning={loading}>
        {/* ── 汇总指标卡 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <StatCard title="总登录次数" value={summary ? summary.total.toLocaleString() : '—'} sub={`近 ${days} 天累计`} accent="#3b82f6" />
          <StatCard
            title="登录成功率"
            value={successRate == null ? '—' : `${successRate}%`}
            sub={summary ? `成功 ${summary.successCount.toLocaleString()} · 失败 ${summary.failCount.toLocaleString()}` : undefined}
            accent={SUCCESS_COLOR}
          />
          <StatCard
            title="登录失败次数"
            value={summary ? summary.failCount.toLocaleString() : '—'}
            sub="密码错误、账号锁定等"
            accent={summary && summary.failCount > 0 ? FAIL_COLOR : undefined}
          />
          <StatCard title="活跃用户数" value={summary ? summary.uniqueUsers.toLocaleString() : '—'} sub="不重复用户账号" accent="#8b5cf6" />
        </div>

        {/* ── 每日登录趋势（成功/失败堆叠面积） ── */}
        <div style={{ ...sectionStyle, marginBottom: 16 }}>
          <div style={sectionTitleStyle}>每日登录趋势（成功 / 失败）</div>
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={filledDailyStats} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="loginAreaSuccess" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={SUCCESS_COLOR} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={SUCCESS_COLOR} stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="loginAreaFail" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={FAIL_COLOR} stopOpacity={0.6} />
                  <stop offset="95%" stopColor={FAIL_COLOR} stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={xTickInterval} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) => [`${v} 次`, name === 'successCount' ? '成功' : '失败']}
                labelFormatter={(l) => `日期：${l}`}
              />
              <Legend formatter={(value) => (value === 'successCount' ? '成功' : '失败')} wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="successCount" stackId="a" stroke={SUCCESS_COLOR} fill="url(#loginAreaSuccess)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="failCount" stackId="a" stroke={FAIL_COLOR} fill="url(#loginAreaFail)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* ── 安全监控：Top 用户 + 失败 Top IP ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Top 10 登录用户</div>
            {userChartData.length === 0 ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={userChartData} layout="vertical" margin={{ left: 4, right: 36, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="username" width={88} tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} 次`, '登录次数']} />
                  <Bar dataKey="count" fill="#10b981" radius={[0, 3, 3, 0]} label={{ position: 'right', fontSize: 11, fill: 'var(--semi-color-text-2)' }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div style={{ ...sectionStyle, border: `1px solid ${ipFailChartData.length > 0 ? '#fca5a5' : 'var(--semi-color-border)'}` }}>
            <div style={{ ...sectionTitleStyle, color: ipFailChartData.length > 0 ? FAIL_COLOR : undefined }}>
              失败登录 Top 10 IP
              {ipFailChartData.length > 0 && <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 8, color: 'var(--semi-color-text-2)' }}>可能存在安全风险</span>}
            </div>
            {ipFailChartData.length === 0
              ? <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUCCESS_COLOR, fontSize: 13 }}>✔️ 该时间段无失败登录</div>
              : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={ipFailChartData} layout="vertical" margin={{ left: 4, right: 36, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="ip" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} 次`, '失败次数']} />
                  <Bar dataKey="count" fill={FAIL_COLOR} radius={[0, 3, 3, 0]} label={{ position: 'right', fontSize: 11, fill: FAIL_COLOR }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── 小时分布 + 成功/失败占比 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>按小时登录分布</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stats?.hourlyStats ?? []} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickFormatter={(h: number) => `${String(h).padStart(2, '0')}h`} interval={2} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={40} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => [`${v} 次`, '登录次数']}
                  labelFormatter={(l) => `${String(l).padStart(2, '0')}:00 – ${String(l).padStart(2, '0')}:59`}
                />
                <Bar dataKey="count" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>成功 / 失败占比</div>
            {statusPieData.every((d) => d.value === 0) ? <EmptyChart height={240} /> : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={statusPieData} nameKey="name" dataKey="value" cx="50%" cy="50%" innerRadius={60} outerRadius={92} paddingAngle={2} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${value} 次`, name]} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--semi-color-text-1)' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── 设备分析：浏览器 + 操作系统（饼图展示占比） ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>浏览器分布</div>
            {browserPieData.length === 0 ? <EmptyChart height={260} /> : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={browserPieData} nameKey="browser" dataKey="count" cx="50%" cy="50%" outerRadius={90} paddingAngle={2}
                    label={({ browser, percent }: { browser: string; percent: number }) =>
                      percent > 0.04 ? `${browser} ${(percent * 100).toFixed(0)}%` : ''
                    }
                    labelLine
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${value} 次`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>操作系统分布</div>
            {osPieData.length === 0 ? <EmptyChart height={260} /> : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={osPieData} nameKey="os" dataKey="count" cx="50%" cy="50%" outerRadius={90} paddingAngle={2}
                    label={({ os, percent }: { os: string; percent: number }) =>
                      percent > 0.04 ? `${os} ${(percent * 100).toFixed(0)}%` : ''
                    }
                    labelLine
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${value} 次`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── 登录热力图 ── */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>登录热力图（近 {days} 天）</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 22, flexShrink: 0 }}>
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} style={{ height: 14, lineHeight: '14px', fontSize: 11, color: 'var(--semi-color-text-2)', width: 28, textAlign: 'right' }}>
                  {label}
                </div>
              ))}
            </div>
            <div style={{ flex: 1, overflowX: 'auto' }}>
              <div style={{ display: 'flex', gap: 3, minWidth: 'max-content' }}>
                {heatmapGrid.map((week) => {
                  const firstDate = week[0].date;
                  const prevWeekIdx = heatmapGrid.indexOf(week) - 1;
                  const prevFirst = heatmapGrid[prevWeekIdx]?.[0]?.date;
                  const monthLabel = firstDate.slice(5, 7) === prevFirst?.slice(5, 7) ? '' : `${firstDate.slice(5, 7)}月`;
                  return (
                    <div key={firstDate} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ height: 18, fontSize: 11, color: 'var(--semi-color-text-2)', whiteSpace: 'nowrap' }}>{monthLabel}</div>
                      {week.map((cell) => (
                        <div
                          key={cell.date}
                          title={cell.inRange ? `${cell.date}：${cell.count} 次登录` : ''}
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 2,
                            background: cell.inRange ? getHeatColor(cell.count, maxDailyCount) : 'transparent',
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 11, color: 'var(--semi-color-text-2)' }}>
                <span>少</span>
                {['var(--semi-color-fill-1)', '#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'].map((c) => (
                  <div key={c} style={{ width: 12, height: 12, borderRadius: 2, background: c }} />
                ))}
                <span>多</span>
              </div>
            </div>
          </div>
        </div>
      </Spin>
    </div>
  );
}
