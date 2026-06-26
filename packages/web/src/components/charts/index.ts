/**
 * 统一图表模块：基于 @visactor/react-vchart + Semi 主题。
 *
 * 页面统一从这里导入图表组件与工具：
 *   import { AreaChart, makeAreaSpec, useChartPalette, chartOptions } from '@/components/charts';
 *
 * 主题（亮/暗、主题色）已在 main.tsx 通过 initVChartSemiTheme 接入，
 * 配色通过 useChartPalette() 读取 Semi CSS 变量，随主题切换自动刷新。
 */

// VChart 图表组件
export {
  AreaChart,
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  CommonChart,
  VChart,
} from '@visactor/react-vchart';

// VChart spec 类型
export type {
  IAreaChartSpec,
  IBarChartSpec,
  ILineChartSpec,
  IPieChartSpec,
  IHeatmapChartSpec,
  ICommonChartSpec,
} from '@visactor/react-vchart';

// 主题调色板
export { cssVar, readChartPalette, useChartPalette, type ChartPalette } from './palette';

// 工具与公共 spec 片段
export {
  chartOptions,
  compactCount,
  sectionStyle,
  sectionTitleStyle,
  axisText,
  axisNumber,
  datumText,
  datumNumber,
  datumBoolean,
  makeCommonTooltip,
  makeCommonCartesianSpec,
  isEmptyValues,
  wideToLong,
  seriesColors,
  type ChartDatum,
  type SeriesField,
  type LongDatum,
} from './helpers';

// 通用 spec 构造器
export {
  makeLineSpec,
  makeAreaSpec,
  makeBarSpec,
  makePieSpec,
  type LineAreaOptions,
  type BarOptions,
  type PieOptions,
} from './builders';

// 空状态占位
export { EmptyChart } from './EmptyChart';

// 日历热力图
export {
  buildCalendarHeatmap,
  makeCalendarHeatmapSpec,
  type HeatmapDatum,
} from './heatmap';
export { HeatmapLegend } from './HeatmapLegend';
