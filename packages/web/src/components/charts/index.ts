/**
 * 统一图表模块：基于 @visactor/react-vchart + Semi 主题。
 *
 * 页面统一从这里导入图表组件与工具：
 *   import { AreaChart, makeAreaSpec, useChartPalette, chartOptions } from '@/components/charts';
 *
 * 主题（亮/暗、主题色）在本模块首次加载时通过 initVChartSemiTheme 接入（见下方副作用），
 * 配色通过 useChartPalette() 读取 Semi CSS 变量，随主题切换自动刷新。
 */
import { setupVChartSemiTheme } from '@/lib/vchart-theme';

// 主题注册副作用：本模块只存在于懒加载页面 chunk 中，模块求值先于任何图表组件渲染，
// 既保证 VChart 实例创建前主题已就绪，又让 ~2MB 的 vchart 依赖不进入首屏。
setupVChartSemiTheme();

// VChart 图表组件
export {
  AreaChart,
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreemapChart,
  CommonChart,
  VChart,
} from '@visactor/react-vchart';

// VChart spec 类型
export type {
  IAreaChartSpec,
  IBarChartSpec,
  ILineChartSpec,
  IPieChartSpec,
  IScatterChartSpec,
  ITreemapChartSpec,
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
  makeMixedBarLineSpec,
  makeScatterSpec,
  makeTreemapSpec,
  type LineAreaOptions,
  type BarOptions,
  type PieOptions,
  type MixedBarLineOptions,
  type ScatterOptions,
  type TreemapNode,
  type TreemapOptions,
} from './builders';

// 空状态占位
export { EmptyChart } from './EmptyChart';
