import { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Table } from '@douyinfe/semi-ui';
import VChartCore from '@visactor/vchart';
import type { ISpec } from '@visactor/vchart';
import { HeatmapChart, LiquidChart, SankeyChart, VChart as VChartReact, WordCloudChart } from '@visactor/react-vchart';
import {
  BarChart, LineChart, AreaChart, PieChart, ScatterChart, TreemapChart, CommonChart,
  makeBarSpec, makeLineSpec, makeAreaSpec, makePieSpec, makeScatterSpec, makeTreemapSpec, makeMixedBarLineSpec,
  useChartPalette, chartOptions, type ChartPalette,
} from '@/components/charts';
import { aggregateReportRows, formatReportFieldValue } from '@zenith/shared';
import type { ReportWidget, ReportField, ReportDataResult, ReportConditionalFormat, ReportWidgetOptions, ReportDatasetQueryOptions, ReportResultField } from '@zenith/shared';
import { useReportWidgetDictMaps } from '@/hooks/queries/report-designer';
import { TABLE_PAGE_SIZE_OPTIONS } from '@/hooks/usePagination';

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

function applyChartTooltipFormatter(
  spec: Record<string, unknown>,
  fields: Map<string, ReportResultField>,
  formatValue: (field: Pick<ReportResultField, 'format'> | null | undefined, value: unknown) => string,
  categoryField?: string,
  valueFields?: string[],
) {
  const values = (valueFields ?? []).filter(Boolean);
  return {
    ...spec,
    tooltip: {
      visible: true,
      formatter: (datum: Record<string, unknown>) => {
        const titleField = categoryField ? fields.get(categoryField) : null;
        return {
          title: categoryField ? formatValue(titleField, datum?.[categoryField]) : undefined,
          content: values.map((fieldName) => ({
            key: fields.get(fieldName)?.label ?? fieldName,
            value: formatValue(fields.get(fieldName), datum?.[fieldName]),
          })),
        };
      },
    },
  };
}

function resolveTemplate(value: unknown, filterValues?: Record<string, unknown>): string {
  return String(value ?? '').replace(/\$\{(\w+)\}/g, (_, k) => String(filterValues?.[k] ?? ''));
}

const registeredMapNames = new Set<string>();

interface WidgetRendererProps {
  widget: ReportWidget;
  data: ReportDataResult | null;
  loading?: boolean;
  error?: string | null;
  widgetQuery?: ReportDatasetQueryOptions;
  onWidgetQueryChange?: (widgetId: string, next: ReportDatasetQueryOptions) => void;
  /** 全局筛选器当前值（文本组件占位替换用）*/
  filterValues?: Record<string, unknown>;
  /** 点击维度回调（联动/钻取用）*/
  onCategoryClick?: (value: string) => void;
}

export function WidgetRenderer({
  widget, data, loading, error, widgetQuery, onWidgetQueryChange, filterValues, onCategoryClick,
}: Readonly<WidgetRendererProps>) {
  const palette = useChartPalette();
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  // 多级原地钻取：按 drilldown.fields 逐层下钻的当前路径（{字段,值}）
  const [drillPath, setDrillPath] = useState<{ field: string; value: string }[]>([]);
  const configuredTablePageSize = widget.type === 'table' ? (widget.options?.pageSize || 10) : 10;
  const [localTablePage, setLocalTablePage] = useState(1);
  const [localTablePageSize, setLocalTablePageSize] = useState(configuredTablePageSize);

  const dd = widget.drilldown;
  const drillFields = useMemo(() => (dd?.enabled && dd.type === 'fields' ? (dd.fields ?? []) : []), [dd]);
  const fieldDrill = drillFields.length > 0;
  const showCrumb = fieldDrill && drillPath.length > 0;
  const crumbH = showCrumb ? 28 : 0;
  const chartHeight = Math.max(80, height - 4 - crumbH);

  // 数据集变化时重置钻取路径，避免残留无效层级
  useEffect(() => { setDrillPath([]); }, [widget.datasetId]);
  useEffect(() => {
    setLocalTablePage(1);
    setLocalTablePageSize(configuredTablePageSize);
  }, [configuredTablePageSize, widget.i]);

  const dataFieldMap = useMemo(() => new Map((data?.fields ?? []).map((field) => [field.name, field])), [data?.fields]);
  const tableDictCodes = useMemo(() => {
    const cols = widget.type === 'table' && widget.options?.columns?.length
      ? widget.options.columns
      : (data?.fields ?? []);
    return Array.from(new Set(cols
      .map((col) => col.format?.kind === 'dict' ? col.format.dictCode?.trim() : '')
      .filter((code): code is string => !!code)));
  }, [data?.fields, widget]);
  const dictMaps = useReportWidgetDictMaps(tableDictCodes);

  const formatValueByField = useCallback((field: Pick<ReportResultField, 'format'> | null | undefined, value: unknown) => {
    const dictCode = field?.format?.kind === 'dict' ? field.format.dictCode?.trim() : '';
    const dictMap = dictCode ? dictMaps[dictCode] : undefined;
    return formatReportFieldValue(field, value, dictMap);
  }, [dictMaps]);

  const content = useMemo(() => {
    const baseOptions = widget.options ?? {};
    // 钻取生效时：分类字段替换为当前层级字段，原始行按已下钻路径过滤
    const drillLevel = fieldDrill ? Math.min(drillPath.length, drillFields.length - 1) : 0;
    const o = fieldDrill ? { ...baseOptions, categoryField: drillFields[drillLevel] } : baseOptions;
    let rawRows = data?.rows ?? [];
    if (fieldDrill && drillPath.length) {
      rawRows = rawRows.filter((r) => drillPath.every((p) => String(r[p.field] ?? '') === p.value));
    }
    // 维度点击：可继续下钻则下钻，否则回退到外部联动/钻取
    const canDrillDeeper = fieldDrill && drillPath.length < drillFields.length - 1;
    const handleCat = (value: string) => {
      if (canDrillDeeper) setDrillPath((prev) => [...prev, { field: drillFields[drillLevel], value }]);
      else onCategoryClick?.(value);
    };
    const interactive = fieldDrill || !!onCategoryClick;

    if (error) return <EmptyHint text={`加载失败：${error}`} />;
    if (loading && !data) return <EmptyHint text="加载中…" />;

    // 文本组件：不依赖数据集
    if (widget.type === 'text') {
      const text = resolveTemplate(o.text, filterValues);
      return <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--semi-color-text-0)', padding: 4 }}>{text || '（空文本）'}</div>;
    }

    if (widget.type === 'image') {
      const src = resolveTemplate(o.src, filterValues).trim();
      if (!src) return <EmptyHint text="请配置图片地址" />;
      return (
        <img
          src={src}
          alt={widget.title}
          style={{ width: '100%', height: '100%', objectFit: o.fit ?? 'contain', display: 'block' }}
        />
      );
    }

    if (widget.type === 'iframe') {
      const src = resolveTemplate(o.src, filterValues).trim();
      if (!src) return <EmptyHint text="请配置网页地址" />;
      return (
        <iframe
          src={src}
          title={widget.title}
          sandbox="allow-scripts allow-same-origin allow-popups"
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      );
    }

    if (!widget.datasetId && !widget.metricId) return <EmptyHint text="请在右侧选择数据集或指标" />;

    // 指标卡
    if (widget.type === 'kpi') {
      const value = aggregateReportRows(rawRows, o.valueField, o.aggregate ?? 'sum');
      const compare = o.compareField ? aggregateReportRows(rawRows, o.compareField, o.aggregate ?? 'sum') : undefined;
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
              <div style={{ height: 6, borderRadius: 'var(--semi-border-radius-small)', background: 'var(--semi-color-fill-1)', overflow: 'hidden' }}>
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

    if (widget.type === 'flipper') {
      const value = aggregateReportRows(rawRows, o.valueField, o.aggregate ?? 'sum');
      return <Flipper value={value} digits={o.flipDigits} decimals={o.decimals} prefix={o.prefix} unit={o.unit} />;
    }

    if (!rawRows.length && widget.type !== 'liquid') return <EmptyHint text="暂无数据" />;
    const rows = sortAndLimit(rawRows, o);

    if (widget.type === 'scrollList') {
      if (!o.categoryField || !o.valueFields?.[0]) return <EmptyHint text="请配置名称字段与数值字段" />;
      return (
        <ScrollList
          rows={rows}
          cat={o.categoryField}
          val={o.valueFields[0]}
          speed={o.scrollSpeed}
          showRank={o.showRank}
          onClick={interactive ? handleCat : undefined}
        />
      );
    }

    // 表格
    if (widget.type === 'table') {
      const cols: ReportField[] = o.columns?.length
        ? o.columns
        : (data?.fields?.length
          ? data.fields.map((field) => ({ ...field }))
          : (data?.columns ?? []).map((c) => ({ name: c, label: c, type: 'string' as const })));
      const tableColumns = cols.map((c) => ({
        title: c.label || c.name,
        dataIndex: c.name,
        sorter: !!onWidgetQueryChange,
        render: (val: unknown, record: Record<string, unknown>) => {
          if (record.__rk === '__summary' && c.name === cols[0]?.name) {
            return <span style={cellStyle(c.name, val, o.conditionalFormats)}>{val == null ? '' : String(val)}</span>;
          }
          const fieldMeta = c.format ? c : dataFieldMap.get(c.name);
          const text = fieldMeta ? formatValueByField(fieldMeta, val) : (val == null ? '' : String(val));
          return <span style={cellStyle(c.name, val, o.conditionalFormats)}>{text}</span>;
        },
      }));
      const dataSource: Record<string, unknown>[] = rows.map((r, i) => ({ ...r, __rk: i }));
      if (o.showSummary && cols.length) {
        const totalRow: Record<string, unknown> = { __rk: '__summary', [cols[0].name]: '合计' };
        for (let i = 1; i < cols.length; i++) {
          const c = cols[i];
          const isNum = c.type === 'number' || rows.some((r) => typeof r[c.name] === 'number');
          if (isNum) totalRow[c.name] = aggregateReportRows(rows, c.name, 'sum');
        }
        dataSource.push(totalRow);
      }
      // 大数据量（未分页 >100 行）启用虚拟滚动，防整表渲染卡顿；虚拟化要求固定列宽 + scroll.y
      const paginated = !!o.pageSize && o.pageSize > 0;
      const useVirtual = !paginated && dataSource.length > 100;
      const activePage = widgetQuery?.page ?? localTablePage;
      const activePageSize = widgetQuery?.pageSize ?? localTablePageSize;
      const total = onWidgetQueryChange ? (data?.total ?? dataSource.length) : dataSource.length;
      return (
        <div style={{ height: '100%', overflow: useVirtual ? 'hidden' : 'auto' }}>
          <Table
            size="small" bordered={false}
            columns={useVirtual ? tableColumns.map((c) => ({ width: 140, ...c })) : tableColumns}
            dataSource={dataSource} rowKey="__rk"
            pagination={paginated ? {
              pageSize: activePageSize,
              currentPage: activePage,
              total,
              showSizeChanger: true,
              pageSizeOpts: TABLE_PAGE_SIZE_OPTIONS,
              onPageChange: (page) => {
                if (onWidgetQueryChange) {
                  onWidgetQueryChange(widget.i, { ...widgetQuery, page, pageSize: activePageSize });
                } else {
                  setLocalTablePage(page);
                }
              },
              onPageSizeChange: (pageSize) => {
                if (onWidgetQueryChange) {
                  onWidgetQueryChange(widget.i, { ...widgetQuery, page: 1, pageSize });
                } else {
                  setLocalTablePage(1);
                  setLocalTablePageSize(pageSize);
                }
              },
            } : false}
            onChange={onWidgetQueryChange ? (...args: unknown[]) => {
              const sorter = (args[2] ?? args[1]) as { field?: unknown; sortOrder?: 'ascend' | 'descend' | false | null } | undefined;
              if (!sorter || Array.isArray(sorter)) return;
              const sortField = typeof sorter.field === 'string' ? sorter.field : undefined;
              const sortOrder = sorter.sortOrder === 'ascend' ? 'asc' : sorter.sortOrder === 'descend' ? 'desc' : undefined;
              onWidgetQueryChange(widget.i, {
                ...widgetQuery,
                page: 1,
                pageSize: widgetQuery?.pageSize ?? o.pageSize,
                sortField,
                sortOrder,
              });
            } : undefined}
            {...(useVirtual ? { virtualized: { itemSize: 36 }, scroll: { y: Math.max(80, chartHeight - 36), x: cols.length * 140 } } : {})}
            onRow={interactive ? (record) => ({ onClick: () => handleCat(String((record as Record<string, unknown>)[cols[0]?.name] ?? '')), style: { cursor: 'pointer' } }) : undefined}
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
      const value = aggregateReportRows(rawRows, o.valueField, o.aggregate ?? 'sum');
      return <Gauge value={value} min={o.min ?? 0} max={o.max ?? 100} unit={o.unit} decimals={o.decimals} />;
    }

    // 漏斗
    if (widget.type === 'funnel') {
      if (!o.categoryField || !o.valueFields?.[0]) return <EmptyHint text="请配置分类字段与指标字段" />;
      return <Funnel rows={rows} cat={o.categoryField} val={o.valueFields[0]} onClick={interactive ? handleCat : undefined} />;
    }

    // 雷达
    if (widget.type === 'radar') {
      if (!o.categoryField || !o.valueFields?.[0]) return <EmptyHint text="请配置分类字段与指标字段" />;
      return <Radar rows={rows} cat={o.categoryField} val={o.valueFields[0]} />;
    }

    if (width === 0 || height === 0) return <div style={{ height: '100%' }} />;

    if (widget.type === 'liquid') {
      if (!o.valueField) return <EmptyHint text="请配置取值字段" />;
      const value = aggregateReportRows(rawRows, o.valueField, o.aggregate ?? 'sum');
      const max = o.max && o.max > 0 ? o.max : 100;
      const percent = Math.max(0, Math.min(1, value / max));
      const spec = {
        type: 'liquid',
        data: [{ id: 'd', values: [{ value: percent }] }],
        valueField: 'value',
        maskShape: 'circle',
        indicatorSmartInvert: true,
        outlinePadding: 4,
        liquidOutline: { style: { stroke: palette.primary, lineWidth: 2 } },
        liquidBackground: { style: { fill: palette.fill1 } },
        liquid: { style: { fill: palette.primary, fillOpacity: 0.78 } },
        tooltip: { visible: false },
      };
      return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <LiquidChart spec={spec as ISpec} options={chartOptions} height={chartHeight} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ color: 'var(--semi-color-text-0)', fontSize: 22, fontWeight: 700 }}>{fmtNumber(value, o.decimals)}{o.unit ?? ''}</span>
            <span style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>{Math.round(percent * 100)}%</span>
          </div>
        </div>
      );
    }

    const onChartClick = interactive
      ? (p: unknown) => {
          const datum = (p as { datum?: Record<string, unknown> })?.datum;
          const v = datum?.[o.categoryField as string];
          if (v != null) handleCat(String(v));
        }
      : undefined;

    // 饼图
    if (widget.type === 'pie') {
      const valueField = o.valueFields?.[0];
      if (!o.categoryField || !valueField) return <EmptyHint text="请配置分类字段与指标字段" />;
      const pieData = rows.map((r) => ({ [o.categoryField as string]: String(r[o.categoryField as string] ?? ''), [valueField]: toNumber(r[valueField]) }));
      const spec = applyChartTooltipFormatter(
        makePieSpec({ data: pieData, categoryField: o.categoryField, valueField, palette }) as Record<string, unknown>,
        dataFieldMap,
        formatValueByField,
        o.categoryField,
        [valueField],
      );
      return <PieChart {...spec} options={chartOptions} height={chartHeight} onClick={onChartClick} />;
    }

    // 散点
    if (widget.type === 'scatter') {
      const xf = o.categoryField; const yf = o.valueFields?.[0];
      if (!xf || !yf) return <EmptyHint text="请配置 X / Y 字段" />;
      const sData = rows.map((r) => ({ [xf]: toNumber(r[xf]), [yf]: toNumber(r[yf]) }));
      const spec = applyChartTooltipFormatter(
        makeScatterSpec({ data: sData, xField: xf, yField: yf, palette }) as Record<string, unknown>,
        dataFieldMap,
        formatValueByField,
        xf,
        [yf],
      );
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

    // 桑基图
    if (widget.type === 'sankey') {
      const valueField = o.valueFields?.[0];
      if (!o.sourceField || !o.targetField || !valueField) return <EmptyHint text="请配置源字段、目标字段与值字段" />;
      const links = rows
        .map((r) => ({ source: String(r[o.sourceField as string] ?? ''), target: String(r[o.targetField as string] ?? ''), value: toNumber(r[valueField]) }))
        .filter((link) => link.source && link.target);
      if (!links.length) return <EmptyHint text="暂无可用桑基数据" />;
      const spec = {
        data: [{ id: 'd', values: links }],
        categoryField: 'name',
        valueField: 'value',
        sourceField: 'source',
        targetField: 'target',
        nodeAlign: 'left' as const,
        color: palette.dataColors,
        label: { visible: true, style: { fill: palette.text1 } },
        tooltip: { visible: true },
      };
      return <SankeyChart {...spec} options={chartOptions} height={chartHeight} />;
    }

    // 词云
    if (widget.type === 'wordCloud') {
      const wordField = o.wordField || o.categoryField;
      const valueField = o.valueFields?.[0];
      if (!wordField || !valueField) return <EmptyHint text="请配置词语字段与权重字段" />;
      const values = rows
        .map((r) => ({ name: String(r[wordField] ?? ''), value: toNumber(r[valueField]) }))
        .filter((item) => item.name);
      if (!values.length) return <EmptyHint text="暂无可用词云数据" />;
      const spec = {
        data: [{ id: 'd', values }],
        nameField: 'name',
        valueField: 'value',
        colorList: palette.dataColors,
        fontSizeRange: [12, 42] as [number, number],
        random: false,
        wordCloudConfig: { zoomToFit: { enlarge: true } },
        tooltip: { visible: true },
      };
      return <WordCloudChart {...spec} options={chartOptions} height={chartHeight} />;
    }

    // 热力图
    if (widget.type === 'heatmap') {
      const valueField = o.valueFields?.[0];
      if (!o.categoryField || !o.yField || !valueField) return <EmptyHint text="请配置 X 字段、Y 字段与值字段" />;
      const heatmapData = rows.map((r) => ({
        [o.categoryField as string]: String(r[o.categoryField as string] ?? ''),
        [o.yField as string]: String(r[o.yField as string] ?? ''),
        [valueField]: toNumber(r[valueField]),
      }));
      const max = Math.max(...heatmapData.map((r) => toNumber(r[valueField])), 0) || 1;
      const spec = {
        data: [{ id: 'd', values: heatmapData }],
        xField: o.categoryField,
        yField: o.yField,
        valueField,
        color: {
          type: 'linear' as const,
          field: valueField,
          domain: [0, max],
          range: [palette.fill1, palette.dataColors[0] ?? palette.primary],
          clamp: true,
        },
        cell: { style: { stroke: palette.border, lineWidth: 1 } },
        axes: [
          { orient: 'bottom' as const, type: 'band' as const },
          { orient: 'left' as const, type: 'band' as const },
        ],
        tooltip: { visible: true },
      };
      return <HeatmapChart {...spec} options={chartOptions} height={chartHeight} />;
    }

    // 地图
    if (widget.type === 'map') {
      const valueField = o.valueFields?.[0];
      if (!o.mapGeojsonUrl) return <EmptyHint text="请配置地图 geojson URL" />;
      if (!o.areaField || !valueField) return <EmptyHint text="请配置区域字段与数值字段" />;
      return (
        <MapChart
          geojsonUrl={o.mapGeojsonUrl}
          mapName={o.mapName}
          areaField={o.areaField}
          valueField={valueField}
          rows={rows}
          height={chartHeight}
          palette={palette}
        />
      );
    }

    // 双轴组合
    if (widget.type === 'dualAxis') {
      const barF = o.valueFields?.[0]; const lineF = o.secondaryFields?.[0];
      if (!o.categoryField || !barF || !lineF) return <EmptyHint text="请配置分类、左轴(柱)、右轴(线)字段" />;
      const cData = rows.map((r) => ({ [o.categoryField as string]: String(r[o.categoryField as string] ?? ''), [barF]: toNumber(r[barF]), [lineF]: toNumber(r[lineF]) }));
      const spec = applyChartTooltipFormatter(
        makeMixedBarLineSpec({ data: cData, xField: o.categoryField, palette, bar: { field: barF, name: barF }, line: { field: lineF, name: lineF } }) as Record<string, unknown>,
        dataFieldMap,
        formatValueByField,
        o.categoryField,
        [barF, lineF],
      );
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
      const spec = applyChartTooltipFormatter(
        makeBarSpec({ data: chartData, xField: o.categoryField, series, palette, stack: o.stack || o.percent, horizontal: o.horizontal, showLabel: o.showLabel }) as Record<string, unknown>,
        dataFieldMap,
        formatValueByField,
        o.categoryField,
        valueFields,
      );
      return <BarChart {...spec} options={chartOptions} height={chartHeight} onClick={onChartClick} />;
    }
    if (widget.type === 'area') {
      const spec = applyChartTooltipFormatter(
        makeAreaSpec({ data: chartData, xField: o.categoryField, series, palette, stack: o.stack || o.percent, smooth: o.smooth }) as Record<string, unknown>,
        dataFieldMap,
        formatValueByField,
        o.categoryField,
        valueFields,
      );
      return <AreaChart {...spec} options={chartOptions} height={chartHeight} onClick={onChartClick} />;
    }
    const spec = applyChartTooltipFormatter(
      makeLineSpec({ data: chartData, xField: o.categoryField, series, palette, smooth: o.smooth, point: true }) as Record<string, unknown>,
      dataFieldMap,
      formatValueByField,
      o.categoryField,
      valueFields,
    );
    return <LineChart {...spec} options={chartOptions} height={chartHeight} onClick={onChartClick} />;
  }, [widget, data, loading, error, palette, width, height, chartHeight, filterValues, onCategoryClick, drillPath, fieldDrill, drillFields, dataFieldMap, formatValueByField, onWidgetQueryChange, widgetQuery, localTablePage, localTablePageSize]);

  return (
    <div ref={ref} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {showCrumb && (
        <DrillBreadcrumb
          path={drillPath}
          onJump={(level) => setDrillPath((prev) => prev.slice(0, level))}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{content}</div>
    </div>
  );
}

/** 钻取面包屑：全部 > 值1 > 值2，点击回退到对应层级 */
function DrillBreadcrumb({ path, onJump }: { readonly path: { field: string; value: string }[]; readonly onJump: (level: number) => void }) {
  return (
    <div className="report-drill-crumb">
      <button type="button" className="report-drill-crumb__item" onClick={() => onJump(0)}>全部</button>
      {path.map((p, i) => (
        <span key={`${p.field}-${p.value}`} className="report-drill-crumb__seg">
          <span className="report-drill-crumb__sep">/</span>
          {i === path.length - 1 ? (
            <span className="report-drill-crumb__current">{p.value}</span>
          ) : (
            <button type="button" className="report-drill-crumb__item" onClick={() => onJump(i + 1)}>{p.value}</button>
          )}
        </span>
      ))}
    </div>
  );
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────
function formatFlipperNumber(value: number, digits?: number, decimals?: number): string {
  const safeDecimals = Math.max(0, decimals ?? 0);
  const fixed = Math.abs(value).toFixed(safeDecimals);
  const [rawInteger, fraction] = fixed.split('.');
  const padded = digits && digits > 0 ? rawInteger.padStart(digits, '0') : rawInteger;
  const grouped = padded.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

function FlipperDigit({ digit }: { readonly digit: string }) {
  const value = Number(digit);
  const height = 44;
  return (
    <span
      style={{
        display: 'inline-block',
        width: 34,
        height,
        overflow: 'hidden',
        borderRadius: 'var(--semi-border-radius-medium)',
        background: 'linear-gradient(180deg, #142753 0%, #0e1b3a 100%)',
        // eslint-disable-next-line no-restricted-syntax -- 数据大屏翻牌器：深色主题设计件，inset 高光 + 定制投影
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 18px rgba(0,0,0,0.18)',
        border: '1px solid rgba(90,216,255,0.22)',
        verticalAlign: 'middle',
      }}
    >
      <span
        style={{
          display: 'block',
          transform: `translateY(${-value * height}px)`,
          transition: 'transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        {'0123456789'.split('').map((n) => (
          <span
            key={n}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height,
              color: '#5ad8ff',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 30,
              fontWeight: 800,
              lineHeight: `${height}px`,
              textShadow: '0 0 12px rgba(90,216,255,0.45)',
            }}
          >
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

function Flipper({ value, digits, decimals, prefix, unit }: { readonly value: number; readonly digits?: number; readonly decimals?: number; readonly prefix?: string; readonly unit?: string }) {
  const chars = `${prefix ?? ''}${formatFlipperNumber(value, digits, decimals)}${unit ?? ''}`.split('');
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
        {chars.map((ch, i) => (
          /\d/.test(ch) ? (
            <FlipperDigit key={i} digit={ch} />
          ) : (
            <span
              key={i}
              style={{
                color: 'var(--semi-color-text-0)',
                fontSize: ch === ',' ? 24 : 26,
                fontWeight: 700,
                lineHeight: '44px',
                padding: ch.trim() ? '0 1px' : '0 4px',
              }}
            >
              {ch}
            </span>
          )
        ))}
      </div>
    </div>
  );
}

function ScrollList({ rows, cat, val, speed, showRank, onClick }: { readonly rows: Record<string, unknown>[]; readonly cat: string; readonly val: string; readonly speed?: number; readonly showRank?: boolean; readonly onClick?: (v: string) => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const max = Math.max(...rows.map((r) => toNumber(r[val])), 0) || 1;
  const scrollSpeed = Math.max(0, speed ?? 0);

  useEffect(() => {
    setOffset(0);
    const update = () => {
      const viewport = viewportRef.current;
      const list = listRef.current;
      setCanScroll(!!viewport && !!list && scrollSpeed > 0 && list.scrollHeight > viewport.clientHeight + 1);
    };
    update();
    const ro = new ResizeObserver(update);
    if (viewportRef.current) ro.observe(viewportRef.current);
    if (listRef.current) ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [rows, scrollSpeed]);

  useEffect(() => {
    if (!canScroll || scrollSpeed <= 0 || paused) return;
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      const listHeight = listRef.current?.scrollHeight ?? 0;
      const rowHeight = rows.length ? listHeight / rows.length : 32;
      if (last && listHeight > 0) {
        const delta = ((ts - last) / 1000) * scrollSpeed * rowHeight;
        setOffset((prev) => (prev + delta) % listHeight);
      }
      last = ts;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [canScroll, paused, rows.length, scrollSpeed]);

  const renderRows = (duplicate = false) => (
    <div ref={duplicate ? undefined : listRef}>
      {rows.map((r, i) => {
        const name = String(r[cat] ?? '');
        const value = toNumber(r[val]);
        const pct = Math.max(0, Math.min(100, (value / max) * 100));
        const rankColor = i === 0 ? '#f7ba1e' : i === 1 ? '#c9cdd4' : i === 2 ? '#b87333' : 'var(--semi-color-fill-2)';
        return (
          <div
            key={`${duplicate ? 'd' : 'r'}-${i}-${name}`}
            onClick={onClick ? () => onClick(name) : undefined}
            style={{
              padding: '8px 4px',
              cursor: onClick ? 'pointer' : 'default',
              borderBottom: '1px solid var(--semi-color-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {showRank ? (
                <span
                  style={{
                    flex: '0 0 24px',
                    height: 22,
                    borderRadius: 'var(--semi-border-radius-large)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: i < 3 ? '#101828' : 'var(--semi-color-text-1)',
                    background: rankColor,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {i + 1}
                </span>
              ) : null}
              <span style={{ flex: 1, minWidth: 0, color: 'var(--semi-color-text-0)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <span style={{ color: 'var(--semi-color-text-1)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fmtNumber(value)}</span>
            </div>
            <div style={{ height: 3, marginTop: 6, borderRadius: 999, background: 'var(--semi-color-fill-1)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--semi-color-primary), #5ad8ff)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      ref={viewportRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ height: '100%', overflowY: canScroll ? 'hidden' : 'auto', padding: '0 4px' }}
    >
      <div style={{ transform: canScroll ? `translateY(${-offset}px)` : undefined, willChange: canScroll ? 'transform' : undefined }}>
        {renderRows()}
        {canScroll ? renderRows(true) : null}
      </div>
    </div>
  );
}

function MapChart({ geojsonUrl, mapName, areaField, valueField, rows, height, palette }: { readonly geojsonUrl: string; readonly mapName?: string; readonly areaField: string; readonly valueField: string; readonly rows: Record<string, unknown>[]; readonly height: number; readonly palette: ChartPalette }) {
  const name = mapName?.trim() || geojsonUrl;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(registeredMapNames.has(name) ? 'ready' : 'loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    if (registeredMapNames.has(name)) {
      setStatus('ready');
      setMessage('');
      return;
    }
    setStatus('loading');
    setMessage('');
    fetch(geojsonUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then((geojson) => {
        VChartCore.registerMap(name, geojson);
        registeredMapNames.add(name);
        if (alive) setStatus('ready');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setMessage(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [geojsonUrl, name]);

  const values = useMemo(() => rows.map((r) => ({ name: String(r[areaField] ?? ''), value: toNumber(r[valueField]) })), [areaField, rows, valueField]);
  const max = Math.max(...values.map((v) => v.value), 0) || 1;
  const spec = useMemo(() => ({
    type: 'map',
    map: name,
    data: [{ id: 'd', values }],
    region: [{ roam: false }],
    color: {
      type: 'linear',
      field: 'value',
      domain: [0, max],
      range: [palette.dataColors[1] ?? '#9bdcff', palette.dataColors[0] ?? palette.primary],
      clamp: true,
    },
    series: [{
      type: 'map',
      map: name,
      nameField: 'name',
      valueField: 'value',
      dataKey: 'name',
      defaultFillColor: palette.fill1,
      area: {
        style: {
          fill: { field: 'value', scale: 'color' },
          stroke: palette.border,
          lineWidth: 1,
        },
      },
      label: {
        visible: true,
        style: { fill: palette.text1, fontSize: 10 },
      },
    }],
    legends: { visible: true },
    tooltip: { visible: true },
  }) as ISpec & { map: string }, [max, name, palette.border, palette.dataColors, palette.fill1, palette.primary, palette.text1, values]);

  if (status === 'loading') return <EmptyHint text="加载地图中…" />;
  if (status === 'error') return <EmptyHint text={`地图加载失败：${message}`} />;
  return <VChartReact spec={spec} options={chartOptions} style={{ width: '100%', height }} />;
}

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
            <div style={{ margin: '2px auto', width: `${Math.max(8, pct)}%`, height: 18, background: `var(--semi-color-primary)`, opacity: 0.4 + 0.6 * (pct / 100), borderRadius: 'var(--semi-border-radius-small)' }} />
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
  const aggOf = (rs: Record<string, unknown>[]) => aggregateReportRows(rs, valField, agg);
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
