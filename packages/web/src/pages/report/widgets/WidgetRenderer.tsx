import { useEffect, useMemo, useRef, useState } from 'react';
import { Table } from '@douyinfe/semi-ui';
import { Hash, Table as TableIcon, BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BarChart, LineChart, PieChart, makeBarSpec, makeLineSpec, makePieSpec, useChartPalette, chartOptions } from '@/components/charts';
import type { ReportWidget, ReportWidgetType, ReportField, ReportDataResult } from '@zenith/shared';

// ─── 组件类型元数据（设计器面板用）────────────────────────────────────────────
export interface WidgetTypeMeta {
  type: ReportWidgetType;
  label: string;
  icon: LucideIcon;
  /** 默认网格尺寸（列宽 w / 行高 h） */
  defaultSize: { w: number; h: number };
}

export const WIDGET_TYPES: WidgetTypeMeta[] = [
  { type: 'kpi', label: '指标卡', icon: Hash, defaultSize: { w: 3, h: 3 } },
  { type: 'table', label: '表格', icon: TableIcon, defaultSize: { w: 6, h: 6 } },
  { type: 'bar', label: '柱状图', icon: BarChart3, defaultSize: { w: 6, h: 6 } },
  { type: 'line', label: '折线图', icon: LineChartIcon, defaultSize: { w: 6, h: 6 } },
  { type: 'pie', label: '饼图', icon: PieChartIcon, defaultSize: { w: 4, h: 6 } },
];

export function widgetTypeLabel(type: ReportWidgetType): string {
  return WIDGET_TYPES.find((w) => w.type === type)?.label ?? type;
}

// ─── 工具 ────────────────────────────────────────────────────────────────────
const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function aggregate(rows: Record<string, unknown>[], field: string | undefined, agg: string | undefined): number {
  if (!field) return rows.length;
  if (agg === 'count') return rows.length;
  const nums = rows.map((r) => toNumber(r[field]));
  switch (agg) {
    case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'max': return nums.length ? Math.max(...nums) : 0;
    case 'min': return nums.length ? Math.min(...nums) : 0;
    case 'first': return toNumber(rows[0]?.[field]);
    default: return nums.reduce((a, b) => a + b, 0); // sum
  }
}

/** 测量元素尺寸（用于给 VChart 传入像素高度） */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

interface WidgetRendererProps {
  widget: ReportWidget;
  data: ReportDataResult | null;
  loading?: boolean;
  error?: string | null;
}

function EmptyHint({ text }: { readonly text: string }) {
  return <div className="report-widget-empty">{text}</div>;
}

/** 单个组件的内容渲染（不含卡片外壳） */
export function WidgetRenderer({ widget, data, loading, error }: Readonly<WidgetRendererProps>) {
  const palette = useChartPalette();
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const rows = data?.rows ?? [];
  const opts = widget.options ?? {};

  const chartHeight = Math.max(80, height - 4);

  const content = useMemo(() => {
    if (error) return <EmptyHint text={`加载失败：${error}`} />;
    if (loading && !data) return <EmptyHint text="加载中…" />;
    if (!widget.datasetId) return <EmptyHint text="请在右侧选择数据集" />;

    if (widget.type === 'kpi') {
      const value = aggregate(rows, opts.valueField, opts.aggregate ?? 'sum');
      return (
        <div className="report-kpi">
          <div>
            <span className="report-kpi__value">{numberFmt.format(value)}</span>
            {opts.unit ? <span className="report-kpi__unit">{opts.unit}</span> : null}
          </div>
        </div>
      );
    }

    if (!rows.length) return <EmptyHint text="暂无数据" />;

    if (widget.type === 'table') {
      const cols: ReportField[] = opts.columns?.length
        ? opts.columns
        : (data?.columns ?? []).map((c) => ({ name: c, label: c, type: 'string' as const }));
      const tableColumns = cols.map((c) => ({ title: c.label || c.name, dataIndex: c.name }));
      const dataSource = rows.map((r, i) => ({ ...r, __rk: i }));
      return (
        <div style={{ height: '100%', overflow: 'auto' }}>
          <Table
            size="small"
            bordered={false}
            columns={tableColumns}
            dataSource={dataSource}
            rowKey="__rk"
            pagination={false}
          />
        </div>
      );
    }

    // 图表类：需要分类字段 + 至少一个指标字段
    if (width === 0 || height === 0) return <div style={{ height: '100%' }} />;

    if (widget.type === 'pie') {
      const valueField = opts.valueFields?.[0];
      if (!opts.categoryField || !valueField) return <EmptyHint text="请配置分类字段与指标字段" />;
      const pieData = rows.map((r) => ({
        [opts.categoryField as string]: String(r[opts.categoryField as string] ?? ''),
        [valueField]: toNumber(r[valueField]),
      }));
      const spec = makePieSpec({ data: pieData, categoryField: opts.categoryField, valueField, palette });
      return <PieChart {...spec} options={chartOptions} height={chartHeight} />;
    }

    // bar / line
    const valueFields = opts.valueFields?.length ? opts.valueFields : [];
    if (!opts.categoryField || valueFields.length === 0) return <EmptyHint text="请配置分类字段与指标字段" />;
    const chartData = rows.map((r) => {
      const row: Record<string, unknown> = { [opts.categoryField as string]: String(r[opts.categoryField as string] ?? '') };
      for (const f of valueFields) row[f] = toNumber(r[f]);
      return row;
    });
    const series = valueFields.map((f) => ({ field: f, name: f }));
    if (widget.type === 'bar') {
      const spec = makeBarSpec({ data: chartData, xField: opts.categoryField, series, palette });
      return <BarChart {...spec} options={chartOptions} height={chartHeight} />;
    }
    const spec = makeLineSpec({ data: chartData, xField: opts.categoryField, series, palette });
    return <LineChart {...spec} options={chartOptions} height={chartHeight} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget, data, rows, opts, loading, error, palette, width, height, chartHeight]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }}>{content}</div>;
}

export default WidgetRenderer;
