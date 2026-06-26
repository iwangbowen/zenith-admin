import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Input, Select, Spin, Toast, Typography, Empty, Space } from '@douyinfe/semi-ui';
import { Save, ArrowLeft, Eye, Trash2 } from 'lucide-react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import '../report-grid.css';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { WidgetRenderer, WIDGET_TYPES, type WidgetTypeMeta } from '../widgets/WidgetRenderer';
import { useDatasetDataMap } from '../widgets/useDatasetData';
import type {
  ReportDashboard, ReportDataset, ReportWidget, ReportWidgetType, ReportGridItem, ReportWidgetOptions,
} from '@zenith/shared';

const GridLayout = WidthProvider(RGL);
const COLS = 12;
const ROW_HEIGHT = 40;

const AGG_OPTIONS = [
  { value: 'sum', label: '求和' }, { value: 'avg', label: '平均' },
  { value: 'max', label: '最大' }, { value: 'min', label: '最小' },
  { value: 'count', label: '计数' }, { value: 'first', label: '首行' },
];

function genId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function defaultOptions(type: ReportWidgetType): ReportWidgetOptions {
  return type === 'kpi' ? { aggregate: 'sum' } : {};
}

function cleanLayout(l: Layout): ReportGridItem[] {
  return l.map((it) => ({
    i: it.i, x: it.x, y: it.y, w: it.w, h: it.h,
    ...(it.minW ? { minW: it.minW } : {}), ...(it.minH ? { minH: it.minH } : {}),
  }));
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
  const [layout, setLayout] = useState<Layout>([]);
  const [widgets, setWidgets] = useState<ReportWidget[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<ReportDataset[]>([]);

  const datasetIds = useMemo(() => widgets.map((w) => w.datasetId ?? 0).filter((x) => x > 0), [widgets]);
  const { get: getData } = useDatasetDataMap(datasetIds);

  useEffect(() => {
    if (!dashboardId) return;
    setLoading(true);
    Promise.all([
      request.get<ReportDashboard>(`/api/report/dashboards/${dashboardId}`),
      request.get<{ list: ReportDataset[] }>('/api/report/datasets?page=1&pageSize=200'),
    ]).then(([dRes, dsRes]) => {
      if (dRes.code === 0) {
        setName(dRes.data.name);
        setStatus(dRes.data.status);
        setRemark(dRes.data.remark ?? null);
        setWidgets(dRes.data.widgets ?? []);
        setLayout((dRes.data.layout ?? []) as Layout);
      } else {
        Toast.error(dRes.message || '加载失败');
      }
      if (dsRes.code === 0) setDatasets(dsRes.data.list.filter((d) => d.status === 'enabled'));
    }).finally(() => setLoading(false));
  }, [dashboardId]);

  const nextY = useMemo(() => layout.reduce((max, it) => Math.max(max, it.y + it.h), 0), [layout]);

  const addWidget = useCallback((meta: WidgetTypeMeta) => {
    const i = genId();
    const w: ReportWidget = { i, type: meta.type, title: meta.label, datasetId: null, options: defaultOptions(meta.type) };
    const item: Layout[number] = { i, x: 0, y: nextY, w: meta.defaultSize.w, h: meta.defaultSize.h, minW: 2, minH: 2 };
    setWidgets((ws) => [...ws, w]);
    setLayout((l) => [...l, item]);
    setSelectedId(i);
  }, [nextY]);

  const removeWidget = useCallback((i: string) => {
    setWidgets((ws) => ws.filter((w) => w.i !== i));
    setLayout((l) => l.filter((it) => it.i !== i));
    setSelectedId((cur) => (cur === i ? null : cur));
  }, []);

  const patchWidget = useCallback((i: string, patch: Partial<ReportWidget>) => {
    setWidgets((ws) => ws.map((w) => (w.i === i ? { ...w, ...patch } : w)));
  }, []);
  const patchOptions = useCallback((i: string, optPatch: Partial<ReportWidgetOptions>) => {
    setWidgets((ws) => ws.map((w) => (w.i === i ? { ...w, options: { ...w.options, ...optPatch } } : w)));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { name, status, remark: remark || undefined, layout: cleanLayout(layout), widgets };
      const res = await request.put(`/api/report/dashboards/${dashboardId}`, payload);
      if (res.code === 0) Toast.success('已保存');
    } finally { setSaving(false); }
  }

  const selectedWidget = widgets.find((w) => w.i === selectedId) ?? null;
  const selectedDataset = datasets.find((d) => d.id === selectedWidget?.datasetId) ?? null;

  // 字段选项：优先用数据集已定义字段，否则用已取数的列名
  const fieldOptions = useMemo(() => {
    if (!selectedWidget) return [];
    if (selectedDataset?.fields?.length) return selectedDataset.fields.map((f) => ({ value: f.name, label: f.label || f.name }));
    const cols = getData(selectedWidget.datasetId).data?.columns ?? [];
    return cols.map((c) => ({ value: c, label: c }));
  }, [selectedWidget, selectedDataset, getData]);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" /></div>;
  }

  return (
    <div className="report-designer">
      <div className="report-designer__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={() => navigate('/report/dashboards')}>返回</Button>
        <Input value={name} onChange={setName} style={{ width: 240 }} placeholder="仪表盘名称" />
        <div style={{ flex: 1 }} />
        <Button icon={<Eye size={16} />} onClick={() => navigate(`/report/dashboards/${dashboardId}/view`)}>预览</Button>
        <Button type="primary" icon={<Save size={16} />} loading={saving} disabled={!canSave} onClick={handleSave}>保存</Button>
      </div>

      <div className="report-designer__main">
        {/* 左：组件面板 */}
        <div className="report-designer__palette">
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>拖入组件</Typography.Text>
          {WIDGET_TYPES.map((meta) => {
            const Icon = meta.icon;
            return (
              <div key={meta.type} className="report-palette-item" onClick={() => addWidget(meta)} role="button" tabIndex={0}>
                <Icon size={15} />{meta.label}
              </div>
            );
          })}
        </div>

        {/* 中：画布 */}
        <div className="report-designer__canvas">
          {widgets.length === 0 ? (
            <Empty description="点击左侧组件添加到画布" style={{ paddingTop: 80 }} />
          ) : (
            <GridLayout
              className="report-grid"
              layout={layout}
              cols={COLS}
              rowHeight={ROW_HEIGHT}
              margin={[12, 12]}
              draggableHandle=".report-widget-card__drag"
              isDraggable={canSave}
              isResizable={canSave}
              compactType="vertical"
              onLayoutChange={(l) => setLayout(l)}
            >
              {widgets.map((w) => {
                const ds = getData(w.datasetId);
                const isSel = w.i === selectedId;
                return (
                  <div key={w.i} className={isSel ? 'report-widget--selected' : ''} onMouseDownCapture={() => setSelectedId(w.i)}>
                    <div className="report-widget-card">
                      <div className="report-widget-card__header report-widget-card__drag">
                        <span className="report-widget-card__title">{w.title || '未命名组件'}</span>
                        <div className="report-widget-card__actions">
                          <Button theme="borderless" size="small" type="danger" icon={<Trash2 size={13} />}
                            onClick={(e) => { e.stopPropagation(); removeWidget(w.i); }} aria-label="删除组件" />
                        </div>
                      </div>
                      <div className="report-widget-card__body">
                        <WidgetRenderer widget={w} data={ds.data} loading={ds.loading} error={ds.error} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </GridLayout>
          )}
        </div>

        {/* 右：配置面板 */}
        <div className="report-designer__config">
          {!selectedWidget ? (
            <Empty description="选择一个组件进行配置" style={{ paddingTop: 40 }} />
          ) : (
            <ConfigPanel
              key={selectedWidget.i}
              widget={selectedWidget}
              datasets={datasets}
              fieldOptions={fieldOptions}
              onChangeTitle={(v) => patchWidget(selectedWidget.i, { title: v })}
              onChangeDataset={(v) => patchWidget(selectedWidget.i, { datasetId: v })}
              onChangeOptions={(p) => patchOptions(selectedWidget.i, p)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 配置面板 ────────────────────────────────────────────────────────────────
interface ConfigPanelProps {
  widget: ReportWidget;
  datasets: ReportDataset[];
  fieldOptions: { value: string; label: string }[];
  onChangeTitle: (v: string) => void;
  onChangeDataset: (v: number | null) => void;
  onChangeOptions: (patch: Partial<ReportWidgetOptions>) => void;
}

function ConfigPanel({ widget, datasets, fieldOptions, onChangeTitle, onChangeDataset, onChangeOptions }: Readonly<ConfigPanelProps>) {
  const o = widget.options ?? {};
  const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--semi-color-text-1)' } as const;
  const blockStyle = { marginBottom: 14 } as const;

  return (
    <Space vertical align="start" style={{ width: '100%' }}>
      <Typography.Title heading={6} style={{ margin: '0 0 4px' }}>组件配置 · {WIDGET_TYPES.find((t) => t.type === widget.type)?.label}</Typography.Title>

      <div style={{ ...blockStyle, width: '100%' }}>
        <span style={labelStyle}>标题</span>
        <Input value={widget.title} onChange={onChangeTitle} maxLength={128} showClear />
      </div>

      <div style={{ ...blockStyle, width: '100%' }}>
        <span style={labelStyle}>数据集</span>
        <Select style={{ width: '100%' }} value={widget.datasetId ?? undefined} placeholder="选择数据集" showClear
          onChange={(v) => onChangeDataset((v as number) ?? null)}
          optionList={datasets.map((d) => ({ value: d.id, label: d.name }))} />
      </div>

      {widget.type === 'kpi' && (
        <>
          <div style={{ ...blockStyle, width: '100%' }}>
            <span style={labelStyle}>取值字段</span>
            <Select style={{ width: '100%' }} value={o.valueField} placeholder="选择字段" showClear
              onChange={(v) => onChangeOptions({ valueField: v as string })} optionList={fieldOptions} />
          </div>
          <div style={{ ...blockStyle, width: '100%' }}>
            <span style={labelStyle}>聚合方式</span>
            <Select style={{ width: '100%' }} value={o.aggregate ?? 'sum'} onChange={(v) => onChangeOptions({ aggregate: v as ReportWidgetOptions['aggregate'] })} optionList={AGG_OPTIONS} />
          </div>
          <div style={{ ...blockStyle, width: '100%' }}>
            <span style={labelStyle}>单位（后缀）</span>
            <Input value={o.unit ?? ''} onChange={(v) => onChangeOptions({ unit: v })} placeholder="如 元 / 人" showClear />
          </div>
        </>
      )}

      {(widget.type === 'bar' || widget.type === 'line') && (
        <>
          <div style={{ ...blockStyle, width: '100%' }}>
            <span style={labelStyle}>分类字段（X 轴）</span>
            <Select style={{ width: '100%' }} value={o.categoryField} placeholder="选择字段" showClear
              onChange={(v) => onChangeOptions({ categoryField: v as string })} optionList={fieldOptions} />
          </div>
          <div style={{ ...blockStyle, width: '100%' }}>
            <span style={labelStyle}>指标字段（Y 轴，可多选）</span>
            <Select multiple style={{ width: '100%' }} value={o.valueFields ?? []} placeholder="选择字段" showClear
              onChange={(v) => onChangeOptions({ valueFields: (v as string[]) ?? [] })} optionList={fieldOptions} />
          </div>
        </>
      )}

      {widget.type === 'pie' && (
        <>
          <div style={{ ...blockStyle, width: '100%' }}>
            <span style={labelStyle}>分类字段</span>
            <Select style={{ width: '100%' }} value={o.categoryField} placeholder="选择字段" showClear
              onChange={(v) => onChangeOptions({ categoryField: v as string })} optionList={fieldOptions} />
          </div>
          <div style={{ ...blockStyle, width: '100%' }}>
            <span style={labelStyle}>指标字段</span>
            <Select style={{ width: '100%' }} value={o.valueFields?.[0]} placeholder="选择字段" showClear
              onChange={(v) => onChangeOptions({ valueFields: v ? [v as string] : [] })} optionList={fieldOptions} />
          </div>
        </>
      )}

      {widget.type === 'table' && (
        <Typography.Text type="tertiary" size="small">表格默认展示数据集全部列。</Typography.Text>
      )}
    </Space>
  );
}
