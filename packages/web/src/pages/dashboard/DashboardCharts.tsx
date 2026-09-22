/**
 * 首页仪表盘图表区（仅管理员可见的两组 VChart 数据视图）。
 *
 * 独立成懒加载 chunk：'@/components/charts' 模块求值即接入 VChart 主题，
 * 会拖入 ~1.9MB 的 @visactor 依赖树。拆出后 DashboardPage 主体
 * （欢迎区/统计概览/公告/日历）先渲染，图表随本 chunk 就绪后流式补齐。
 *
 * 两组图表都可点击下钻到对应列表页：折线点位 → 该天该状态的登录日志，
 * 饼图扇区 → 该模块的操作日志；地址拼装见 ./dashboard-drilldown，
 * 目标页用 useListDeepLink 消费后即从地址栏移除。
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Skeleton, Empty } from '@douyinfe/semi-ui';
import {
  LineChart,
  chartOptions,
  makeLineSpec,
  useChartPalette,
} from '@/components/charts';
import { ModuleOperationPie } from '@/components/logs/ModuleOperationPie';
import type { DashboardCharts } from '@zenith/shared/analytics';
import { shortDate } from '@/utils/date';
import { LOGIN_TREND_SERIES, loginLogsDrillUrl, operationLogsDrillUrl } from './dashboard-drilldown';

const { Text } = Typography;

const chartSkeleton = (
  <div className="dashboard-chart-placeholder">
    <Skeleton active loading placeholder={
      <div style={{ width: '100%', height: 200, padding: '12px 0' }}>
        <Skeleton.Paragraph rows={6} style={{ width: '100%' }} />
      </div>
    } />
  </div>
);

interface DashboardChartsRowProps {
  readonly charts: DashboardCharts | null;
  readonly chartsLoading: boolean;
}

/** 折线点位：多系列宽表经 wideToLong 摊平时保留了原始行，因此日期与系列名都能取到 */
interface LoginTrendPoint {
  readonly date?: string;
  readonly __type?: string;
}

export default function DashboardChartsRow({ charts, chartsLoading }: DashboardChartsRowProps) {
  const palette = useChartPalette();
  const navigate = useNavigate();

  const loginTrendSpec = useMemo(() => makeLineSpec({
    data: charts?.loginTrend ?? [],
    xField: 'date',
    series: LOGIN_TREND_SERIES.map(({ field, name, color }) => ({ field, name, color })),
    palette,
    point: true,
    axis: { xLabel: shortDate },
    tooltip: { title: (x) => `日期：${x}` },
  }), [charts?.loginTrend, palette]);

  /** 点空白 / 轴标签 / 图例时拿不到 date，这时不跳转 */
  function drillLoginTrend(point: LoginTrendPoint | undefined) {
    if (!point?.date) return;
    navigate(loginLogsDrillUrl(point.date, point.__type ?? ''));
  }

  function renderOperationPie() {
    if (chartsLoading) return (
      <div className="dashboard-chart-placeholder">
        <Skeleton active loading placeholder={
          <div style={{ width: '100%', height: 200, display: 'flex', alignItems: 'flex-end', gap: 12, padding: '0 8px' }}>
            {[60, 80, 45, 90, 55, 70].map((h) => (
              <Skeleton.Button key={h} style={{ flex: 1, height: `${h}%`, borderRadius: 'var(--semi-border-radius-small)' }} />
            ))}
          </div>
        } />
      </div>
    );
    return (
      <ModuleOperationPie
        data={charts?.operationTypes ?? []}
        height={200}
        onSliceClick={(module) => navigate(operationLogsDrillUrl(module))}
        empty={<div className="dashboard-chart-placeholder"><Empty description="今日暂无操作记录" /></div>}
      />
    );
  }

  return (
    <div className="dashboard-charts-row">
      <section className="dashboard-chart-section">
        <header className="dashboard-section-header">
          <Text strong>7 天登录趋势</Text>
          <span className="dashboard-section-meta">成功 / 失败 · 点击数据点看日志</span>
        </header>
        {chartsLoading
          ? chartSkeleton
          : (
            <LineChart
              {...loginTrendSpec}
              options={chartOptions}
              height={200}
              onClick={(e) => drillLoginTrend(e?.datum as LoginTrendPoint | undefined)}
            />
          )
        }
      </section>

      <section className="dashboard-chart-section">
        <header className="dashboard-section-header">
          <Text strong>今日操作分布</Text>
          <span className="dashboard-section-meta">按模块 · 点击扇区看日志</span>
        </header>
        {renderOperationPie()}
      </section>
    </div>
  );
}
