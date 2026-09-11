import { useMemo, useState } from 'react';
import { Card, Radio, RadioGroup, SideSheet, Spin } from '@douyinfe/semi-ui';
import { Eye, MousePointerClick, TrendingUp, Users } from 'lucide-react';
import {
  AreaChart, BarChart, EmptyChart, PieChart, StatCard, StatGrid,
  chartOptions, isEmptyValues, makeAreaSpec, makeBarSpec, makePieSpec, useChartPalette,
} from '@/components/charts';
import { useShortLinkStats } from '@/hooks/queries/short-links';
import type { ShortLink } from '@zenith/shared/short-link';
import { shortDate } from '@/utils/date';

interface ShortLinkStatsDrawerProps {
  link: ShortLink | null;
  onClose: () => void;
}

/** 短链访问统计抽屉：趋势 / 设备 / 地域 / 来源 / 浏览器 */
export default function ShortLinkStatsDrawer({ link, onClose }: ShortLinkStatsDrawerProps) {
  const [days, setDays] = useState(30);
  const palette = useChartPalette();
  const statsQuery = useShortLinkStats(link?.id ?? null, days);
  const stats = statsQuery.data;

  const trendSpec = useMemo(() => makeAreaSpec({
    data: stats?.trend ?? [],
    xField: 'date',
    series: [
      { field: 'pv', name: 'PV', color: palette.primary },
      { field: 'uv', name: 'UV', color: palette.active },
    ],
    palette,
    fillOpacity: 0.16,
    axis: { xLabel: shortDate },
    tooltip: { title: (value) => `日期：${value}` },
  }), [stats?.trend, palette]);

  const deviceSpec = useMemo(() => makePieSpec({
    data: stats?.devices ?? [],
    categoryField: 'name',
    valueField: 'count',
    palette,
    valueUnit: '次',
  }), [stats?.devices, palette]);

  const regionSpec = useMemo(() => makeBarSpec({
    data: stats?.regions ?? [],
    xField: 'name',
    series: [{ field: 'count', name: '访问量', color: palette.active }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    categoryAxisWidth: 88,
  }), [stats?.regions, palette]);

  const refererSpec = useMemo(() => makeBarSpec({
    data: stats?.referers ?? [],
    xField: 'name',
    series: [{ field: 'count', name: '访问量', color: palette.primary }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    categoryAxisWidth: 110,
  }), [stats?.referers, palette]);

  const browserSpec = useMemo(() => makeBarSpec({
    data: stats?.browsers ?? [],
    xField: 'name',
    series: [{ field: 'count', name: '访问量', color: palette.active }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    categoryAxisWidth: 96,
  }), [stats?.browsers, palette]);

  return (
    <SideSheet
      title={`访问统计${link ? ` · ${link.title || link.code}` : ''}`}
      visible={link !== null}
      onCancel={onClose}
      width={760}
      closeOnEsc
    >
      {/* 抽屉走 portal 渲染，页面根的 .zx-flat-panels 覆盖不到，需在内容层自带：
          统计区遵循「无卡片」设计语言，Card 退化为细线起头的平铺面板 */}
      <div className="zx-flat-panels">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <RadioGroup
            type="button"
            buttonSize="small"
            value={days}
            onChange={(e) => setDays(e.target.value as number)}
          >
            <Radio value={7}>近 7 天</Radio>
            <Radio value={30}>近 30 天</Radio>
            <Radio value={90}>近 90 天</Radio>
          </RadioGroup>
        </div>

        <Spin spinning={link !== null && statsQuery.isPending}>
          <StatGrid>
            <StatCard title="累计访问（PV）" value={stats?.totals.pv ?? 0} icon={<MousePointerClick size={16} />} />
            <StatCard title="访客数（UV）" value={stats?.totals.uv ?? 0} icon={<Users size={16} />} />
            <StatCard title="今日访问" value={stats?.totals.todayPv ?? 0} icon={<TrendingUp size={16} />} />
            <StatCard title="今日访客" value={stats?.totals.todayUv ?? 0} icon={<Eye size={16} />} />
          </StatGrid>

          <Card title="访问趋势" style={{ marginTop: 16 }}>
            {isEmptyValues((stats?.trend ?? []).map((p) => ({ value: p.pv + p.uv }))) ? <EmptyChart height={220} /> : (
              <AreaChart {...trendSpec} options={chartOptions} height={220} />
            )}
          </Card>

          <div className="chart-grid" style={{ marginTop: 16 }}>
            <Card title="设备分布">
              {(stats?.devices.length ?? 0) === 0 ? <EmptyChart height={220} /> : (
                <PieChart {...deviceSpec} options={chartOptions} height={220} />
              )}
            </Card>
            <Card title="地域分布 Top 10">
              {(stats?.regions.length ?? 0) === 0 ? <EmptyChart height={220} /> : (
                <BarChart {...regionSpec} options={chartOptions} height={220} />
              )}
            </Card>
            <Card title="来源分布 Top 10">
              {(stats?.referers.length ?? 0) === 0 ? <EmptyChart height={220} /> : (
                <BarChart {...refererSpec} options={chartOptions} height={220} />
              )}
            </Card>
            <Card title="浏览器分布 Top 10">
              {(stats?.browsers.length ?? 0) === 0 ? <EmptyChart height={220} /> : (
                <BarChart {...browserSpec} options={chartOptions} height={220} />
              )}
            </Card>
          </div>
        </Spin>
      </div>
    </SideSheet>
  );
}
