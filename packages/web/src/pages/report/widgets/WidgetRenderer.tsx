import { useMemo, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Table } from '@douyinfe/semi-ui';
import {
  BarChart, LineChart, AreaChart, PieChart, ScatterChart, TreemapChart, CommonChart,
  makeBarSpec, makeLineSpec, makeAreaSpec, makePieSpec, makeScatterSpec, makeTreemapSpec, makeMixedBarLineSpec,
  useChartPalette, chartOptions,
} from '@/components/charts';
import type { ReportWidget, ReportField, ReportDataResult, ReportConditionalFormat, ReportWidgetOptions } from '@zenith/shared';

// ─── 工具 ────────────────────────────────────────────────────────────────────
function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(v: number, decimals?: number, prefix?: string, unit?: string): string {
  const s = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 2,
  }).format(v);
  return `${prefix ?? ''}${s}${unit ?? ''}`;
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
    default: return nums.reduce((a, b) => a + b, 0);
  }
}

/** 排序 + TopN */
function sortAndLimit(rows: Record<string, unknown>[], o: ReportWidgetOptions): Record<string, unknown>[] {
  let out = rows;
  if (o.sortField) {
    const f = o.sortField; const dir = o.sortOrder === 'asc' ? 1 : -1;
    out = [...rows].sort((a, b) => (toNumber(a[f]) - toNumber(b[f])) * dir);
  }
  if (o.topN && o.topN > 0) out = out.slice(0, o.topN);
  return out;
}

function matchCondition(value: number, cf: ReportConditionalFormat): boolean {
  switch (cf.op) {
    case 'gte': return value >= cf.value;
    case 'lte': return value <= cf.value;
    case 'gt': return value > cf.value;
    case 'lt': return value < cf.value;
    case 'eq': return value === cf.value;
    case 'neq': return value !== cf.value;
    case 'between': return value >= cf.value && value <= (cf.value2 ?? cf.value);
    default: return false;
  }
}

function cellStyle(field: string, value: unknown, formats?: ReportConditionalFormat[]): CSSProperties | undefined {
  if (!formats?.length || typeof value !== 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    value = n;
  }
  for (const cf of formats ?? []) {
    if (cf.field === field && matchCondition(value as number, cf)) {
      return { color: cf.color, background: cf.background };
    }
  }
  return undefined;
}

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

function EmptyHint({ text }: { readonly text: string }) {
  return <div className="report-widget-empty">{text}</div>;
}

interface WidgetRendererProps {
  widget: ReportWidget;
  data: ReportDataResult | null;
  loading?: boolean;
  error?: string | null;
  /** 全局筛选器当前值（文本组件占位替换用）*/
  filterValues?: Record<string, unknown>;
  /** 点击维度回调（联动/钻取用）*/
  onCategoryClick?: (value: string) => void;
}

export function WidgetRenderer({ widget, data, loading, error, filterValues, onCategoryClick }: Readonly<WidgetRendererProps>) {
  const palette = useChartPalette();
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const chartHeight = Math.max(80, height - 4);

  const content = useMemo(() => {
    const o = widget.options ?? {};
    const rawRows = data?.rows ?? [];

    if (error) return <EmptyHint text={`加载失败：${error}`} />;
    if (loading && !data) return <EmptyHint text="加载中…" />;

    // 文本组件：不依赖数据集
    if (widget.type === 'text') {
      const text = String(o.text ?? '').replace(/\$\{(\w+)\}/g, (_, k) => String(filterValues?.[k] ?? ''));
      return <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--semi-color-text-0)', padding: 4 }}>{text || '（空文本）'}</div>;
    }

    if (!widget.datasetId) return <EmptyHint text="请在右侧选择数据集" />;

    // 指标卡
    if (widget.type === 'kpi') {
      const value = aggregate(rawRows, o.valueField, o.aggregate ?? 'sum');
      const compare = o.compareField ? aggregate(rawRows, o.compareField, o.aggregate ?? 'sum') : undefined;
      const delta = compare != null && compare !== 0 ? ((value - compare) / Math.abs(compare)) * 100 : undefined;
      const target = o.targetValue;
      const progress = target ? Math.min(100, (value / target) * 100) : undefined;
      const trend = o.trendField ? rawRows.map((r) => toNumber(r[o.trendField as string])) : [];
      return (
        <div className="report-kpi">
          <div>
            <span className="report-kpi__value">{fmtNumber(value, o.decimals, o.prefix)}</span>
            {o.unit ? <span className="report-kpi__unit">{o.unit}</span> : null}
          </div>
          {delta != null && (
            <div style={{ fontSize: 13, color: delta >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% <span style={{ color: 'var(--semi-color-text-2)' }}>对比</span>
            </div>
          )}
          {progress != null && (
            <div style={{ marginTop: 2 }}>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--semi-color-fill-1)', overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: 'var(--semi-color-primary)' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)', marginTop: 2 }}>目标 {fmtNumber(target ?? 0, o.decimals)}（{progress.toFixed(0)}%）</div>
            </div>
          )}
          {trend.length > 1 && (
            <Sparkline values={trend} />
          )}
        </div>
      );
    }

    if (!rawRows.length) return <EmptyHint text="暂无数据" />;
    const rows = sortAndLimit(rawRows, o);

    // 表格
    if (widget.type === 'table') {
      const cols: ReportField[] = o.columns?.length
        ? o.columns
        : (data?.columns ?? []).map((c) => ({ name: c, label: c, type: 'string' as const }));
      const tableColumns = cols.map((c) => ({
        title: c.label || c.name,
        dataIndex: c.name,
        render: (val: unknown) => <span style={cellStyle(c.name, val, o.conditionalFormats)}>{val == null ? '' : String(val)}</span>,
      }));
      const dataSource: Record<string, unknown>[] = rows.map((r, i) => ({ ...r, __rk: i }));
      if (o.showSummary && cols.length) {
        const totalRow: Record<string, unknown> = { __rk: '__summary', [cols[0].name]: '合计' };
        for (let i = 1; i < cols.length; i++) {
          const c = cols[i];
          const isNum = c.type === 'number' || rows.some((r) => typeof r[c.name] === 'number');
          if (isNum) totalRow[c.name] = rows.reduce((s, r) => s + toNumber(r[c.name]), 0);
        }
        dataSource.push(totalRow);
      }
      return (
        <div style={{ height: '100%', overflow: 'auto' }}>
          <Table
            size="small" bordered={false} columns={tableColumns} dataSource={dataSource} rowKey="__rk"
            pagination={o.pageSize && o.pageSize > 0 ? { pageSize: o.pageSize } : false}
            onRow={onCategoryClick ? (record) => ({ onClick: () => onCategoryClick(String((record as Record<string, unknown>)[cols[0]?.name] ?? '')), style: { cursor: 'pointer' } }) : undefined}
          />
        </div>
      );
    }

    // 透视表
    if (widget.type === 'pivot') {
      return <PivotView rows={rows} o={o} />;
    }

    // 仪表盘 gauge
    if (widget.type === 'gauge') {
      const value = aggregate(rawRows, o.valueField, o.aggregate ?? 'sum');
      return <Gauge value={value} min={o.min ?? 0} max={o.max ?? 100} unit={o.unit} decimals={o.decimals} />;
    }

    // 漏斗
    if (widget.type === 'funnel') {
      if (!o.categoryField || !o.valueFields?.[0]) return <EmptyHint text="请配置分类字段与指标字段" />;
      return <Funnel rows={rows} cat={o.categoryField} val={o.valueFields[0]} onClick={onCategoryClick} />;
    }

    // 雷达
    if (widget.type === 'radar') {
      if (!o.categoryField || !o.valueFields?.[0]) return <EmptyHint text="请配置分类字段与指标字段" />;
      return <Radar rows={rows} cat={o.categoryField} val={o.valueFields[0]} />;
    }

    if (width === 0 || height === 0) return <div style={{ height: '100%' }} />;

    const onChartClick = onCategoryClick
      ? (p: unknown) => {
          const datum = (p as { datum?: Record<string, unknown> })?.datum;
          const v = datum?.[o.categoryField as string];
          if (v != null) onCategoryClick(String(v));
        }
      : undefined;

    // 饼图
    if (widget.type === 'pie') {
      const valueField = o.valueFields?.[0];
      if (!o.categoryField || !valueField) return <EmptyHint text="请配置分类字段与指标字段" />;
      const pieData = rows.map((r) => ({ [o.categoryField as string]: String(r[o.categoryField as string] ?? ''), [valueField]: toNumber(r[valueField]) }));
      const spec = makePieSpec({ data: pieData, categoryField: o.categoryField, valueField, palette });
      return <PieChart {...spec} options={chartOptions} height={chartHeight} onClick={onChartClick} />;
    }

    // 散点
    if (widget.type === 'scatter') {
      const xf = o.categoryField; const yf = o.valueFields?.[0];
      if (!xf || !yf) return <EmptyHint text="请配置 X / Y 字段" />;
      const sData = rows.map((r) => ({ [xf]: toNumber(r[xf]), [yf]: toNumber(r[yf]) }));
      const spec = makeScatterSpec({ data: sData, xField: xf, yField: yf, palette });
      return <ScatterChart {...spec} options={chartOptions} height={chartHeight} />;
    }

    // treemap
    if (widget.type === 'treemap') {
      const valueField = o.valueFields?.[0];
      if (!o.categoryField || !valueField) return <EmptyHint text="请配置分类字段与指标字段" />;
      const nodes = rows.map((r) => ({ name: String(r[o.categoryField as string] ?? ''), value: toNumber(r[valueField]) }));
      const spec = makeTreemapSpec({ data: nodes, palette, categoryField: 'name', valueField: 'value' });
      return <TreemapChart {...spec} options={chartOptions} height={chartHeight} />;
    }

    // 双轴组合
    if (widget.type === 'dualAxis') {
      const barF = o.valueFields?.[0]; const lineF = o.secondaryFields?.[0];
      if (!o.categoryField || !barF || !lineF) return <EmptyHint text="请配置分类、左轴(柱)、右轴(线)字段" />;
      const cData = rows.map((r) => ({ [o.categoryField as string]: String(r[o.categoryField as string] ?? ''), [barF]: toNumber(r[barF]), [lineF]: toNumber(r[lineF]) }));
      const spec = makeMixedBarLineSpec({ data: cData, xField: o.categoryField, palette, bar: { field: barF, name: barF }, line: { field: lineF, name: lineF } });
      return <CommonChart {...spec} options={chartOptions} height={chartHeight} />;
    }

    // 柱 / 线 / 面积（含堆叠、百分比、水平）
    const valueFields = o.valueFields?.length ? o.valueFields : [];
    if (!o.categoryField || valueFields.length === 0) return <EmptyHint text="请配置分类字段与指标字段" />;
    let chartData = rows.map((r) => {
      const row: Record<string, unknown> = { [o.categoryField as string]: String(r[o.categoryField as string] ?? '') };
      for (const f of valueFields) row[f] = toNumber(r[f]);
      return row;
    });
    if (o.percent && valueFields.length > 0) {
      chartData = chartData.map((r) => {
        const total = valueFields.reduce((s, f) => s + toNumber(r[f]), 0) || 1;
        const nr: Record<string, unknown> = { ...r };
        for (const f of valueFields) nr[f] = Number(((toNumber(r[f]) / total) * 100).toFixed(2));
        return nr;
      });
    }
    const series = valueFields.map((f) => ({ field: f, name: f }));
    if (widget.type === 'bar') {
      const spec = makeBarSpec({ data: chartData, xField: o.categoryField, series, palette, stack: o.stack || o.percent, horizontal: o.horizontal, showLabel: o.showLabel });
      return <BarChart {...spec} options={chartOptions} height={chartHeight} onClick={onChartClick} />;
    }
    if (widget.type === 'area') {
      const spec = makeAreaSpec({ data: chartData, xField: o.categoryField, series, palette, stack: o.stack || o.percent, smooth: o.smooth });
      return <AreaChart {...spec} options={chartOptions} height={chartHeight} onClick={onChartClick} />;
    }
    const spec = makeLineSpec({ data: chartData, xField: o.categoryField, series, palette, smooth: o.smooth, point: true });
    return <LineChart {...spec} options={chartOptions} height={chartHeight} onClick={onChartClick} />;
  }, [widget, data, loading, error, palette, width, height, chartHeight, filterValues, onCategoryClick]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }}>{content}</div>;
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────
function Sparkline({ values }: { readonly values: number[] }) {
  const w = 120, h = 28;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ marginTop: 4 }}>
      <polyline points={pts} fill="none" stroke="var(--semi-color-primary)" strokeWidth={1.5} />
    </svg>
  );
}

function Gauge({ value, min, max, unit, decimals }: { readonly value: number; readonly min: number; readonly max: number; readonly unit?: string; readonly decimals?: number }) {
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const r = 70, cx = 90, cy = 90;
  const a0 = Math.PI, a1 = Math.PI * (1 - frac);
  const arc = (start: number, end: number) => {
    const x0 = cx + r * Math.cos(start), y0 = cy - r * Math.sin(start);
    const x1 = cx + r * Math.cos(end), y1 = cy - r * Math.sin(end);
    const large = Math.abs(end - start) > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <svg width={180} height={110} viewBox="0 0 180 110">
        <path d={arc(a0, 0)} fill="none" stroke="var(--semi-color-fill-1)" strokeWidth={12} strokeLinecap="round" />
        <path d={arc(a0, a1)} fill="none" stroke="var(--semi-color-primary)" strokeWidth={12} strokeLinecap="round" />
        <text x={cx} y={cy - 10} textAnchor="middle" fontSize={22} fontWeight={700} fill="var(--semi-color-text-0)">{fmtNumber(value, decimals)}{unit ?? ''}</text>
      </svg>
    </div>
  );
}

function Funnel({ rows, cat, val, onClick }: { readonly rows: Record<string, unknown>[]; readonly cat: string; readonly val: string; readonly onClick?: (v: string) => void }) {
  const sorted = [...rows].sort((a, b) => toNumber(b[val]) - toNumber(a[val]));
  const max = toNumber(sorted[0]?.[val]) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 4, height: '100%', justifyContent: 'center' }}>
      {sorted.map((r, i) => {
        const v = toNumber(r[val]); const pct = (v / max) * 100;
        return (
          <div key={i} onClick={onClick ? () => onClick(String(r[cat] ?? '')) : undefined} style={{ cursor: onClick ? 'pointer' : 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--semi-color-text-1)' }}>
              <span>{String(r[cat] ?? '')}</span><span>{fmtNumber(v)}</span>
            </div>
            <div style={{ margin: '2px auto', width: `${Math.max(8, pct)}%`, height: 18, background: `var(--semi-color-primary)`, opacity: 0.4 + 0.6 * (pct / 100), borderRadius: 3 }} />
          </div>
        );
      })}
    </div>
  );
}

function Radar({ rows, cat, val }: { readonly rows: Record<string, unknown>[]; readonly cat: string; readonly val: string }) {
  const n = rows.length;
  if (n < 3) return <EmptyHint text="雷达图需要至少 3 个维度" />;
  const cx = 110, cy = 105, R = 80;
  const max = Math.max(...rows.map((r) => toNumber(r[val]))) || 1;
  const point = (i: number, frac: number) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + R * frac * Math.cos(ang), cy + R * frac * Math.sin(ang)];
  };
  const poly = rows.map((r, i) => point(i, toNumber(r[val]) / max).join(',')).join(' ');
  const grid = [0.33, 0.66, 1].map((f) => rows.map((_, i) => point(i, f).join(',')).join(' '));
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <svg width={220} height={210}>
        {grid.map((g, i) => <polygon key={i} points={g} fill="none" stroke="var(--semi-color-border)" strokeWidth={1} />)}
        {rows.map((_, i) => { const [x, y] = point(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--semi-color-border)" strokeWidth={1} />; })}
        <polygon points={poly} fill="var(--semi-color-primary)" fillOpacity={0.3} stroke="var(--semi-color-primary)" strokeWidth={1.5} />
        {rows.map((r, i) => { const [x, y] = point(i, 1.12); return <text key={i} x={x} y={y} textAnchor="middle" fontSize={10} fill="var(--semi-color-text-2)">{String(r[cat] ?? '')}</text>; })}
      </svg>
    </div>
  );
}

function PivotView({ rows, o }: { readonly rows: Record<string, unknown>[]; readonly o: ReportWidgetOptions }) {
  const rowDims = o.pivotRows ?? [];
  const colDim = o.pivotColumns?.[0];
  const valField = o.pivotValueField;
  const agg = o.pivotAggregate ?? 'sum';
  if (!rowDims.length || !valField) return <EmptyHint text="请配置行维度与值字段" />;

  const colValues = colDim ? Array.from(new Set(rows.map((r) => String(r[colDim] ?? '')))).sort() : ['值'];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const key = rowDims.map((d) => String(r[d] ?? '')).join(' / ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const aggOf = (rs: Record<string, unknown>[]) => aggregate(rs, valField, agg);
  const dataSource = Array.from(groups.entries()).map(([key, rs], i) => {
    const rec: Record<string, unknown> = { __rk: i, __row: key };
    if (colDim) for (const cv of colValues) rec[cv] = aggOf(rs.filter((r) => String(r[colDim] ?? '') === cv));
    else rec['值'] = aggOf(rs);
    return rec;
  });
  const columns = [
    { title: rowDims.join(' / '), dataIndex: '__row', fixed: 'left' as const, width: 160 },
    ...colValues.map((cv) => ({ title: cv, dataIndex: cv, render: (v: unknown) => fmtNumber(toNumber(v), o.decimals) })),
  ];
  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <Table size="small" bordered columns={columns} dataSource={dataSource} rowKey="__rk" pagination={false} scroll={{ x: Math.max(400, colValues.length * 120 + 160) }} />
    </div>
  );
}

export default WidgetRenderer;
