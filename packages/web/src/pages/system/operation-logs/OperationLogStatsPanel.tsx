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
} from 'recharts';
import dayjs from 'dayjs';
import { request } from '../../../utils/request';
import type { OperationLogStats } from '@zenith/shared';

const DAYS_OPTIONS = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '最近 90 天', value: 90 },
];

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getHeatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'var(--semi-color-fill-1)';
  const pct = count / max;
  if (pct < 0.25) return '#dbeafe';
  if (pct < 0.50) return '#93c5fd';
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

export default function OperationLogStatsPanel() {
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<OperationLogStats | null>(null);

  const fetchStats = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await request.get<OperationLogStats>(`/api/operation-logs/stats?days=${d}`);
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

  // Build calendar heatmap grid (weeks × 7 days, aligned to Monday)
  const heatmapGrid = useMemo(() => {
    if (!stats) return [];
    const dataMap = new Map(stats.dailyStats.map((d) => [d.date, d.count]));
    const today = dayjs().startOf('day');
    const startDay = today.subtract(days - 1, 'day');
    // Align start to Monday of that week: day() 0=Sun 1=Mon ... 6=Sat → offset = (day+6)%7
    const startMon = startDay.subtract((startDay.day() + 6) % 7, 'day');

    const weeks: { date: string; count: number; inRange: boolean }[][] = [];
    let cur = startMon;
    while (!cur.isAfter(today)) {
      const week: { date: string; count: number; inRange: boolean }[] = [];
      for (let di = 0; di < 7; di++) {
        const dt = cur.add(di, 'day');
        const dateStr = dt.format('YYYY-MM-DD');
        week.push({
          date: dateStr,
          count: dataMap.get(dateStr) ?? 0,
          inRange: !dt.isBefore(startDay) && !dt.isAfter(today),
        });
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

  const moduleChartData = useMemo(
    () => [...(stats?.moduleStats ?? [])].slice(0, 10).reverse(),
    [stats],
  );
  const userChartData = useMemo(
    () => [...(stats?.userStats ?? [])].reverse(),
    [stats],
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Select
          value={days}
          onChange={(v) => setDays(v as number)}
          style={{ width: 140 }}
        >
          {DAYS_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>
          ))}
        </Select>
      </div>

      <Spin spinning={loading}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* 模块操作统计 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>按模块操作统计（Top 10）</div>
            {moduleChartData.length === 0 ? (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--semi-color-text-2)' }}>暂无数据</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={moduleChartData}
                  layout="vertical"
                  margin={{ left: 4, right: 24, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="module" width={88} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => [`${v} 次`, '操作次数']} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top 10 用户统计 */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Top 10 操作用户</div>
            {userChartData.length === 0 ? (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--semi-color-text-2)' }}>暂无数据</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={userChartData}
                  layout="vertical"
                  margin={{ left: 4, right: 24, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="username" width={88} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => [`${v} 次`, '操作次数']} />
                  <Bar dataKey="count" fill="#10b981" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* 每日操作趋势 */}
        <div style={{ ...sectionStyle, marginBottom: 16 }}>
          <div style={sectionTitleStyle}>每日操作趋势</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart
              data={stats?.dailyStats ?? []}
              margin={{ left: 0, right: 12, top: 4, bottom: 4 }}
            >
              <defs>
                <linearGradient id="statsAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                interval={days <= 7 ? 0 : days <= 30 ? 4 : 12}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip
                formatter={(v) => [`${v} 次`, '操作次数']}
                labelFormatter={(l) => `日期：${l}`}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#3b82f6"
                fill="url(#statsAreaGradient)"
                strokeWidth={2}
                dot={days <= 14 ? { r: 3 } : false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* 操作热力图 */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>操作热力图（近 {days} 天）</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            {/* 星期标签 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 22, flexShrink: 0 }}>
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  style={{ height: 14, lineHeight: '14px', fontSize: 11, color: 'var(--semi-color-text-2)', width: 28, textAlign: 'right' }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* 日历格子 */}
            <div style={{ flex: 1, overflowX: 'auto' }}>
              <div style={{ display: 'flex', gap: 3, minWidth: 'max-content' }}>
                {heatmapGrid.map((week, wi) => {
                  const prevFirst = heatmapGrid[wi - 1]?.[0]?.date;
                  const monthLabel =
                    week[0].date.slice(5, 7) !== (prevFirst?.slice(5, 7) ?? '')
                      ? dayjs(week[0].date).format('MM月')
                      : '';
                  return (
                    <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ height: 18, fontSize: 11, color: 'var(--semi-color-text-2)', whiteSpace: 'nowrap' }}>
                        {monthLabel}
                      </div>
                      {week.map((cell) => (
                        <div
                          key={cell.date}
                          title={cell.inRange ? `${cell.date}：${cell.count} 次操作` : ''}
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 2,
                            background: cell.inRange
                              ? getHeatColor(cell.count, maxDailyCount)
                              : 'transparent',
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* 图例 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 11, color: 'var(--semi-color-text-2)' }}>
                <span>少</span>
                {(['var(--semi-color-fill-1)', '#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'] as const).map((c, i) => (
                  <div key={i} style={{ width: 12, height: 12, borderRadius: 2, background: c }} />
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
