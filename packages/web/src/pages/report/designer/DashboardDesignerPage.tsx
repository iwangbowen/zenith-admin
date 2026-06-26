import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Input, Select, Spin, Toast, Typography, Empty, Tooltip } from '@douyinfe/semi-ui';
import { Save, ArrowLeft, Eye, Trash2, Copy, Undo2, Redo2, SlidersHorizontal } from 'lucide-react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import '../report-grid.css';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { WidgetRenderer } from '../widgets/WidgetRenderer';
import { WIDGET_TYPES, type WidgetTypeMeta } from '../widgets/widget-meta';
import { useWidgetData } from '../widgets/useWidgetData';
import { FilterBar } from '../widgets/FilterBar';
import { ConfigPanel } from './ConfigPanel';
import { FilterConfigModal } from './FilterConfigModal';
import type {
  ReportDashboard, ReportDataset, ReportWidget, ReportWidgetType, ReportGridItem,
  ReportWidgetOptions, ReportFilter, ReportDashboardConfig,
} from '@zenith/shared';

const GridLayout = WidthProvider(RGL);
const COLS = 12;
const ROW_HEIGHT = 40;

interface Doc { layout: Layout; widgets: ReportWidget[]; filters: ReportFilter[]; config: ReportDashboardConfig }

function genId(): string { return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }
function defaultOptions(type: ReportWidgetType): ReportWidgetOptions { return type === 'kpi' || type === 'gauge' ? { aggregate: 'sum' } : {}; }
function cleanLayout(l: Layout): ReportGridItem[] {
  return l.map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, ...(it.minW ? { minW: it.minW } : {}), ...(it.minH ? { minH: it.minH } : {}) }));
}
function defaultFilterValue(f: ReportFilter): unknown {
  if (f.defaultValue !== undefined) return f.defaultValue;
  return f.type === 'multiSelect' ? [] : undefined;
}

export default function DashboardDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const dashboardId = Number(id);
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canSave = hasPermission('report:dashboard:update');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'enabled' | 'disabled'>('enabled');
  const [remark, setRemark] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc>({ layout: [], widgets: [], filters: [], config: {} });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<ReportDataset[]>([]);
  const [dashboards, setDashboards] = useState<{ id: number; name: string }[]>([]);
  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const [filterModal, setFilterModal] = useState(false);

  const docRef = useRef(doc); docRef.current = doc;
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);

  const mutate = useCallback((updater: (d: Doc) => Doc, record = true) => {
    setDoc((cur) => {
      if (record) { past.current.push(cur); if (past.current.length > 60) past.current.shift(); future.current = []; }
      return updater(cur);
    });
  }, []);
  const snapshot = useCallback(() => { past.current.push(docRef.current); if (past.current.length > 60) past.current.shift(); future.current = []; }, []);
  const undo = useCallback(() => { const prev = past.current.pop(); if (!prev) return; future.current.push(docRef.current); setDoc(prev); }, []);
  const redo = useCallback(() => { const next = future.current.pop(); if (!next) return; past.current.push(docRef.current); setDoc(next); }, []);

  const { get: getData } = useWidgetData(doc.widgets, filterValues);

  useEffect(() => {
    if (!dashboardId) return;
    setLoading(true);
    Promise.all([
      request.get<ReportDashboard>(`/api/report/dashboards/${dashboardId}`),
      request.get<{ list: ReportDataset[] }>('/api/report/datasets?page=1&pageSize=200'),
      request.get<{ list: { id: number; name: string }[] }>('/api/report/dashboards?page=1&pageSize=200'),
    ]).then(([dRes, dsRes, dashRes]) => {
      if (dRes.code === 0) {
        setName(dRes.data.name); setStatus(dRes.data.status); setRemark(dRes.data.remark ?? null);
        setDoc({ layout: (dRes.data.layout ?? []) as Layout, widgets: dRes.data.widgets ?? [], filters: dRes.data.filters ?? [], config: dRes.data.config ?? {} });
        const fv: Record<string, unknown> = {};
        for (const f of dRes.data.filters ?? []) fv[f.id] = defaultFilterValue(f);
        setFilterValues(fv);
      } else Toast.error(dRes.message || '加载失败');
      if (dsRes.code === 0) setDatasets(dsRes.data.list.filter((d) => d.status === 'enabled'));
      if (dashRes.code === 0) setDashboards(dashRes.data.list.filter((d) => d.id !== dashboardId));
    }).finally(() => setLoading(false));
  }, [dashboardId]);

  const nextY = useMemo(() => doc.layout.reduce((max, it) => Math.max(max, it.y + it.h), 0), [doc.layout]);

  const addWidget = useCallback((meta: WidgetTypeMeta) => {
    const i = genId();
    const w: ReportWidget = { i, type: meta.type, title: meta.label, datasetId: null, options: defaultOptions(meta.type) };
    const item: Layout[number] = { i, x: 0, y: nextY, w: meta.defaultSize.w, h: meta.defaultSize.h, minW: 2, minH: 2 };
    mutate((d) => ({ ...d, widgets: [...d.widgets, w], layout: [...d.layout, item] }));
    setSelectedId(i);
  }, [nextY, mutate]);

  const removeWidget = useCallback((i: string) => {
    mutate((d) => ({ ...d, widgets: d.widgets.filter((w) => w.i !== i), layout: d.layout.filter((it) => it.i !== i) }));
    setSelectedId((cur) => (cur === i ? null : cur));
  }, [mutate]);

  const copyWidget = useCallback((i: string) => {
    const ni = genId();
    mutate((d) => {
      const w = d.widgets.find((x) => x.i === i); const it = d.layout.find((x) => x.i === i);
      if (!w || !it) return d;
      return { ...d, widgets: [...d.widgets, { ...w, i: ni, title: `${w.title} 副本` }], layout: [...d.layout, { ...it, i: ni, x: 0, y: nextY }] };
    });
    setSelectedId(ni);
  }, [mutate, nextY]);

  const patchWidget = useCallback((i: string, patch: Partial<ReportWidget>) => {
    mutate((d) => ({ ...d, widgets: d.widgets.map((w) => (w.i === i ? { ...w, ...patch } : w)) }));
  }, [mutate]);
  const patchOptions = useCallback((i: string, optPatch: Partial<ReportWidgetOptions>) => {
    mutate((d) => ({ ...d, widgets: d.widgets.map((w) => (w.i === i ? { ...w, options: { ...w.options, ...optPatch } } : w)) }));
  }, [mutate]);

  const onFiltersChange = useCallback((filters: ReportFilter[]) => {
    mutate((d) => ({ ...d, filters }));
    setFilterValues((prev) => { const fv: Record<string, unknown> = {}; for (const f of filters) fv[f.id] = f.id in prev ? prev[f.id] : defaultFilterValue(f); return fv; });
  }, [mutate]);

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { name, status, remark: remark || undefined, layout: cleanLayout(doc.layout), widgets: doc.widgets, filters: doc.filters, config: doc.config };
      const res = await request.put(`/api/report/dashboards/${dashboardId}`, payload);
      if (res.code === 0) Toast.success('已保存');
    } finally { setSaving(false); }
  }

  const selectedWidget = doc.widgets.find((w) => w.i === selectedId) ?? null;
  const selectedDataset = datasets.find((d) => d.id === selectedWidget?.datasetId) ?? null;
  const fieldOptions = useMemo(() => {
    if (!selectedWidget) return [];
    if (selectedDataset?.fields?.length) return selectedDataset.fields.map((f) => ({ value: f.name, label: f.label || f.name }));
    const cols = selectedWidget.datasetId ? getData(selectedWidget).data?.columns ?? [] : [];
    return cols.map((c) => ({ value: c, label: c }));
  }, [selectedWidget, selectedDataset, getData]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" /></div>;

  return (
    <div className="report-designer">
      <div className="report-designer__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={() => navigate('/report/dashboards')}>返回</Button>
        <Input value={name} onChange={setName} style={{ width: 220 }} placeholder="仪表盘名称" />
        <Tooltip content="撤销"><Button icon={<Undo2 size={16} />} theme="borderless" onClick={undo} /></Tooltip>
        <Tooltip content="重做"><Button icon={<Redo2 size={16} />} theme="borderless" onClick={redo} /></Tooltip>
        <Button icon={<SlidersHorizontal size={16} />} onClick={() => setFilterModal(true)}>筛选器 {doc.filters.length ? `(${doc.filters.length})` : ''}</Button>
        <Select value={doc.config.theme ?? 'light'} style={{ width: 100 }} onChange={(v) => mutate((d) => ({ ...d, config: { ...d.config, theme: v as 'light' | 'dark' } }))}
          optionList={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} />
        <div style={{ flex: 1 }} />
        <Button icon={<Eye size={16} />} onClick={() => navigate(`/report/dashboards/${dashboardId}/view`)}>预览</Button>
        <Button type="primary" icon={<Save size={16} />} loading={saving} disabled={!canSave} onClick={handleSave}>保存</Button>
      </div>

      <div className="report-designer__main">
        <div className="report-designer__palette">
          {['指标', '表格', '图表', '其它'].map((g) => (
            <div key={g}>
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '8px 0 6px' }}>{g}</Typography.Text>
              {WIDGET_TYPES.filter((m) => m.group === g).map((meta) => {
                const Icon = meta.icon;
                return (
                  <div key={meta.type} className="report-palette-item" onClick={() => addWidget(meta)} role="button" tabIndex={0}>
                    <Icon size={15} />{meta.label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="report-designer__canvas" style={doc.config.theme === 'dark' ? { background: '#0b1020' } : undefined}>
          <FilterBar filters={doc.filters} values={filterValues} onChange={(fid, val) => setFilterValues((p) => ({ ...p, [fid]: val }))} />
          {doc.widgets.length === 0 ? (
            <Empty description="点击左侧组件添加到画布" style={{ paddingTop: 60 }} />
          ) : (
            <GridLayout
              className="report-grid" layout={doc.layout} cols={COLS} rowHeight={ROW_HEIGHT} margin={[12, 12]}
              draggableHandle=".report-widget-card__drag" isDraggable={canSave} isResizable={canSave} compactType="vertical"
              onDragStart={snapshot} onResizeStart={snapshot}
              onLayoutChange={(l) => mutate((d) => ({ ...d, layout: l }), false)}
            >
              {doc.widgets.map((w) => {
                const ds = getData(w);
                const isSel = w.i === selectedId;
                return (
                  <div key={w.i} className={isSel ? 'report-widget--selected' : ''} onMouseDownCapture={() => setSelectedId(w.i)}>
                    <div className="report-widget-card">
                      <div className="report-widget-card__header report-widget-card__drag">
                        <span className="report-widget-card__title">{w.title || '未命名组件'}</span>
                        <div className="report-widget-card__actions">
                          <Button theme="borderless" size="small" icon={<Copy size={13} />} onClick={(e) => { e.stopPropagation(); copyWidget(w.i); }} aria-label="复制" />
                          <Button theme="borderless" size="small" type="danger" icon={<Trash2 size={13} />} onClick={(e) => { e.stopPropagation(); removeWidget(w.i); }} aria-label="删除" />
                        </div>
                      </div>
                      <div className="report-widget-card__body">
                        <WidgetRenderer widget={w} data={ds.data} loading={ds.loading} error={ds.error} filterValues={filterValues} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </GridLayout>
          )}
        </div>

        <div className="report-designer__config">
          {!selectedWidget ? (
            <Empty description="选择一个组件进行配置" style={{ paddingTop: 40 }} />
          ) : (
            <ConfigPanel
              key={selectedWidget.i}
              widget={selectedWidget}
              datasets={datasets}
              dashboards={dashboards}
              fieldOptions={fieldOptions}
              filters={doc.filters}
              datasetParams={selectedDataset?.params ?? []}
              onPatch={(patch) => patchWidget(selectedWidget.i, patch)}
              onOptions={(patch) => patchOptions(selectedWidget.i, patch)}
            />
          )}
        </div>
      </div>

      <FilterConfigModal visible={filterModal} filters={doc.filters} datasets={datasets} onChange={onFiltersChange} onClose={() => setFilterModal(false)} />
    </div>
  );
}
