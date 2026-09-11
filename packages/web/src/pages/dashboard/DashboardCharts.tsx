/**
 * 首页仪表盘图表区（仅管理员可见的三组 VChart 数据视图）。
 *
 * 独立成懒加载 chunk：'@/components/charts' 模块求值即接入 VChart 主题，
 * 会拖入 ~1.9MB 的 @visactor 依赖树。拆出后 DashboardPage 主体
 * （欢迎区/统计概览/公告/日历）先渲染，图表随本 chunk 就绪后流式补齐。
 */
import { useMemo } from 'react';
import { Typography, Skeleton, Empty } from '@douyinfe/semi-ui';
import {
  AreaChart,
  LineChart,
  chartOptions,
  makeAreaSpec,
  makeLineSpec,
  useChartPalette,
} from '@/components/charts';
import { ModuleOperationPie } from '@/components/logs/ModuleOperationPie';
import type { DashboardCharts } from '@zenith/shared/analytics';
import { shortDate } from '@/utils/date';

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

export default function DashboardChartsRow({ charts, chartsLoading }: DashboardChartsRowProps) {
  const palette = useChartPalette();

  const loginTrendSpec = useMemo(() => makeLineSpec({
    data: charts?.loginTrend ?? [],
    xField: 'date',
    series: [
      { field: 'successCount', name: '成功', color: '#52C41A' },
      { field: 'failCount', name: '失败', color: '#F5222D' },
    ],
    palette,
    point: true,
    axis: { xLabel: shortDate },
    tooltip: { title: (x) => `日期：${x}` },
  }), [charts?.loginTrend, palette]);

  const userActivitySpec = useMemo(() => makeAreaSpec({
    data: charts?.userActivity ?? [],
    xField: 'date',
    series: [{ field: 'activeUsers', name: '活跃用户', color: '#4A90E2' }],
    palette,
    point: true,
    axis: { xLabel: shortDate },
    tooltip: { title: (x) => `日期：${x}` },
  }), [charts?.userActivity, palette]);

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
        empty={<div className="dashboard-chart-placeholder"><Empty description="今日暂无操作记录" /></div>}
      />
    );
  }

  return (
    <div className="dashboard-charts-row">
      <section className="dashboard-chart-section">
        <header className="dashboard-section-header">
          <Text strong>7 天登录趋势</Text>
          <span className="dashboard-section-meta">成功 / 失败</span>
        </header>
        {chartsLoading
          ? chartSkeleton
          : (
            <LineChart {...loginTrendSpec} options={chartOptions} height={200} />
          )
        }
      </section>

      <section className="dashboard-chart-section">
        <header className="dashboard-section-header">
          <Text strong>今日操作分布</Text>
          <span className="dashboard-section-meta">按模块</span>
        </header>
        {renderOperationPie()}
      </section>

      <section className="dashboard-chart-section">
        <header className="dashboard-section-header">
          <Text strong>7 天用户活跃度</Text>
          <span className="dashboard-section-meta">日活用户</span>
        </header>
        {chartsLoading
          ? chartSkeleton
          : (
            <AreaChart {...userActivitySpec} options={chartOptions} height={200} />
          )
        }
      </section>
    </div>
  );
}
