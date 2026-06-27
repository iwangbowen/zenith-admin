import { Select, Input, InputNumber, Switch, Typography, Button, Space, TextArea } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { ReportWidget, ReportWidgetOptions, ReportDataset, ReportFilter, ReportDatasetParam, ReportConditionalFormat } from '@zenith/shared';

type FieldOption = { value: string; label: string };

interface ConfigPanelProps {
  widget: ReportWidget;
  datasets: ReportDataset[];
  dashboards: { id: number; name: string }[];
  fieldOptions: FieldOption[];
  filters: ReportFilter[];
  datasetParams: ReportDatasetParam[];
  onPatch: (patch: Partial<ReportWidget>) => void;
  onOptions: (patch: Partial<ReportWidgetOptions>) => void;
}

const AGG = [
  { value: 'sum', label: '求和' }, { value: 'avg', label: '平均' }, { value: 'max', label: '最大' },
  { value: 'min', label: '最小' }, { value: 'count', label: '计数' }, { value: 'first', label: '首行' },
];
const OPS = [
  { value: 'gte', label: '≥' }, { value: 'lte', label: '≤' }, { value: 'gt', label: '>' },
  { value: 'lt', label: '<' }, { value: 'eq', label: '=' }, { value: 'neq', label: '≠' }, { value: 'between', label: '介于' },
];

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', marginBottom: 12 }}>
      <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--semi-color-text-1)' }}>{label}</span>
      {children}
    </div>
  );
}

const full = { width: '100%' } as const;

export function ConfigPanel({ widget, datasets, dashboards, fieldOptions, filters, datasetParams, onPatch, onOptions }: Readonly<ConfigPanelProps>) {
  const o = widget.options ?? {};
  const t = widget.type;
  const isCartesian = t === 'bar' || t === 'line' || t === 'area';
  const isDatasetIndependent = t === 'text' || t === 'image' || t === 'iframe';
  const filterOpts = filters.map((f) => ({ value: f.id, label: f.label || f.id }));

  function setBinding(param: string, filterId: string | undefined) {
    const list = (widget.paramBindings ?? []).filter((b) => b.param !== param);
    if (filterId) list.push({ filterId, param });
    onPatch({ paramBindings: list });
  }
  function setFormat(idx: number, patch: Partial<ReportConditionalFormat>) {
    const list = [...(o.conditionalFormats ?? [])];
    list[idx] = { ...list[idx], ...patch };
    onOptions({ conditionalFormats: list });
  }

  return (
    <Space vertical align="start" style={full}>
      <Typography.Title heading={6} style={{ margin: '0 0 4px' }}>组件配置</Typography.Title>

      <Field label="标题"><Input value={widget.title} onChange={(v) => onPatch({ title: v })} maxLength={128} showClear /></Field>

      {t === 'text' && (
        <Field label="文本内容（支持 ${筛选器id} 占位）">
          <TextArea value={o.text ?? ''} onChange={(v) => onOptions({ text: v })} autosize={{ minRows: 3, maxRows: 8 }} />
        </Field>
      )}
      {t === 'image' && (
        <>
          <Field label="图片地址（支持 ${筛选器id} 占位）"><Input value={o.src ?? ''} onChange={(v) => onOptions({ src: v })} showClear /></Field>
          <Field label="填充方式">
            <Select
              style={full}
              value={o.fit ?? 'contain'}
              onChange={(v) => onOptions({ fit: v as ReportWidgetOptions['fit'] })}
              optionList={[
                { value: 'contain', label: '等比完整显示' },
                { value: 'cover', label: '等比铺满裁剪' },
                { value: 'fill', label: '拉伸填充' },
              ]}
            />
          </Field>
        </>
      )}
      {t === 'iframe' && (
        <Field label="网页地址（支持 ${筛选器id} 占位）"><Input value={o.src ?? ''} onChange={(v) => onOptions({ src: v })} showClear /></Field>
      )}
      {!isDatasetIndependent && (
        <Field label="数据集">
          <Select style={full} value={widget.datasetId ?? undefined} placeholder="选择数据集" showClear filter
            onChange={(v) => onPatch({ datasetId: (v as number) ?? null })}
            optionList={datasets.map((d) => ({ value: d.id, label: d.name }))} />
        </Field>
      )}

      {/* ── 字段映射（按类型）── */}
      {(t === 'kpi' || t === 'gauge' || t === 'flipper') && (
        <>
          <Field label="取值字段"><Select style={full} value={o.valueField} placeholder="字段" showClear onChange={(v) => onOptions({ valueField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="聚合方式"><Select style={full} value={o.aggregate ?? 'sum'} onChange={(v) => onOptions({ aggregate: v as ReportWidgetOptions['aggregate'] })} optionList={AGG} /></Field>
          <Field label="单位"><Input value={o.unit ?? ''} onChange={(v) => onOptions({ unit: v })} showClear /></Field>
        </>
      )}
      {t === 'kpi' && (
        <>
          <Field label="对比字段（环比/同比基准）"><Select style={full} value={o.compareField} placeholder="可选" showClear onChange={(v) => onOptions({ compareField: (v as string) || undefined })} optionList={fieldOptions} /></Field>
          <Field label="目标值"><InputNumber style={full} value={o.targetValue} onChange={(v) => onOptions({ targetValue: typeof v === 'number' ? v : undefined })} /></Field>
          <Field label="迷你趋势字段"><Select style={full} value={o.trendField} placeholder="可选" showClear onChange={(v) => onOptions({ trendField: (v as string) || undefined })} optionList={fieldOptions} /></Field>
        </>
      )}
      {t === 'flipper' && (
        <Space style={{ width: '100%' }}>
          <Field label="小数位"><InputNumber style={full} min={0} max={6} value={o.decimals} onChange={(v) => onOptions({ decimals: typeof v === 'number' ? v : undefined })} /></Field>
          <Field label="固定位数"><InputNumber style={full} min={0} value={o.flipDigits} onChange={(v) => onOptions({ flipDigits: typeof v === 'number' ? v : undefined })} /></Field>
        </Space>
      )}
      {t === 'gauge' && (
        <Space style={{ width: '100%' }}>
          <Field label="最小值"><InputNumber style={full} value={o.min ?? 0} onChange={(v) => onOptions({ min: typeof v === 'number' ? v : 0 })} /></Field>
          <Field label="最大值"><InputNumber style={full} value={o.max ?? 100} onChange={(v) => onOptions({ max: typeof v === 'number' ? v : 100 })} /></Field>
        </Space>
      )}
      {t === 'liquid' && (
        <>
          <Field label="取值字段"><Select style={full} value={o.valueField} placeholder="字段" showClear onChange={(v) => onOptions({ valueField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="聚合方式"><Select style={full} value={o.aggregate ?? 'sum'} onChange={(v) => onOptions({ aggregate: v as ReportWidgetOptions['aggregate'] })} optionList={AGG} /></Field>
          <Field label="最大值"><InputNumber style={full} min={0} value={o.max ?? 100} onChange={(v) => onOptions({ max: typeof v === 'number' ? v : 100 })} /></Field>
          <Field label="单位"><Input value={o.unit ?? ''} onChange={(v) => onOptions({ unit: v })} showClear /></Field>
          <Field label="小数位"><InputNumber style={full} min={0} max={6} value={o.decimals} onChange={(v) => onOptions({ decimals: typeof v === 'number' ? v : undefined })} /></Field>
        </>
      )}

      {(isCartesian || t === 'dualAxis' || t === 'pie' || t === 'scatter' || t === 'radar' || t === 'funnel') && (
        <Field label={t === 'scatter' ? 'X 轴字段' : '分类字段'}>
          <Select style={full} value={o.categoryField} placeholder="字段" showClear onChange={(v) => onOptions({ categoryField: v as string })} optionList={fieldOptions} />
        </Field>
      )}
      {isCartesian && (
        <Field label="指标字段（可多选）">
          <Select multiple style={full} value={o.valueFields ?? []} placeholder="字段" showClear onChange={(v) => onOptions({ valueFields: (v as string[]) ?? [] })} optionList={fieldOptions} />
        </Field>
      )}
      {(t === 'pie' || t === 'scatter' || t === 'radar' || t === 'funnel') && (
        <Field label={t === 'scatter' ? 'Y 轴字段' : '指标字段'}>
          <Select style={full} value={o.valueFields?.[0]} placeholder="字段" showClear onChange={(v) => onOptions({ valueFields: v ? [v as string] : [] })} optionList={fieldOptions} />
        </Field>
      )}
      {t === 'dualAxis' && (
        <>
          <Field label="左轴-柱 字段"><Select style={full} value={o.valueFields?.[0]} placeholder="字段" showClear onChange={(v) => onOptions({ valueFields: v ? [v as string] : [] })} optionList={fieldOptions} /></Field>
          <Field label="右轴-线 字段"><Select style={full} value={o.secondaryFields?.[0]} placeholder="字段" showClear onChange={(v) => onOptions({ secondaryFields: v ? [v as string] : [] })} optionList={fieldOptions} /></Field>
        </>
      )}
      {t === 'sankey' && (
        <>
          <Field label="源字段"><Select style={full} value={o.sourceField} placeholder="字段" showClear onChange={(v) => onOptions({ sourceField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="目标字段"><Select style={full} value={o.targetField} placeholder="字段" showClear onChange={(v) => onOptions({ targetField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="值字段"><Select style={full} value={o.valueFields?.[0]} placeholder="字段" showClear onChange={(v) => onOptions({ valueFields: v ? [v as string] : [] })} optionList={fieldOptions} /></Field>
        </>
      )}
      {t === 'heatmap' && (
        <>
          <Field label="X 字段"><Select style={full} value={o.categoryField} placeholder="字段" showClear onChange={(v) => onOptions({ categoryField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="Y 字段"><Select style={full} value={o.yField} placeholder="字段" showClear onChange={(v) => onOptions({ yField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="值字段"><Select style={full} value={o.valueFields?.[0]} placeholder="字段" showClear onChange={(v) => onOptions({ valueFields: v ? [v as string] : [] })} optionList={fieldOptions} /></Field>
        </>
      )}
      {t === 'wordCloud' && (
        <>
          <Field label="词语字段"><Select style={full} value={o.wordField} placeholder="字段" showClear onChange={(v) => onOptions({ wordField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="权重字段"><Select style={full} value={o.valueFields?.[0]} placeholder="字段" showClear onChange={(v) => onOptions({ valueFields: v ? [v as string] : [] })} optionList={fieldOptions} /></Field>
        </>
      )}
      {t === 'scrollList' && (
        <>
          <Field label="名称字段"><Select style={full} value={o.categoryField} placeholder="字段" showClear onChange={(v) => onOptions({ categoryField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="数值字段"><Select style={full} value={o.valueFields?.[0]} placeholder="字段" showClear onChange={(v) => onOptions({ valueFields: v ? [v as string] : [] })} optionList={fieldOptions} /></Field>
          <Field label="滚动速度（行/秒）"><InputNumber style={full} min={0} value={o.scrollSpeed} onChange={(v) => onOptions({ scrollSpeed: typeof v === 'number' ? v : undefined })} /></Field>
          <SwitchRow label="显示排名" checked={!!o.showRank} onChange={(c) => onOptions({ showRank: c })} />
        </>
      )}
      {t === 'map' && (
        <>
          <Field label="geojson URL"><Input value={o.mapGeojsonUrl ?? ''} onChange={(v) => onOptions({ mapGeojsonUrl: v })} showClear /></Field>
          <Field label="地图名称（可选）"><Input value={o.mapName ?? ''} onChange={(v) => onOptions({ mapName: v })} showClear /></Field>
          <Field label="区域字段"><Select style={full} value={o.areaField} placeholder="字段" showClear onChange={(v) => onOptions({ areaField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="数值字段"><Select style={full} value={o.valueFields?.[0]} placeholder="字段" showClear onChange={(v) => onOptions({ valueFields: v ? [v as string] : [] })} optionList={fieldOptions} /></Field>
        </>
      )}

      {/* ── 图表选项 ── */}
      {(isCartesian) && (
        <Space wrap style={{ width: '100%' }}>
          {(t === 'bar' || t === 'area') && <SwitchRow label="堆叠" checked={!!o.stack} onChange={(c) => onOptions({ stack: c })} />}
          {(t === 'bar' || t === 'area') && <SwitchRow label="百分比" checked={!!o.percent} onChange={(c) => onOptions({ percent: c })} />}
          {t === 'bar' && <SwitchRow label="水平" checked={!!o.horizontal} onChange={(c) => onOptions({ horizontal: c })} />}
          {(t === 'line' || t === 'area') && <SwitchRow label="平滑" checked={!!o.smooth} onChange={(c) => onOptions({ smooth: c })} />}
          {t === 'bar' && <SwitchRow label="数据标签" checked={!!o.showLabel} onChange={(c) => onOptions({ showLabel: c })} />}
        </Space>
      )}
      {(isCartesian || t === 'pie' || t === 'funnel') && (
        <Space style={{ width: '100%' }}>
          <Field label="排序字段"><Select style={full} value={o.sortField} placeholder="不排序" showClear onChange={(v) => onOptions({ sortField: (v as string) || undefined })} optionList={fieldOptions} /></Field>
          <Field label="TopN"><InputNumber style={full} min={0} value={o.topN} onChange={(v) => onOptions({ topN: typeof v === 'number' ? v : undefined })} /></Field>
        </Space>
      )}

      {/* ── 表格 ── */}
      {t === 'table' && (
        <>
          <Field label="展示列（留空=全部）">
            <Select multiple style={full} value={(o.columns ?? []).map((c) => c.name)} placeholder="全部字段" showClear
              onChange={(v) => onOptions({ columns: (v as string[]).map((name) => ({ name, label: fieldOptions.find((f) => f.value === name)?.label ?? name, type: 'string' })) })}
              optionList={fieldOptions} />
          </Field>
          <Space>
            <SwitchRow label="合计行" checked={!!o.showSummary} onChange={(c) => onOptions({ showSummary: c })} />
            <Field label="每页行数"><InputNumber style={full} min={0} value={o.pageSize} onChange={(v) => onOptions({ pageSize: typeof v === 'number' ? v : undefined })} /></Field>
          </Space>
          <Field label="条件格式">
            <Space vertical align="start" style={full}>
              {(o.conditionalFormats ?? []).map((cf, i) => (
                <Space key={i} spacing={4} style={{ width: '100%' }}>
                  <Select size="small" style={{ width: 80 }} value={cf.field} onChange={(v) => setFormat(i, { field: v as string })} optionList={fieldOptions} placeholder="列" />
                  <Select size="small" style={{ width: 64 }} value={cf.op} onChange={(v) => setFormat(i, { op: v as ReportConditionalFormat['op'] })} optionList={OPS} />
                  <InputNumber size="small" style={{ width: 70 }} value={cf.value} onChange={(v) => setFormat(i, { value: typeof v === 'number' ? v : 0 })} />
                  <Input size="small" style={{ width: 64 }} placeholder="文字色" value={cf.color} onChange={(v) => setFormat(i, { color: v })} />
                  <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={12} />} onClick={() => onOptions({ conditionalFormats: (o.conditionalFormats ?? []).filter((_, j) => j !== i) })} />
                </Space>
              ))}
              <Button size="small" icon={<Plus size={12} />} onClick={() => onOptions({ conditionalFormats: [...(o.conditionalFormats ?? []), { field: fieldOptions[0]?.value ?? '', op: 'gte', value: 0, background: 'var(--semi-color-success-light-default)' }] })}>加规则</Button>
            </Space>
          </Field>
        </>
      )}

      {/* ── 透视表 ── */}
      {t === 'pivot' && (
        <>
          <Field label="行维度（可多选）"><Select multiple style={full} value={o.pivotRows ?? []} showClear onChange={(v) => onOptions({ pivotRows: (v as string[]) ?? [] })} optionList={fieldOptions} /></Field>
          <Field label="列维度"><Select style={full} value={o.pivotColumns?.[0]} placeholder="可选" showClear onChange={(v) => onOptions({ pivotColumns: v ? [v as string] : [] })} optionList={fieldOptions} /></Field>
          <Field label="值字段"><Select style={full} value={o.pivotValueField} showClear onChange={(v) => onOptions({ pivotValueField: v as string })} optionList={fieldOptions} /></Field>
          <Field label="聚合"><Select style={full} value={o.pivotAggregate ?? 'sum'} onChange={(v) => onOptions({ pivotAggregate: v as ReportWidgetOptions['pivotAggregate'] })} optionList={AGG.filter((a) => a.value !== 'first')} /></Field>
        </>
      )}

      {/* ── 参数绑定 ── */}
      {!isDatasetIndependent && datasetParams.length > 0 && (
        <Field label="参数绑定（数据集参数 ← 全局筛选器）">
          <Space vertical align="start" style={full}>
            {datasetParams.map((p) => (
              <Space key={p.name} style={{ width: '100%', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--semi-color-text-1)' }}>{p.label || p.name}</span>
                <Select size="small" style={{ width: 150 }} placeholder="选择筛选器" showClear
                  value={(widget.paramBindings ?? []).find((b) => b.param === p.name)?.filterId}
                  onChange={(v) => setBinding(p.name, v as string | undefined)} optionList={filterOpts} />
              </Space>
            ))}
          </Space>
        </Field>
      )}

      {/* ── 联动 ── */}
      {(isCartesian || t === 'pie' || t === 'funnel' || t === 'table') && filters.length > 0 && (
        <Field label="点击联动">
          <Space style={{ width: '100%' }}>
            <Switch size="small" checked={!!widget.interaction?.enabled} onChange={(c) => onPatch({ interaction: { ...widget.interaction, enabled: c } })} />
            <Select size="small" style={{ flex: 1 }} placeholder="写入筛选器" showClear value={widget.interaction?.setFilterId}
              onChange={(v) => onPatch({ interaction: { ...widget.interaction, setFilterId: v as string | undefined } })} optionList={filterOpts} />
          </Space>
        </Field>
      )}

      {/* ── 钻取 ── */}
      {(isCartesian || t === 'pie' || t === 'funnel' || t === 'table') && (
        <Field label="钻取">
          <Space vertical align="start" style={full}>
            <Space>
              <Switch size="small" checked={!!widget.drilldown?.enabled} onChange={(c) => onPatch({ drilldown: { ...widget.drilldown, enabled: c } })} />
              <Select size="small" style={{ width: 120 }} value={widget.drilldown?.type ?? 'dashboard'} onChange={(v) => onPatch({ drilldown: { ...widget.drilldown, type: v as 'dashboard' | 'url' } })}
                optionList={[{ value: 'dashboard', label: '跳仪表盘' }, { value: 'url', label: '跳外链' }]} />
            </Space>
            {widget.drilldown?.type === 'url' ? (
              <Input size="small" placeholder="https://...{value}" value={widget.drilldown?.url} onChange={(v) => onPatch({ drilldown: { ...widget.drilldown, url: v } })} />
            ) : (
              <Select size="small" style={full} placeholder="目标仪表盘" showClear value={widget.drilldown?.targetDashboardId ?? undefined}
                onChange={(v) => onPatch({ drilldown: { ...widget.drilldown, targetDashboardId: (v as number) ?? null } })}
                optionList={dashboards.map((d) => ({ value: d.id, label: d.name }))} />
            )}
          </Space>
        </Field>
      )}
    </Space>
  );
}

function SwitchRow({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (c: boolean) => void }) {
  return (
    <Space spacing={4}>
      <Switch size="small" checked={checked} onChange={onChange} />
      <span style={{ fontSize: 12, color: 'var(--semi-color-text-1)' }}>{label}</span>
    </Space>
  );
}

export default ConfigPanel;
