import type {
  IAreaChartSpec,
  IBarChartSpec,
  ICircularProgressChartSpec,
  ICommonChartSpec,
  IFunnelChartSpec,
  IHeatmapChartSpec,
  ILineChartSpec,
  IPieChartSpec,
  IRadarChartSpec,
  ISankeyChartSpec,
  IScatterChartSpec,
  ITreemapChartSpec,
} from '@visactor/react-vchart';
import type { ChartPalette } from './palette';
import type { SankeyNodeDatum } from '@visactor/vchart';
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

function linearAxis(orient: 'bottom' | 'left' | 'right', palette: ChartPalette, format?: (v: number) => string) {
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

function firstDatum(datum?: ChartDatum | ChartDatum[]): ChartDatum {
  return Array.isArray(datum) ? datum[0] : datum;
}

function legendSpec(palette: ChartPalette) {
  return {
    visible: true,
    orient: 'bottom' as const,
    position: 'middle' as const,
    item: { label: { style: { fill: palette.text1, fontSize: 12 } } },
  };
}

interface CartesianTooltipOptions {
  readonly palette: ChartPalette;
  readonly multi: boolean;
  readonly xField: string;
  readonly singleName: string;
  /** 单系列时的取值字段 */
  readonly singleField: string;
  readonly valueFmt: (value: number, seriesName: string, datum: ChartDatum) => string;
  readonly titleFmt?: (x: string) => string;
}

/** 饼图 / 漏斗 / 词云等「类目 → 单值」图共用的 tooltip spec：标题取类目字段，内容一行数值 */
function categoryTooltipSpec(o: {
  readonly palette: ChartPalette;
  readonly categoryField: string;
  readonly valueField: string;
  readonly valueFmt: (value: number) => string;
  readonly tooltipKey?: string;
}) {
  return {
    ...makeCommonTooltip(o.palette),
    mark: {
      title: { value: (datum?: ChartDatum) => datumText(datum, o.categoryField) },
      content: [{ key: o.tooltipKey ?? '数值', value: (datum?: ChartDatum) => o.valueFmt(datumNumber(datum, o.valueField)) }],
    },
  };
}
/** 折线/面积/柱状图共用的 tooltip spec（多系列 dimension + 单系列 mark） */
function cartesianTooltipSpec({ palette, multi, xField, singleName, singleField, valueFmt, titleFmt }: CartesianTooltipOptions) {
  return {
    ...makeCommonTooltip(palette),
    ...(multi
      ? {
          dimension: {
            title: {
              value: (datum?: ChartDatum | ChartDatum[]) => {
                const xValue = datumText(firstDatum(datum), '__x');
                return titleFmt ? titleFmt(xValue) : xValue;
              },
            },
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
  /** 数据点大小 */
  readonly pointSize?: number;
  /** 是否显示图例，默认在多系列时显示 */
  readonly legend?: boolean;
  /** 面积填充透明度（仅面积图） */
  readonly fillOpacity?: number | ((datum: ChartDatum) => number);
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
    point: { visible: o.point ?? false, style: { size: o.pointSize ?? 5 } },
    axes: [
      bandAxis('bottom', palette, o.axis?.xLabel),
      linearAxis('left', palette, o.axis?.yLabel),
    ],
    ...(showLegend ? { legends: legendSpec(palette) } : {}),
    tooltip: cartesianTooltipSpec({ palette, multi, xField, singleName, singleField, valueFmt, titleFmt }),
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
  /** 柱最小高度，适合水平 Top 榜避免极小值不可见 */
  readonly barMinHeight?: number;
  /** 圆角，默认按方向自动 */
  readonly cornerRadius?: number;
  /** 是否在柱末端显示数值标签 */
  readonly showLabel?: boolean;
  /** 数值标签颜色，默认使用次级文本色 */
  readonly labelColor?: string;
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
    ...(o.barMinHeight == null ? {} : { barMinHeight: o.barMinHeight }),
    bar: { style: barStyle },
    ...(o.showLabel
      ? {
          label: {
            visible: true,
            position: horizontal ? ('right' as const) : ('top' as const),
            formatMethod: (_text: unknown, datum: ChartDatum) => compactCount(datumNumber(datum, valField)),
            style: { fill: o.labelColor ?? palette.text2, fontSize: 11 },
          },
        }
      : {}),
    axes: [categoryAxis, valueAxis],
    ...(showLegend ? { legends: legendSpec(palette) } : {}),
    tooltip: cartesianTooltipSpec({ palette, multi, xField, singleName, singleField: valField, valueFmt, titleFmt }),
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
  readonly outerRadius?: number;
  readonly innerRadius?: number;
  readonly padAngle?: number;
  readonly cornerRadius?: number;
  readonly legend?: boolean;
  readonly legendLabelFontSize?: number;
  /** 标签模式：'percent' 显示「名称 xx%」，'value' 显示数值，'none' 不显示，默认 percent */
  readonly label?: 'percent' | 'value' | 'none';
  readonly labelPosition?: 'inside' | 'outside';
  readonly labelColor?: string;
  readonly labelFontSize?: number;
  readonly labelLine?: boolean;
  /** 中心指标（环形图） */
  readonly indicator?: { readonly title: string; readonly subtitle?: string };
  readonly indicatorTitleFontSize?: number;
  /** tooltip 指标名，默认「数值」 */
  readonly tooltipKey?: string;
  /** tooltip 数值格式化 */
  readonly valueFormatter?: (value: number) => string;
  /** tooltip 中数值的单位后缀（与 valueFormatter 二选一） */
  readonly valueUnit?: string;
}

export function makePieSpec(o: PieOptions): Partial<IPieChartSpec> {
  const { palette, data, categoryField, valueField } = o;
  const donut = o.donut ?? true;
  const labelMode = o.label ?? 'percent';
  const labelPosition = o.labelPosition ?? 'outside';
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
    outerRadius: o.outerRadius ?? 0.82,
    innerRadius: o.innerRadius ?? (donut ? 0.55 : 0),
    padAngle: o.padAngle ?? (donut ? 1.2 : 0),
    cornerRadius: o.cornerRadius ?? (donut ? 4 : 0),
    ...(o.legend === false
      ? {}
      : { legends: { visible: true, orient: 'bottom', position: 'middle', item: { label: { style: { fill: palette.text1, fontSize: o.legendLabelFontSize ?? 12 } } } } }),
    label: {
      visible: labelMode !== 'none',
      position: labelPosition,
      line: { visible: o.labelLine ?? labelPosition === 'outside' },
      style: { fill: o.labelColor ?? palette.text1, fontSize: o.labelFontSize ?? 11, fontWeight: labelPosition === 'inside' ? 600 : 400 },
      formatMethod: (_text: unknown, datum: ChartDatum) => {
        const value = datumNumber(datum, valueField);
        const name = datumText(datum, categoryField);
        if (labelMode === 'value') return value > 0 ? compactCount(value) : '';
        if (total <= 0 || value / total < 0.05) return '';
        return `${name} ${Math.round((value / total) * 100)}%`;
      },
    },
    tooltip: categoryTooltipSpec({ palette, categoryField, valueField, valueFmt, tooltipKey: o.tooltipKey }),

  };

  if (donut && o.indicator) {
    spec.indicator = {
      visible: true,
      title: { visible: true, autoLimit: true, style: { text: o.indicator.title, fill: palette.text0, fontSize: o.indicatorTitleFontSize ?? 26, fontWeight: 700 } },
      content: o.indicator.subtitle
        ? [{ visible: true, style: { text: o.indicator.subtitle, fill: palette.text2, fontSize: 12 } }]
        : [],
    };
  }

  return spec as Partial<IPieChartSpec>;
}

// ────────────────────────── 矩形树图 ──────────────────────────

export interface TreemapNode {
  readonly name: string;
  readonly value?: number;
  readonly children?: TreemapNode[];
  readonly [key: string]: unknown;
}

export interface TreemapOptions {
  readonly data: TreemapNode | readonly TreemapNode[];
  readonly palette: ChartPalette;
  readonly categoryField?: string;
  readonly valueField?: string;
  readonly colors?: readonly string[];
  readonly drill?: boolean;
  readonly minVisibleArea?: number;
  readonly minChildrenVisibleArea?: number;
  readonly labelFontSize?: number;
  readonly valueFormatter?: (value: number) => string;
  readonly tooltipItems?: { key: string; value: (datum: ChartDatum) => string }[];
}

function treemapPath(datum: ChartDatum): string {
  const path = datum?.datum;
  if (!Array.isArray(path)) return datumText(datum, 'name');
  return path
    .map((item) => (typeof item?.name === 'string' || typeof item?.name === 'number' ? String(item.name) : ''))
    .filter(Boolean)
    .join(' / ');
}

function isTreemapNodeArray(data: TreemapOptions['data']): data is readonly TreemapNode[] {
  return Array.isArray(data);
}

export function makeTreemapSpec(o: TreemapOptions): Partial<ITreemapChartSpec> {
  const categoryField = o.categoryField ?? 'name';
  const valueField = o.valueField ?? 'value';
  const valueFmt = o.valueFormatter ?? ((value: number) => compactCount(value));
  const values = isTreemapNodeArray(o.data) ? [...o.data] : [...(o.data.children ?? [])];
  const tooltipItems = o.tooltipItems ?? [
    {
      key: '使用次数',
      value: (datum?: ChartDatum) => valueFmt(datumNumber(datum, valueField)),
    },
  ];

  return {
    type: 'treemap',
    background: 'transparent',
    animation: true,
    data: { id: 'treemap', values } as ITreemapChartSpec['data'],
    categoryField,
    valueField,
    color: o.colors ? [...o.colors] : o.palette.dataColors,
    drill: o.drill ?? true,
    gapWidth: 2,
    nodePadding: 2,
    minVisibleArea: o.minVisibleArea ?? 8,
    minChildrenVisibleArea: o.minChildrenVisibleArea ?? 36,
    leaf: {
      style: {
        fillOpacity: 0.9,
        stroke: o.palette.bg1,
        lineWidth: 1,
      },
    },
    nonLeaf: {
      visible: true,
      style: {
        fillOpacity: 0.1,
        stroke: o.palette.border,
        lineWidth: 1,
      },
    },
    label: {
      visible: true,
      style: {
        fill: '#ffffff',
        fontSize: o.labelFontSize ?? 12,
        fontWeight: 600,
      },
    },
    nonLeafLabel: {
      visible: true,
      position: 'top',
      padding: 22,
      style: {
        fill: o.palette.text1,
        fontSize: 12,
        fontWeight: 600,
        textAlign: 'left',
        x: (datum: ChartDatum) => {
          const rect = datum?.labelRect as { x0?: number } | undefined;
          return (rect?.x0 ?? 0) + 4;
        },
      },
    },
    tooltip: {
      ...makeCommonTooltip(o.palette),
      mark: {
        title: { value: (datum?: ChartDatum) => treemapPath(datum) },
        content: tooltipItems,
      },
    },
  };
}

// ────────────────────────── 桑基图 / 流向图 ──────────────────────────

export interface SankeyNodeInput {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly [key: string]: unknown;
}

export interface SankeyLinkInput {
  readonly source: string;
  readonly target: string;
  readonly value: number;
  readonly [key: string]: unknown;
}

export interface SankeyOptions {
  readonly nodes: readonly SankeyNodeInput[];
  readonly links: readonly SankeyLinkInput[];
  readonly palette: ChartPalette;
  readonly colors?: readonly string[];
  /** 节点色：按节点数据返回颜色，未提供时按 colors 轮转 */
  readonly nodeColor?: (node: SankeyNodeInput, index: number) => string;
  readonly nodeGap?: number;
  readonly nodeWidth?: number;
  /** 强制节点所在层级（0 起）。图里有终点节点时必须指定，否则布局会把无出边的节点推到最右列 */
  readonly nodeLayer?: (node: SankeyNodeInput) => number;
  readonly labelLimit?: number;
  readonly nodeLabel?: (node: SankeyNodeInput) => string;
  readonly valueFormatter?: (value: number) => string;
  readonly tooltip?: {
    readonly nodeTitle?: (datum: ChartDatum) => string;
    readonly nodeItems?: readonly { key: string; value: (datum: ChartDatum) => string }[];
    readonly linkTitle?: (datum: ChartDatum) => string;
    readonly linkItems?: readonly { key: string; value: (datum: ChartDatum) => string }[];
  };
}

/**
 * 桑基图 spec。
 *
 * 传入的 links 必须是**无环**的（source/target 组成 DAG）——桑基布局无法表达回边，
 * 存在环时布局会失败或渲染错乱。互相跳转的场景需先把节点身份拆成「层级 × 实体」。
 */
export function makeSankeySpec(o: SankeyOptions): Partial<ISankeyChartSpec> {
  const valueFmt = o.valueFormatter ?? ((value: number) => compactCount(value));
  const colors = o.colors ?? o.palette.dataColors;
  const colorOf = (node: SankeyNodeInput, index: number) =>
    o.nodeColor ? o.nodeColor(node, index) : colors[index % colors.length];
  // VChart 按 nodeKey 关联 link 的 source/target，因此节点值里保留 id 作为 key
  const nodes = o.nodes.map((node, index) => ({ ...node, name: node.label, fill: colorOf(node, index) }));
  const colorById = new Map(nodes.map((node) => [node.id, node.fill]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  /**
   * label / tooltip 回调收到的是**布局元素**（SankeyNodeElement / SankeyLinkElement），
   * 只有 key / source / target / value 这些布局字段，业务字段在 element.datum 上。
   * 直接读 `datum.step` / `datum.label` 会得到 undefined，因此统一在这里摊平。
   */
  const flatten = (datum?: ChartDatum): ChartDatum => {
    if (!datum) return {};
    const raw = (datum as { datum?: unknown }).datum;
    const base = Array.isArray(raw) ? raw[0] : raw;
    const merged: ChartDatum = base && typeof base === 'object' ? { ...(base as ChartDatum), ...datum } : { ...datum };
    // 节点元素的 key 即 nodeKey('id')，据此补回原始节点上的业务字段
    const key = merged.key ?? merged.id;
    const node = typeof key === 'string' ? nodeById.get(key) : undefined;
    return node ? { ...node, ...merged } : merged;
  };

  const linkColor = (datum: ChartDatum) => colorById.get(datumText(datum, 'source')) ?? o.palette.primary;
  const wrapItems = (
    items: readonly { key: string; value: (datum: ChartDatum) => string }[],
    forLink: boolean,
  ) => items.map((item) => ({
    key: item.key,
    value: (datum?: ChartDatum) => item.value(flatten(datum)),
    visible: (datum?: ChartDatum) => isSankeyLink(datum) === forLink,
  }));
  const defaultItems = [{ key: '流量', value: (datum: ChartDatum) => valueFmt(datumNumber(datum, 'value')) }];

  const spec: Partial<ISankeyChartSpec> = {
    type: 'sankey',
    background: 'transparent',
    animation: true,
    data: [{ id: 'sankey', values: [{ nodes, links: [...o.links] }] }] as ISankeyChartSpec['data'],
    categoryField: 'id',
    valueField: 'value',
    sourceField: 'source',
    targetField: 'target',
    nodeKey: 'id',
    nodeAlign: 'justify',
    ...(o.nodeLayer ? { setNodeLayer: (datum: SankeyNodeDatum) => o.nodeLayer!(flatten(datum as ChartDatum) as unknown as SankeyNodeInput) } : {}),
    nodeGap: o.nodeGap ?? 8,
    nodeWidth: o.nodeWidth ?? 12,
    minLinkHeight: 1,
    dropIsolatedNode: false,
    node: { style: { fill: (datum: ChartDatum) => datumText(flatten(datum), 'fill') || o.palette.primary } },
    link: { style: { fill: linkColor, fillOpacity: 0.28 } },
    label: {
      visible: true,
      limit: o.labelLimit ?? 140,
      style: {
        fill: o.palette.text1,
        fontSize: 11,
        text: (datum: ChartDatum) => {
          const node = flatten(datum);
          return o.nodeLabel ? o.nodeLabel(node as unknown as SankeyNodeInput) : datumText(node, 'name');
        },
      },
    },
    emphasis: { enable: true, trigger: 'hover', effect: 'adjacency' },
    tooltip: {
      ...makeCommonTooltip(o.palette),
      // 桑基的 tooltip 只有一个 mark 通道，节点与链路共用；靠 datum 上有没有 target 区分，
      // 每行再用 visible 谓词挑出属于自己的那一组
      mark: {
        title: {
          value: (datum?: ChartDatum) => {
            const flat = flatten(datum);
            return isSankeyLink(datum)
              ? o.tooltip?.linkTitle?.(flat) ?? sankeyLinkFallbackTitle(flat)
              : o.tooltip?.nodeTitle?.(flat) ?? datumText(flat, 'name');
          },
        },
        content: [
          ...wrapItems(o.tooltip?.nodeItems ?? defaultItems, false),
          ...wrapItems(o.tooltip?.linkItems ?? defaultItems, true),
        ],
      },
    },
  };
  return spec;
}

function isSankeyLink(datum?: ChartDatum): boolean {
  return !!datumText(datum, 'source') && !!datumText(datum, 'target');
}

function sankeyLinkFallbackTitle(datum?: ChartDatum): string {
  return `${datumText(datum, 'source')} → ${datumText(datum, 'target')}`;
}

// ────────────────────────── 组合图：柱 + 线 + 双 Y 轴 ──────────────────────────

interface MixedSeriesOptions {
  readonly id?: string;
  readonly field: string;
  readonly name: string;
  readonly color?: string;
  /** 该系列在 tooltip 中的数值格式，缺省回退到 `tooltip.barValue` / `tooltip.lineValue` */
  readonly format?: (value: number, datum: ChartDatum) => string;
}

interface MixedBarOptions extends MixedSeriesOptions {
  readonly fillOpacity?: number;
  readonly cornerRadius?: [number, number, number, number];
}

interface MixedLineOptions extends MixedSeriesOptions {
  readonly smooth?: boolean;
  readonly lineWidth?: number;
  readonly pointSize?: number;
  readonly showPoint?: boolean;
}

interface MixedBarLineTooltip {
  readonly titleField?: string;
  readonly title?: (value: string, datum: ChartDatum) => string;
  readonly barValue?: (value: number, datum: ChartDatum) => string;
  readonly lineValue?: (value: number, datum: ChartDatum) => string;
}

interface MixedBarLineAxis {
  readonly xLabel?: (value: string) => string;
  readonly leftLabel?: (value: number) => string;
  readonly rightLabel?: (value: number) => string;
}

export interface MixedBarLineOptions {
  readonly data: readonly unknown[];
  readonly xField: string;
  readonly palette: ChartPalette;
  readonly dataId?: string;
  readonly bar: MixedBarOptions;
  /** 与 `bar` 堆叠在同一根柱上的额外柱系列（共用左轴） */
  readonly stackedBars?: readonly MixedBarOptions[];
  readonly line: MixedLineOptions;
  /** 额外的折线系列（共用右轴） */
  readonly extraLines?: readonly MixedLineOptions[];
  readonly legend?: boolean;
  readonly axis?: MixedBarLineAxis;
  readonly tooltip?: MixedBarLineTooltip;
}

export function makeMixedBarLineSpec(o: MixedBarLineOptions): Partial<ICommonChartSpec> {
  const { palette } = o;
  const bars = [o.bar, ...(o.stackedBars ?? [])];
  const lines = [o.line, ...(o.extraLines ?? [])];
  const stacked = bars.length > 1;
  const idOf = (s: MixedSeriesOptions) => s.id ?? s.field;
  const barColorOf = (s: MixedBarOptions, i: number) => s.color ?? palette.dataColors[i] ?? palette.primary;
  const lineColorOf = (s: MixedLineOptions, i: number) => s.color ?? palette.dataColors[2 + i] ?? palette.active;
  const titleField = o.tooltip?.titleField ?? o.xField;
  const barValueFmt = o.tooltip?.barValue ?? ((value: number) => compactCount(value));
  const lineValueFmt = o.tooltip?.lineValue ?? ((value: number) => compactCount(value));
  const wideData = [...(o.data as readonly Record<string, unknown>[])];
  const dataId = o.dataId ?? 'mixed';
  const stackedBarId = `${idOf(o.bar)}-stack`;

  const leftAxis = {
    ...linearAxis('left', palette, o.axis?.leftLabel),
    seriesId: stacked ? [stackedBarId] : [idOf(o.bar)],
  };
  const rightAxis = {
    ...linearAxis('right', palette, o.axis?.rightLabel),
    seriesId: lines.map(idOf),
    grid: { visible: false },
  };

  // 堆叠：与 makeBarSpec 同一套做法——长表 + seriesField，由单个柱系列承载全部堆叠段，
  // 而不是多个柱系列各自 stack（common 图表下多系列 stack 不会参与轴域计算，柱高为 0）
  const barSeries = stacked
    ? [{
        type: 'bar' as const,
        id: stackedBarId,
        dataId: `${dataId}-bars`,
        xField: '__x',
        yField: '__value',
        seriesField: '__type',
        stack: true,
        bar: {
          style: {
            fill: (datum: ChartDatum) => {
              const index = bars.findIndex((b) => b.name === datumText(datum, '__type'));
              return barColorOf(bars[Math.max(index, 0)], Math.max(index, 0));
            },
            fillOpacity: o.bar.fillOpacity ?? 0.92,
          },
        },
      }]
    : [{
        type: 'bar' as const,
        id: idOf(o.bar),
        dataId,
        xField: o.xField,
        yField: o.bar.field,
        name: o.bar.name,
        bar: {
          style: {
            fill: barColorOf(o.bar, 0),
            cornerRadius: o.bar.cornerRadius ?? [4, 4, 0, 0],
            fillOpacity: o.bar.fillOpacity ?? 0.92,
          },
        },
      }];

  return {
    ...makeCommonCartesianSpec(palette),
    data: [
      { id: dataId, values: wideData },
      ...(stacked
        ? [{ id: `${dataId}-bars`, values: wideToLong(wideData, o.xField, bars.map((b) => ({ field: b.field, name: b.name }))) }]
        : []),
    ],
    series: [
      ...barSeries,
      ...lines.map((line, i) => {
        const color = lineColorOf(line, i);
        return {
          type: 'line' as const,
          id: idOf(line),
          dataId,
          xField: o.xField,
          yField: line.field,
          name: line.name,
          line: {
            style: {
              stroke: color,
              lineWidth: line.lineWidth ?? 2,
              curveType: line.smooth ?? true ? ('monotone' as const) : ('linear' as const),
            },
          },
          point: {
            visible: line.showPoint ?? true,
            style: { fill: color, size: line.pointSize ?? 5 },
          },
        };
      }),
    ],
    axes: [
      bandAxis('bottom', palette, o.axis?.xLabel),
      leftAxis,
      rightAxis,
    ],
    ...(o.legend === false ? {} : { legends: legendSpec(palette) }),
    tooltip: {
      ...makeCommonTooltip(palette),
      dimension: {
        title: {
          value: (datum?: ChartDatum | ChartDatum[]) => {
            const item = firstDatum(datum);
            const titleValue = datumText(item, titleField);
            return o.tooltip?.title ? o.tooltip.title(titleValue, item) : titleValue;
          },
        },
        content: [
          ...bars.map((bar) => ({
            key: bar.name,
            value: (datum?: ChartDatum | ChartDatum[]) => {
              const item = firstDatum(datum);
              return (bar.format ?? barValueFmt)(datumNumber(item, bar.field), item);
            },
          })),
          ...lines.map((line) => ({
            key: line.name,
            value: (datum?: ChartDatum | ChartDatum[]) => {
              const item = firstDatum(datum);
              return (line.format ?? lineValueFmt)(datumNumber(item, line.field), item);
            },
          })),
        ],
      },
    },
  } as Partial<ICommonChartSpec>;
}

// ────────────────────────── 散点图 / 热区散点 ──────────────────────────

interface ScatterAxisOptions {
  readonly min?: number;
  readonly max?: number;
  readonly inverse?: boolean;
  readonly label?: (value: number) => string;
}

interface ScatterTooltipItem {
  readonly key: string;
  readonly value: (datum: ChartDatum) => string;
}

interface ScatterTooltipOptions {
  readonly title?: (datum: ChartDatum) => string;
  readonly items?: readonly ScatterTooltipItem[];
}

interface ScatterPointOptions {
  readonly size?: number | ((datum: ChartDatum) => number);
  readonly fill?: string | ((datum: ChartDatum) => string);
  readonly fillOpacity?: number;
  readonly stroke?: string | ((datum: ChartDatum) => string);
  readonly lineWidth?: number | ((datum: ChartDatum) => number);
}

export interface ScatterOptions {
  readonly data: readonly unknown[];
  readonly xField: string;
  readonly yField: string;
  readonly palette: ChartPalette;
  readonly dataId?: string;
  readonly padding?: { readonly top?: number; readonly right?: number; readonly bottom?: number; readonly left?: number };
  readonly xAxis?: ScatterAxisOptions;
  readonly yAxis?: ScatterAxisOptions;
  readonly point?: ScatterPointOptions;
  readonly tooltip?: ScatterTooltipOptions;
}

function scatterLinearAxis(
  orient: 'bottom' | 'left',
  palette: ChartPalette,
  options?: ScatterAxisOptions,
) {
  return {
    ...linearAxis(orient, palette, options?.label),
    ...(options?.min == null ? {} : { min: options.min }),
    ...(options?.max == null ? {} : { max: options.max }),
    ...(options?.inverse == null ? {} : { inverse: options.inverse }),
  };
}

export function makeScatterSpec(o: ScatterOptions): Partial<IScatterChartSpec> {
  const point = o.point ?? {};

  return {
    ...makeCommonCartesianSpec(o.palette),
    ...(o.padding ? { padding: o.padding } : {}),
    data: [{ id: o.dataId ?? 'scatter', values: [...(o.data as readonly Record<string, unknown>[])] }],
    xField: o.xField,
    yField: o.yField,
    point: {
      style: {
        ...(point.size == null ? {} : { size: point.size }),
        ...(point.fill == null ? {} : { fill: point.fill }),
        ...(point.fillOpacity == null ? {} : { fillOpacity: point.fillOpacity }),
        ...(point.stroke == null ? {} : { stroke: point.stroke }),
        ...(point.lineWidth == null ? {} : { lineWidth: point.lineWidth }),
      },
    },
    axes: [
      scatterLinearAxis('bottom', o.palette, o.xAxis),
      scatterLinearAxis('left', o.palette, o.yAxis),
    ],
    tooltip: {
      ...makeCommonTooltip(o.palette),
      mark: {
        ...(o.tooltip?.title ? { title: { value: (datum?: ChartDatum) => o.tooltip!.title!(datum) } } : {}),
        ...(o.tooltip?.items
          ? {
              content: o.tooltip.items.map((item) => ({
                key: item.key,
                value: (datum?: ChartDatum) => item.value(datum),
              })),
            }
          : {}),
      },
    },
  };
}

// ────────────────────────── 仪表盘（半环进度） ──────────────────────────

/** 仪表盘内部字段名：数据由本模块合成，用固定字段避免与业务字段撞名 */
const GAUGE_CATEGORY_FIELD = '__gaugeCategory';
const GAUGE_VALUE_FIELD = '__gaugeValue';

export interface GaugeOptions {
  readonly value: number;
  readonly palette: ChartPalette;
  /** 量程下界，默认 0 */
  readonly min?: number;
  /** 量程上界，默认 100；不大于 min 时回退为 min + 100 */
  readonly max?: number;
  /** 进度色，缺省取主题主色 */
  readonly color?: string;
  /** 轨道色，缺省取 fill1 */
  readonly trackColor?: string;
  readonly outerRadius?: number;
  readonly innerRadius?: number;
  /** 中心指标：主标题通常是格式化后的数值 */
  readonly indicator?: { readonly title: string; readonly subtitle?: string };
  readonly indicatorTitleFontSize?: number;
  /** tooltip 指标名，默认「数值」 */
  readonly tooltipKey?: string;
  /** tooltip 数值格式化，收到的是原始值而非比例 */
  readonly valueFormatter?: (value: number) => string;
}

/**
 * 半环仪表盘。
 *
 * VChart 极坐标 -90° 指向 12 点、顺时针递增，因此 -180°→0° 正好是「左 → 上 → 右」的上半环。
 * 底层用 `circularProgress`：语义就是「单值占量程的比例」，比 `gauge` 少了指针与刻度轴，
 * 在报表小尺寸卡片里更清晰，也与既有看板的视觉保持一致。
 */
export function makeGaugeSpec(o: GaugeOptions): Partial<ICircularProgressChartSpec> {
  const { palette } = o;
  const min = o.min ?? 0;
  const rawMax = o.max ?? 100;
  const max = rawMax > min ? rawMax : min + 100;
  // 必须夹紧：越界值会画出超过半环的弧盖住轨道，负值则反向绘制
  const ratio = Math.min(1, Math.max(0, (o.value - min) / (max - min)));
  const color = o.color ?? palette.primary;
  const valueFmt = o.valueFormatter ?? compactCount;

  const spec = {
    type: 'circularProgress',
    background: 'transparent',
    animation: true,
    data: [{ id: 'gauge', values: [{ [GAUGE_CATEGORY_FIELD]: 'value', [GAUGE_VALUE_FIELD]: ratio }] }],
    categoryField: GAUGE_CATEGORY_FIELD,
    valueField: GAUGE_VALUE_FIELD,
    seriesField: GAUGE_CATEGORY_FIELD,
    outerRadius: o.outerRadius ?? 0.86,
    innerRadius: o.innerRadius ?? 0.68,
    startAngle: -180,
    endAngle: 0,
    roundCap: true,
    clamp: true,
    color: [color],
    progress: { style: { fill: color } },
    track: { style: { fill: o.trackColor ?? palette.fill1 } },
    axes: [
      { orient: 'angle', visible: false },
      { orient: 'radius', visible: false },
    ],
    tooltip: {
      ...makeCommonTooltip(palette),
      mark: {
        title: { visible: false },
        content: [{ key: o.tooltipKey ?? '数值', value: () => valueFmt(o.value) }],
      },
    },
    ...(o.indicator
      ? {
          indicator: {
            visible: true,
            // 半环的视觉重心在上半部，指标上移才不会压住弧线底边
            offsetY: '-8%',
            title: {
              visible: true,
              autoLimit: true,
              style: { text: o.indicator.title, fill: palette.text0, fontSize: o.indicatorTitleFontSize ?? 24, fontWeight: 700 },
            },
            content: o.indicator.subtitle
              ? [{ visible: true, style: { text: o.indicator.subtitle, fill: palette.text2, fontSize: 12 } }]
              : [],
          },
        }
      : {}),
  } satisfies Partial<ICircularProgressChartSpec>;

  return spec;
}

// ────────────────────────── 漏斗图 ──────────────────────────

export interface FunnelOptions {
  readonly data: readonly unknown[];
  readonly categoryField: string;
  readonly valueField: string;
  readonly palette: ChartPalette;
  /** 自定义配色（按层顺序），缺省取调色板 */
  readonly colors?: readonly string[];
  /** 层形状：梯形（默认）或矩形 */
  readonly shape?: 'trapezoid' | 'rect';
  /** 显示层间转化率，默认 true */
  readonly transform?: boolean;
  readonly legend?: boolean;
  /** tooltip / 标签数值格式化 */
  readonly valueFormatter?: (value: number) => string;
  /** tooltip 指标名，默认「数值」 */
  readonly tooltipKey?: string;
}

/** 漏斗图：层内显示数值，层外右侧显示阶段名，层间可显示转化率。 */
export function makeFunnelSpec(o: FunnelOptions): Partial<IFunnelChartSpec> {
  const { palette, categoryField, valueField } = o;
  const colors = o.colors ? [...o.colors] : palette.dataColors;
  const valueFmt = o.valueFormatter ?? compactCount;
  const transform = o.transform ?? true;

  return {
    type: 'funnel',
    background: 'transparent',
    animation: true,
    data: [{ id: 'funnel', values: [...(o.data as readonly Record<string, unknown>[])] }],
    categoryField,
    valueField,
    shape: o.shape ?? 'trapezoid',
    isTransform: transform,
    gap: 4,
    maxSize: '85%',
    minSize: '25%',
    color: colors,
    label: {
      visible: true,
      style: { fill: '#fff', fontSize: 12, fontWeight: 600 },
      formatMethod: (_text: unknown, datum?: ChartDatum) => valueFmt(datumNumber(datum, valueField)),
    },
    outerLabel: {
      visible: true,
      position: 'right',
      style: { fill: palette.text1, fontSize: 12 },
      formatMethod: (_text: unknown, datum?: ChartDatum) => datumText(datum, categoryField),
      line: { style: { stroke: palette.border } },
    },
    transformLabel: {
      visible: transform,
      style: { fill: palette.text2, fontSize: 11 },
    },
    legends: o.legend
      ? { visible: true, orient: 'bottom', position: 'middle', item: { label: { style: { fill: palette.text1, fontSize: 12 } } } }
      : { visible: false },
    tooltip: categoryTooltipSpec({ palette, categoryField, valueField, valueFmt, tooltipKey: o.tooltipKey }),

  };
}

// ────────────────────────── 雷达图 ──────────────────────────

export interface RadarOptions {
  readonly data: readonly unknown[];
  /** 维度字段（角度轴） */
  readonly categoryField: string;
  /** 指标字段（半径轴） */
  readonly valueField: string;
  readonly palette: ChartPalette;
  /** 多系列字段；省略则为单系列 */
  readonly seriesField?: string;
  readonly colors?: readonly string[];
  readonly outerRadius?: number;
  /** 填充面积，默认 true */
  readonly area?: boolean;
  /** 图例，默认仅多系列时显示 */
  readonly legend?: boolean;
  /** 半径轴上界，缺省由数据自适应 */
  readonly max?: number;
  /** tooltip 数值格式化 */
  readonly valueFormatter?: (value: number) => string;
  /** tooltip 指标名，默认「数值」 */
  readonly tooltipKey?: string;
}

/** 雷达图：支持单系列与多系列（seriesField），网格与标签跟随主题。 */
export function makeRadarSpec(o: RadarOptions): Partial<IRadarChartSpec> {
  const { palette, categoryField, valueField } = o;
  const colors = o.colors ? [...o.colors] : palette.dataColors;
  const valueFmt = o.valueFormatter ?? compactCount;
  const showLegend = o.legend ?? Boolean(o.seriesField);

  return {
    type: 'radar',
    background: 'transparent',
    animation: true,
    data: [{ id: 'radar', values: [...(o.data as readonly Record<string, unknown>[])] }],
    categoryField,
    valueField,
    ...(o.seriesField ? { seriesField: o.seriesField } : {}),
    outerRadius: o.outerRadius ?? 0.75,
    color: colors,
    line: { style: { lineWidth: 2 } },
    point: { visible: true, style: { size: 5 } },
    area: { visible: o.area ?? true, style: { fillOpacity: 0.25 } },
    axes: [
      {
        orient: 'radius',
        type: 'linear',
        zero: true,
        ...(o.max == null ? {} : { max: o.max }),
        grid: { visible: true, smooth: true, style: { stroke: palette.border, lineWidth: 1 } },
        domainLine: { visible: false },
        tick: { visible: false },
        label: { visible: false },
      },
      {
        orient: 'angle',
        type: 'band',
        grid: { visible: true, style: { stroke: palette.border, lineWidth: 1 } },
        domainLine: { visible: false },
        tick: { visible: false },
        label: { visible: true, space: 8, style: { fill: palette.text2, fontSize: 11 } },
      },
    ],
    legends: showLegend
      ? { visible: true, orient: 'bottom', position: 'middle', item: { label: { style: { fill: palette.text1, fontSize: 12 } } } }
      : { visible: false },
    tooltip: categoryTooltipSpec({ palette, categoryField, valueField, valueFmt, tooltipKey: o.tooltipKey }),

  };
}

// ────────────────────────── 热力图（类目 × 类目矩阵） ──────────────────────────

export interface HeatmapOptions {
  /** 长表数据：每行一个 (x, y, value) 单元格 */
  readonly data: readonly unknown[];
  readonly xField: string;
  readonly yField: string;
  readonly valueField: string;
  readonly palette: ChartPalette;
  readonly dataId?: string;
  /** 值域两端颜色，默认 [近透明的填充色, 主题色] */
  readonly colorRange?: readonly string[];
  readonly axis?: {
    readonly xLabel?: (value: string) => string;
    readonly yLabel?: (value: string) => string;
  };
  readonly tooltip?: {
    readonly title?: (datum: ChartDatum) => string;
    readonly valueName?: string;
    readonly value?: (value: number, datum: ChartDatum) => string;
  };
  /** 颜色图例（连续色带），默认显示 */
  readonly colorLegend?: boolean;
}

/** 热力图：适合星期 × 小时等类目矩阵的密度展示，颜色随主题联动。 */
export function makeHeatmapSpec(o: HeatmapOptions): Partial<IHeatmapChartSpec> {
  const dataId = o.dataId ?? 'heatmap';
  const range = o.colorRange ? [...o.colorRange] : [o.palette.fill1, o.palette.primary];
  const valueFmt = o.tooltip?.value ?? ((value: number) => compactCount(value));
  const valueName = o.tooltip?.valueName ?? '次数';

  return {
    type: 'heatmap',
    background: 'transparent',
    animation: true,
    data: [{ id: dataId, values: [...(o.data as readonly Record<string, unknown>[])] }],
    xField: o.xField,
    yField: o.yField,
    valueField: o.valueField,
    cell: {
      style: {
        fill: { field: o.valueField, scale: 'color' },
        stroke: o.palette.bg1,
        lineWidth: 1,
      },
    },
    color: {
      type: 'linear',
      domain: [{ dataId, fields: [o.valueField] }],
      range,
    },
    axes: [
      bandAxis('bottom', o.palette, o.axis?.xLabel),
      { ...bandAxis('left', o.palette, o.axis?.yLabel), bandPadding: 0 },
    ],
    legends: o.colorLegend === false
      ? undefined
      : {
          visible: true,
          type: 'color',
          field: o.valueField,
          orient: 'bottom',
          position: 'start',
          railHeight: 8,
          railWidth: 160,
          handlerText: { style: { fill: o.palette.text2, fontSize: 11 } },
        },
    tooltip: {
      ...makeCommonTooltip(o.palette),
      mark: {
        title: {
          value: (datum?: ChartDatum) =>
            o.tooltip?.title ? o.tooltip.title(datum) : `${datumText(datum, o.yField)} ${datumText(datum, o.xField)}`,
        },
        content: [
          {
            key: valueName,
            value: (datum?: ChartDatum) => valueFmt(datumNumber(datum, o.valueField), datum),
          },
        ],
      },
    },
  } as Partial<IHeatmapChartSpec>;
}
