/** 行为概览：关键指标卡 + 访问趋势（支持自定义日期区间与环比对照） */
import { useMemo, useState } from 'react';
import { Card, DatePicker, Select, Skeleton, Switch, Typography } from '@douyinfe/semi-ui';
import { Activity, BarChart3, Clock, Eye, Flame, Target, TrendingUp, Users, Zap } from 'lucide-react';
import { LineChart, chartOptions, makeLineSpec, useChartPalette, StatCard, StatGrid } from '@/components/charts';
import { formatDateForApi } from '@/utils/date';
import { useAnalyticsOverview, useAnalyticsTrends } from '@/hooks/queries/analytics';
import { useBehaviorDays } from './behavior-days-context';
import { ACCENT_COLORS, DAYS_OPTIONS, msToReadable, numberText, percentText, sectionStyle, type ChartRow } from './analytics-format';
import { ChartPlaceholder, DeltaText, SectionHeader } from './analytics-shared';

export default function AnalyticsOverviewTab() {
  const palette = useChartPalette();
  const [days, setDays] = useBehaviorDays();
  const [customRange, setCustomRange] = useState<[string, string] | null>(null);
  const [compare, setCompare] = useState(false);
  const range = useMemo(
    () => (customRange ? { days, startDate: customRange[0], endDate: customRange[1] } : { days }),
    [customRange, days],
  );
  const overviewQuery = useAnalyticsOverview(range);
  const trendsQuery = useAnalyticsTrends(range, compare);
  const overview = overviewQuery.data ?? null;
  const trends = trendsQuery.data ?? null;
  const loading = overviewQuery.isFetching || trendsQuery.isFetching;

  const chartData = useMemo<ChartRow[]>(() => {
    if (!trends) return [];
    return trends.dates.map((date, index) => ({
      date,
      ...Object.fromEntries(trends.series.map((item) => [item.key, item.data[index] ?? 0])),
      // 上一周期按位对齐到主轴（虚拟对照）
      ...(trends.compare
        ? Object.fromEntries(trends.compare.series.map((item) => [`${item.key}_prev`, item.data[index] ?? 0]))
        : {}),
    }));
  }, [trends]);

  const trendSpec = useMemo(() => {
    const mainSeries = (trends?.series ?? []).map((item, index) => ({
      field: item.key,
      name: item.name,
      color: index === 0 ? palette.primary : ACCENT_COLORS[(index - 1) % ACCENT_COLORS.length],
    }));
    const compareSeries = trends?.compare
      ? trends.compare.series.map((item, index) => ({
          field: `${item.key}_prev`,
          name: `上期${item.name}`,
          color: `${index === 0 ? palette.primary : ACCENT_COLORS[(index - 1) % ACCENT_COLORS.length]}55`,
        }))
      : [];
    return makeLineSpec({
      data: chartData,
      xField: 'date',
      series: [...mainSeries, ...compareSeries],
      palette,
    });
  }, [chartData, palette, trends?.series, trends?.compare]);

  const cards = overview ? [
    { title: '浏览量 PV', value: numberText(overview.pv), icon: <Eye size={19} />, accent: palette.primary, sub: <DeltaText value={overview.pvDelta} /> },
    { title: '访客 UV', value: numberText(overview.uv), icon: <Users size={19} />, accent: '#22c55e', sub: <DeltaText value={overview.uvDelta} /> },
    { title: '会话', value: numberText(overview.sessions), icon: <Activity size={19} />, accent: '#8b5cf6', sub: <DeltaText value={overview.sessionsDelta} /> },
    { title: '事件', value: numberText(overview.events), icon: <Flame size={19} />, accent: '#f59e0b' },
    { title: '新增用户', value: numberText(overview.newUsers), icon: <TrendingUp size={19} />, accent: '#ef4444' },
    { title: '平均会话时长', value: msToReadable(overview.avgSessionMs), icon: <Clock size={19} />, accent: '#06b6d4' },
    { title: '跳出率', value: percentText(overview.bounceRate), icon: <Target size={19} />, accent: '#f97316', sub: <DeltaText value={overview.bounceRateDelta} suffix=" pts" /> },
    { title: '人均页数', value: overview.avgPagesPerSession.toFixed(2), icon: <BarChart3 size={19} />, accent: '#84cc16' },
    { title: '实时在线', value: numberText(overview.activeNow), icon: <Zap size={19} />, accent: '#ec4899' },
  ] : [];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="行为概览"
        description="关键指标与趋势"
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Typography.Text type="tertiary" size="small">环比对照</Typography.Text>
              <Switch size="small" checked={compare} onChange={setCompare} />
            </div>
            <DatePicker
              type="dateRange"
              density="compact"
              placeholder="自定义日期区间"
              style={{ width: 240 }}
              onChange={(value) => {
                const [s, e] = Array.isArray(value) ? value : [];
                setCustomRange(s && e ? [formatDateForApi(s as Date), formatDateForApi(e as Date)] : null);
              }}
            />
            <Select value={days} optionList={DAYS_OPTIONS} disabled={!!customRange} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />
          </div>
        )}
      />
      {loading && !overview ? (
        <Skeleton
          loading
          active
          placeholder={
            <StatGrid minItemWidth={190}>
              {Array.from({ length: 9 }, (_, i) => `sk-stat-${i}`).map((key) => (
                <div key={key}>
                  <Skeleton.Title style={{ width: 64, height: 26, marginBottom: 10 }} />
                  <Skeleton.Paragraph rows={1} style={{ width: 80, marginBottom: 0 }} />
                </div>
              ))}
            </StatGrid>
          }
        >{null}</Skeleton>
      ) : <StatGrid minItemWidth={190}>{cards.map((card) => <StatCard key={String(card.title)} {...card} />)}</StatGrid>}
      <Card title="访问趋势" bodyStyle={{ padding: 16 }}>
        {chartData.length === 0 ? <ChartPlaceholder loading={loading} /> : (
          <LineChart {...trendSpec} options={chartOptions} height={300} />
        )}
      </Card>
    </div>
  );
}
