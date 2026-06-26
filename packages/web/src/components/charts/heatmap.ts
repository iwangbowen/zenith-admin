import dayjs from 'dayjs';
import type { IHeatmapChartSpec } from '@visactor/react-vchart';
import { formatDate } from '@/utils/date';
import type { ChartPalette } from './palette';
import {
  axisText,
  datumBoolean,
  datumNumber,
  datumText,
  makeCommonCartesianSpec,
  makeCommonTooltip,
  type ChartDatum,
} from './helpers';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export interface HeatmapDatum {
  readonly week: string;
  readonly weekday: string;
  readonly date: string;
  readonly count: number;
  readonly inRange: boolean;
  readonly monthLabel: string;
}

/**
 * 由「日期 → 次数」的日统计构建近 `days` 天的日历热力图网格（按周一对齐，列=周、行=星期）。
 * 与 LoginLogStatsPanel / OperationLogStatsPanel 共用，保证两处热力图完全一致。
 */
export function buildCalendarHeatmap(
  daily: readonly { readonly date: string; readonly count: number }[],
  days: number,
): { data: HeatmapDatum[]; maxCount: number } {
  const dataMap = new Map(daily.map((d) => [d.date, d.count]));
  const today = dayjs().startOf('day');
  const startDay = today.subtract(days - 1, 'day');
  const startMon = startDay.subtract((startDay.day() + 6) % 7, 'day');
  const data: HeatmapDatum[] = [];
  let cur = startMon;
  let weekIndex = 0;
  while (!cur.isAfter(today)) {
    const week = String(weekIndex + 1);
    const firstDate = formatDate(cur.valueOf());
    const prevFirstDate = weekIndex === 0 ? null : formatDate(cur.subtract(7, 'day').valueOf());
    const monthLabel = firstDate.slice(5, 7) === prevFirstDate?.slice(5, 7) ? '' : `${firstDate.slice(5, 7)}月`;
    for (let di = 0; di < 7; di++) {
      const dt = cur.add(di, 'day');
      const dateStr = formatDate(dt.valueOf());
      data.push({
        week,
        weekday: WEEKDAY_LABELS[di],
        date: dateStr,
        count: dataMap.get(dateStr) ?? 0,
        inRange: !dt.isBefore(startDay) && !dt.isAfter(today),
        monthLabel,
      });
    }
    cur = cur.add(7, 'day');
    weekIndex += 1;
  }
  const maxCount = Math.max(1, ...data.filter((d) => d.inRange).map((d) => d.count));
  return { data, maxCount };
}

function getHeatmapFill(datum: ChartDatum, max: number, palette: ChartPalette): string {
  if (!datumBoolean(datum, 'inRange')) return 'rgba(0, 0, 0, 0)';
  const count = datumNumber(datum, 'count');
  if (count <= 0 || max <= 0) return palette.heatColors[0];
  const pct = count / max;
  if (pct < 0.25) return palette.heatColors[1];
  if (pct < 0.5) return palette.heatColors[2];
  if (pct < 0.75) return palette.heatColors[3];
  return palette.heatColors[4];
}

export function makeCalendarHeatmapSpec(
  data: readonly HeatmapDatum[],
  maxCount: number,
  palette: ChartPalette,
  options: { readonly valueLabel?: string; readonly valueUnit?: string } = {},
): Partial<IHeatmapChartSpec> {
  const valueLabel = options.valueLabel ?? '次数';
  const valueUnit = options.valueUnit ?? '次';
  const monthLabelByWeek = new Map(data.map((d) => [d.week, d.monthLabel]));

  return {
    ...makeCommonCartesianSpec(palette),
    padding: { top: 8, right: 12, bottom: 22, left: 38 },
    data: [{ id: 'calendar-heatmap', values: [...data] }],
    xField: 'week',
    yField: 'weekday',
    valueField: 'count',
    cell: {
      style: {
        fill: (datum: ChartDatum) => getHeatmapFill(datum, maxCount, palette),
        stroke: (datum: ChartDatum) => (datumBoolean(datum, 'inRange') ? palette.tooltipBg : 'rgba(0, 0, 0, 0)'),
        lineWidth: 2,
        cornerRadius: 4,
      },
    },
    label: { visible: false },
    axes: [
      {
        orient: 'bottom',
        type: 'band',
        tick: { visible: false },
        domainLine: { visible: false },
        grid: { visible: false },
        label: {
          style: { fill: palette.text2, fontSize: 11 },
          space: 8,
          formatMethod: (value: string | string[]) => monthLabelByWeek.get(axisText(value)) ?? '',
        },
      },
      {
        orient: 'left',
        type: 'band',
        inverse: true,
        tick: { visible: false },
        domainLine: { visible: false },
        grid: { visible: false },
        label: { style: { fill: palette.text2, fontSize: 11 } },
      },
    ],
    tooltip: {
      ...makeCommonTooltip(palette),
      mark: {
        title: {
          value: (datum?: ChartDatum) => {
            const date = datumText(datum, 'date');
            return datumBoolean(datum, 'inRange') ? date : `${date}（范围外）`;
          },
        },
        content: [
          {
            key: valueLabel,
            value: (datum?: ChartDatum) => `${datumNumber(datum, 'count')} ${valueUnit}`,
          },
        ],
      },
    },
  };
}
