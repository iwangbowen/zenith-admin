import type {
  IAreaChartSpec,
  IBarChartSpec,
  ILineChartSpec,
  IPieChartSpec,
} from '@visactor/react-vchart';
import type { ChartPalette } from './palette';
import {
  axisNumber,
  axisText,
  compactCount,
  datumNumber,
  datumText,
  makeCommonCartesianSpec,
  makeCommonTooltip,
  seriesColors,
  wideToLong,
  type ChartDatum,
  type SeriesField,
} from './helpers';

interface AxisFormatters {
  /** x 轴标签格式化（band 轴） */
  readonly xLabel?: (value: string) => string;
  /** y 轴标签格式化（linear 轴） */
  readonly yLabel?: (value: number) => string;
}

interface TooltipConfig {
  /** tooltip 头部（维度标题），默认显示 x 值 */
  readonly title?: (x: string) => string;
  /** tooltip 数值格式化，默认 compactCount；第三参为完整数据项，便于读取其它字段 */
  readonly value?: (value: number, seriesName: string, datum: ChartDatum) => string;
}

function bandAxis(orient: 'bottom' | 'left', palette: ChartPalette, format?: (v: string) => string) {
  return {
    orient,
    type: 'band' as const,
    tick: { visible: false },
    domainLine: { visible: false },
    grid: { visible: false },
    label: {
      style: { fill: palette.text2, fontSize: 11 },
      autoLimit: true,
      ...(format ? { formatMethod: (value: string | string[]) => format(axisText(value)) } : {}),
    },
  };
}

function linearAxis(orient: 'bottom' | 'left', palette: ChartPalette, format?: (v: number) => string) {
  return {
    orient,
    type: 'linear' as const,
    tick: { visible: false },
    domainLine: { visible: false },
    grid: { visible: true, style: { stroke: palette.grid, lineDash: [3, 4], lineWidth: 1 } },
    label: {
      style: { fill: palette.text2, fontSize: 12 },
      formatMethod: (value: string | string[]) => (format ? format(axisNumber(value)) : compactCount(axisNumber(value))),
    },
  };
}

function legendSpec(palette: ChartPalette) {
  return {
    visible: true,
    orient: 'bottom' as const,
    position: 'middle' as const,
    item: { label: { style: { fill: palette.text1, fontSize: 12 } } },
  };
}

// ────────────────────────── 折线图 / 面积图 ──────────────────────────

export interface LineAreaOptions {
  /** 宽表数据（每行含 xField 与各系列字段） */
  readonly data: readonly unknown[];
  /** x 轴字段 */
  readonly xField: string;
  /** 一个或多个系列 */
  readonly series: readonly SeriesField[];
  readonly palette: ChartPalette;
  /** 是否堆叠（多系列） */
  readonly stack?: boolean;
  /** 平滑曲线，默认 true */
  readonly smooth?: boolean;
  /** 是否显示数据点，默认 false */
  readonly point?: boolean;
  /** 是否显示图例，默认在多系列时显示 */
  readonly legend?: boolean;
  /** 面积填充透明度（仅面积图） */
  readonly fillOpacity?: number;
  readonly axis?: AxisFormatters;
  readonly tooltip?: TooltipConfig;
}

function buildCartesianSeries(o: LineAreaOptions, area: boolean) {
  const { palette, series, xField, data } = o;
  const multi = series.length > 1;
  const smooth = o.smooth ?? true;
  const curveType = smooth ? ('monotone' as const) : ('linear' as const);
  const showLegend = o.legend ?? multi;
  const colors = seriesColors(series, palette);
  const first = series[0];
  const singleField = first?.field ?? '__value';
  const singleName = first?.name ?? '';

  const xField2 = multi ? '__x' : xField;
  const yField = multi ? '__value' : singleField;
  const values = multi ? wideToLong(data as readonly Record<string, unknown>[], xField, series) : [...(data as readonly Record<string, unknown>[])];

  const valueFmt = o.tooltip?.value ?? ((v: number) => compactCount(v));
  const titleFmt = o.tooltip?.title;

  const spec = {
    ...makeCommonCartesianSpec(palette),
    data: [{ id: 'series', values }],
    xField: xField2,
    yField,
    color: colors,
    ...(multi ? { seriesField: '__type', stack: o.stack ?? false } : {}),
    line: { style: { lineWidth: 2, curveType } },
    point: { visible: o.point ?? false, style: { size: 5 } },
    axes: [
      bandAxis('bottom', palette, o.axis?.xLabel),
      linearAxis('left', palette, o.axis?.yLabel),
    ],
    ...(showLegend ? { legends: legendSpec(palette) } : {}),
    tooltip: {
      ...makeCommonTooltip(palette),
      ...(multi
        ? {
            dimension: {
              title: { value: (datum?: ChartDatum) => (titleFmt ? titleFmt(datumText(datum, '__x')) : datumText(datum, '__x')) },
            },
            mark: {
              content: [
                {
                  key: (datum?: ChartDatum) => datumText(datum, '__type'),
                  value: (datum?: ChartDatum) => valueFmt(datumNumber(datum, '__value'), datumText(datum, '__type'), datum),
                },
              ],
            },
          }
        : {
            mark: {
              title: { value: (datum?: ChartDatum) => (titleFmt ? titleFmt(datumText(datum, xField)) : datumText(datum, xField)) },
              content: [
                {
                  key: singleName,
                  value: (datum?: ChartDatum) => valueFmt(datumNumber(datum, singleField), singleName, datum),
                },
              ],
            },
          }),
    },
  };

  if (area) {
    return {
      ...spec,
      area: { style: { fillOpacity: o.fillOpacity ?? 0.2, curveType } },
    };
  }
  return spec;
}

export function makeLineSpec(o: LineAreaOptions): Partial<ILineChartSpec> {
  return buildCartesianSeries(o, false) as Partial<ILineChartSpec>;
}

export function makeAreaSpec(o: LineAreaOptions): Partial<IAreaChartSpec> {
  return buildCartesianSeries(o, true) as Partial<IAreaChartSpec>;
}

// ────────────────────────── 柱状图 / 条形图 ──────────────────────────

export interface BarOptions {
  readonly data: readonly unknown[];
  readonly xField: string;
  readonly series: readonly SeriesField[];
  readonly palette: ChartPalette;
  /** 水平条形图（分类在 y 轴） */
  readonly horizontal?: boolean;
  /** 多系列堆叠 */
  readonly stack?: boolean;
  /** 单系列时按数据项着色（返回颜色） */
  readonly colorByDatum?: (datum: ChartDatum) => string;
  /** 柱最大宽度 */
  readonly barMaxWidth?: number;
  /** 圆角，默认按方向自动 */
  readonly cornerRadius?: number;
  /** 是否在柱末端显示数值标签 */
  readonly showLabel?: boolean;
  /** 分类轴（band）标签宽度（水平条形图左侧留白） */
  readonly categoryAxisWidth?: number;
  /** 是否显示图例，默认多系列显示 */
  readonly legend?: boolean;
  readonly axis?: AxisFormatters;
  readonly tooltip?: TooltipConfig;
}

export function makeBarSpec(o: BarOptions): Partial<IBarChartSpec> {
  const { palette, series, xField, data, horizontal } = o;
  const multi = series.length > 1;
  const showLegend = o.legend ?? multi;
  const colors = seriesColors(series, palette);

  const catField = multi ? '__x' : xField;
  const valField = multi ? '__value' : (series[0]?.field ?? '__value');
  const singleName = series[0]?.name ?? '';
  const values = multi ? wideToLong(data as readonly Record<string, unknown>[], xField, series) : [...(data as readonly Record<string, unknown>[])];

  const valueFmt = o.tooltip?.value ?? ((v: number) => compactCount(v));
  const titleFmt = o.tooltip?.title;

  const radius = o.cornerRadius ?? 4;
  const corner: [number, number, number, number] = horizontal
    ? [0, radius, radius, 0]
    : [radius, radius, 0, 0];

  const categoryAxis = bandAxis(horizontal ? 'left' : 'bottom', palette, o.axis?.xLabel);
  const valueAxis = linearAxis(horizontal ? 'bottom' : 'left', palette, o.axis?.yLabel);
  if (horizontal && o.categoryAxisWidth) {
    (categoryAxis as { width?: number }).width = o.categoryAxisWidth;
  }

  const barStyle: Record<string, unknown> = { cornerRadius: corner, fillOpacity: 0.92 };
  if (!multi && o.colorByDatum) {
    barStyle.fill = (datum: ChartDatum) => o.colorByDatum!(datum);
  }

  return {
    ...makeCommonCartesianSpec(palette),
    data: [{ id: 'bar', values }],
    ...(horizontal ? { direction: 'horizontal' as const } : {}),
    xField: horizontal ? valField : catField,
    yField: horizontal ? catField : valField,
    color: colors,
    ...(multi ? { seriesField: '__type', stack: o.stack ?? false } : {}),
    barMaxWidth: o.barMaxWidth ?? (horizontal ? 16 : 22),
    bar: { style: barStyle },
    ...(o.showLabel
      ? {
          label: {
            visible: true,
            position: horizontal ? ('right' as const) : ('top' as const),
            formatMethod: (_text: unknown, datum: ChartDatum) => compactCount(datumNumber(datum, valField)),
            style: { fill: palette.text2, fontSize: 11 },
          },
        }
      : {}),
    axes: [categoryAxis, valueAxis],
    ...(showLegend ? { legends: legendSpec(palette) } : {}),
    tooltip: {
      ...makeCommonTooltip(palette),
      ...(multi
        ? {
            dimension: {
              title: { value: (datum?: ChartDatum) => (titleFmt ? titleFmt(datumText(datum, '__x')) : datumText(datum, '__x')) },
            },
            mark: {
              content: [
                {
                  key: (datum?: ChartDatum) => datumText(datum, '__type'),
                  value: (datum?: ChartDatum) => valueFmt(datumNumber(datum, '__value'), datumText(datum, '__type'), datum),
                },
              ],
            },
          }
        : {
            mark: {
              title: { value: (datum?: ChartDatum) => (titleFmt ? titleFmt(datumText(datum, xField)) : datumText(datum, xField)) },
              content: [
                {
                  key: singleName,
                  value: (datum?: ChartDatum) => valueFmt(datumNumber(datum, valField), singleName, datum),
                },
              ],
            },
          }),
    },
  };
}

// ────────────────────────── 饼图 / 环形图 ──────────────────────────

export interface PieOptions {
  readonly data: readonly unknown[];
  readonly categoryField: string;
  readonly valueField: string;
  readonly palette: ChartPalette;
  /** 环形图（中空），默认 true */
  readonly donut?: boolean;
  /** 自定义配色（按分类顺序），缺省取调色板 */
  readonly colors?: readonly string[];
  /** 标签模式：'percent' 显示「名称 xx%」，'value' 显示数值，'none' 不显示，默认 percent */
  readonly label?: 'percent' | 'value' | 'none';
  /** 中心指标（环形图） */
  readonly indicator?: { readonly title: string; readonly subtitle?: string };
  /** tooltip 数值格式化 */
  readonly valueFormatter?: (value: number) => string;
  /** tooltip 中数值的单位后缀（与 valueFormatter 二选一） */
  readonly valueUnit?: string;
}

export function makePieSpec(o: PieOptions): Partial<IPieChartSpec> {
  const { palette, data, categoryField, valueField } = o;
  const donut = o.donut ?? true;
  const labelMode = o.label ?? 'percent';
  const colors = o.colors ? [...o.colors] : palette.dataColors;
  const total = data.reduce<number>((sum, item) => {
    const v = (item as Record<string, unknown>)[valueField];
    return sum + (typeof v === 'number' ? v : Number(v) || 0);
  }, 0);

  const valueFmt = o.valueFormatter ?? ((v: number) => `${compactCount(v)}${o.valueUnit ? ` ${o.valueUnit}` : ''}`);

  const spec: Record<string, unknown> = {
    type: 'pie',
    background: 'transparent',
    animation: true,
    data: [{ id: 'pie', values: [...(data as readonly Record<string, unknown>[])] }],
    categoryField,
    valueField,
    color: colors,
    outerRadius: 0.82,
    innerRadius: donut ? 0.55 : 0,
    padAngle: donut ? 1.2 : 0,
    cornerRadius: donut ? 4 : 0,
    legends: { visible: true, orient: 'bottom', position: 'middle', item: { label: { style: { fill: palette.text1, fontSize: 12 } } } },
    label: {
      visible: labelMode !== 'none',
      position: 'outside',
      line: { visible: true },
      style: { fill: palette.text1, fontSize: 11 },
      formatMethod: (_text: unknown, datum: ChartDatum) => {
        const value = datumNumber(datum, valueField);
        const name = datumText(datum, categoryField);
        if (labelMode === 'value') return value > 0 ? compactCount(value) : '';
        if (total <= 0 || value / total < 0.05) return '';
        return `${name} ${Math.round((value / total) * 100)}%`;
      },
    },
    tooltip: {
      ...makeCommonTooltip(palette),
      mark: {
        title: { value: (datum?: ChartDatum) => datumText(datum, categoryField) },
        content: [{ key: '数值', value: (datum?: ChartDatum) => valueFmt(datumNumber(datum, valueField)) }],
      },
    },
  };

  if (donut && o.indicator) {
    spec.indicator = {
      visible: true,
      title: { visible: true, autoLimit: true, style: { text: o.indicator.title, fill: palette.text0, fontSize: 26, fontWeight: 700 } },
      content: o.indicator.subtitle
        ? [{ visible: true, style: { text: o.indicator.subtitle, fill: palette.text2, fontSize: 12 } }]
        : [],
    };
  }

  return spec as Partial<IPieChartSpec>;
}
