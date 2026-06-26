import { Hash, Table as TableIcon, Grid3x3, Type, BarChart3, LineChart as LineChartIcon, TrendingUp, Columns3, PieChart as PieChartIcon, CircleDot, Radar as RadarIcon, Filter, Gauge as GaugeIcon, LayoutGrid } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReportWidgetType } from '@zenith/shared';

/** 组件类型元数据（设计器面板用）*/
export interface WidgetTypeMeta {
  type: ReportWidgetType;
  label: string;
  icon: LucideIcon;
  /** 默认网格尺寸（列宽 w / 行高 h） */
  defaultSize: { w: number; h: number };
  /** 分组（面板分类展示）*/
  group: '指标' | '表格' | '图表' | '其它';
}

export const WIDGET_TYPES: WidgetTypeMeta[] = [
  { type: 'kpi', label: '指标卡', icon: Hash, defaultSize: { w: 3, h: 3 }, group: '指标' },
  { type: 'gauge', label: '仪表盘', icon: GaugeIcon, defaultSize: { w: 4, h: 4 }, group: '指标' },
  { type: 'table', label: '表格', icon: TableIcon, defaultSize: { w: 6, h: 6 }, group: '表格' },
  { type: 'pivot', label: '透视表', icon: Grid3x3, defaultSize: { w: 6, h: 6 }, group: '表格' },
  { type: 'bar', label: '柱状图', icon: BarChart3, defaultSize: { w: 6, h: 6 }, group: '图表' },
  { type: 'line', label: '折线图', icon: LineChartIcon, defaultSize: { w: 6, h: 6 }, group: '图表' },
  { type: 'area', label: '面积图', icon: TrendingUp, defaultSize: { w: 6, h: 6 }, group: '图表' },
  { type: 'dualAxis', label: '双轴图', icon: Columns3, defaultSize: { w: 6, h: 6 }, group: '图表' },
  { type: 'pie', label: '饼图', icon: PieChartIcon, defaultSize: { w: 4, h: 6 }, group: '图表' },
  { type: 'scatter', label: '散点图', icon: CircleDot, defaultSize: { w: 6, h: 6 }, group: '图表' },
  { type: 'radar', label: '雷达图', icon: RadarIcon, defaultSize: { w: 5, h: 6 }, group: '图表' },
  { type: 'funnel', label: '漏斗图', icon: Filter, defaultSize: { w: 4, h: 6 }, group: '图表' },
  { type: 'treemap', label: '矩形树图', icon: LayoutGrid, defaultSize: { w: 6, h: 6 }, group: '图表' },
  { type: 'text', label: '文本', icon: Type, defaultSize: { w: 4, h: 2 }, group: '其它' },
];

