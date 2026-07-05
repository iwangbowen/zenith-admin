import { useMemo, useState } from 'react';
import { Button, Input, InputNumber, Select, Space, Toast, Typography } from '@douyinfe/semi-ui';
import { Wand2 } from 'lucide-react';
import { buildVisualSql, visualMetricAlias } from '@zenith/shared';
import type { ReportVisualModel, ReportVisualMetric, ReportVisualFilter } from '@zenith/shared';
import { useReportMetaTables, useReportMetaColumns } from '@/hooks/queries/report-datasets';

const AGG_OPTIONS = [
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '平均' },
  { value: 'max', label: '最大' },
  { value: 'min', label: '最小' },
  { value: 'count', label: '计数' },
];

const OP_OPTIONS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'like', label: '包含' },
];

const EMPTY_MODEL: ReportVisualModel = { table: '', dimensions: [], metrics: [], filters: [], orderBy: null, limit: 100 };

interface Props {
  initial?: ReportVisualModel | null;
  onGenerate: (sql: string, model: ReportVisualModel) => void;
}

/** 可视化建模器：选表 → 维度/指标/筛选/排序 → 生成 SQL（内置只读主库） */
export function VisualModelBuilder({ initial, onGenerate }: Readonly<Props>) {
  const [model, setModel] = useState<ReportVisualModel>(initial ?? EMPTY_MODEL);
  const tablesQuery = useReportMetaTables();
  const tables = tablesQuery.data ?? [];
  const columnsQuery = useReportMetaColumns(model.table || undefined);
  const columns = useMemo(() => columnsQuery.data ?? [], [columnsQuery.data]);
  const columnOptions = columns.map((c) => ({ value: c.name, label: `${c.name}（${c.type}）` }));
  const orderFieldOptions = [
    ...model.dimensions.map((d) => ({ value: d, label: d })),
    ...model.metrics.filter((m) => m.field || m.aggregate === 'count').map((m) => {
      const alias = visualMetricAlias(m);
      return { value: alias, label: `${alias}（指标）` };
    }),
  ];

  function patch(p: Partial<ReportVisualModel>) {
    setModel((prev) => ({ ...prev, ...p }));
  }
  function patchMetric(index: number, p: Partial<ReportVisualMetric>) {
    setModel((prev) => ({ ...prev, metrics: prev.metrics.map((m, i) => (i === index ? { ...m, ...p } : m)) }));
  }
  function patchFilter(index: number, p: Partial<ReportVisualFilter>) {
    setModel((prev) => ({ ...prev, filters: (prev.filters ?? []).map((f, i) => (i === index ? { ...f, ...p } : f)) }));
  }

  function generate() {
    if (!model.table) { Toast.warning('请先选择数据表'); return; }
    try {
      const sql = buildVisualSql(model);
      onGenerate(sql, model);
      Toast.success('SQL 已生成，可在编辑器中微调');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '生成失败');
    }
  }

  return (
    <Space vertical align="start" spacing={8} style={{ width: '100%', marginTop: 8, padding: 12, border: '1px solid var(--semi-color-border)', borderRadius: 6 }}>
      <Space wrap>
        <Select filter placeholder="选择数据表" value={model.table || undefined} style={{ width: 240 }}
          optionList={tables.map((t) => ({ value: t, label: t }))} loading={tablesQuery.isFetching}
          onChange={(v) => setModel({ ...EMPTY_MODEL, table: String(v ?? ''), limit: model.limit })} />
        <Select multiple filter placeholder="维度（分组列）" value={model.dimensions} style={{ minWidth: 260 }} maxTagCount={3}
          optionList={columnOptions} disabled={!model.table} loading={columnsQuery.isFetching}
          onChange={(v) => patch({ dimensions: (v as string[]) ?? [] })} />
      </Space>

      <Space wrap>
        <Typography.Text type="tertiary" size="small" style={{ width: 40 }}>指标</Typography.Text>
        <Button size="small" disabled={!model.table} onClick={() => patch({ metrics: [...model.metrics, { field: '', aggregate: 'sum' }] })}>添加指标</Button>
      </Space>
      {model.metrics.map((m, i) => (
        <Space key={i} wrap>
          <Select filter placeholder={m.aggregate === 'count' ? '计数可不选字段' : '字段'} value={m.field || undefined} style={{ width: 200 }}
            optionList={columnOptions} showClear onChange={(v) => patchMetric(i, { field: v ? String(v) : '' })} />
          <Select value={m.aggregate} style={{ width: 90 }} optionList={AGG_OPTIONS}
            onChange={(v) => patchMetric(i, { aggregate: v as ReportVisualMetric['aggregate'] })} />
          <Input placeholder="别名（可选）" value={m.alias ?? ''} style={{ width: 140 }} showClear
            onChange={(v) => patchMetric(i, { alias: v || undefined })} />
          <Button theme="borderless" type="danger" size="small" onClick={() => patch({ metrics: model.metrics.filter((_, x) => x !== i) })}>删除</Button>
        </Space>
      ))}

      <Space wrap>
        <Typography.Text type="tertiary" size="small" style={{ width: 40 }}>筛选</Typography.Text>
        <Button size="small" disabled={!model.table} onClick={() => patch({ filters: [...(model.filters ?? []), { field: '', op: 'eq', value: '' }] })}>添加条件</Button>
      </Space>
      {(model.filters ?? []).map((f, i) => (
        <Space key={i} wrap>
          <Select filter placeholder="字段" value={f.field || undefined} style={{ width: 200 }} optionList={columnOptions}
            onChange={(v) => patchFilter(i, { field: String(v ?? '') })} />
          <Select value={f.op} style={{ width: 84 }} optionList={OP_OPTIONS}
            onChange={(v) => patchFilter(i, { op: v as ReportVisualFilter['op'] })} />
          <Input placeholder="值" value={f.value} style={{ width: 150 }} showClear onChange={(v) => patchFilter(i, { value: v })} />
          <Button theme="borderless" type="danger" size="small" onClick={() => patch({ filters: (model.filters ?? []).filter((_, x) => x !== i) })}>删除</Button>
        </Space>
      ))}

      <Space wrap>
        <Select filter showClear placeholder="排序字段（可选）" value={model.orderBy?.field || undefined} style={{ width: 200 }}
          optionList={orderFieldOptions}
          onChange={(v) => patch({ orderBy: v ? { field: String(v), order: model.orderBy?.order ?? 'desc' } : null })} />
        <Select value={model.orderBy?.order ?? 'desc'} style={{ width: 90 }} disabled={!model.orderBy?.field}
          optionList={[{ value: 'desc', label: '降序' }, { value: 'asc', label: '升序' }]}
          onChange={(v) => patch({ orderBy: model.orderBy?.field ? { field: model.orderBy.field, order: v as 'asc' | 'desc' } : null })} />
        <InputNumber prefix="LIMIT" value={model.limit ?? 100} min={1} max={5000} style={{ width: 140 }}
          onChange={(v) => patch({ limit: typeof v === 'number' ? v : null })} />
        <Button type="primary" icon={<Wand2 size={14} />} onClick={generate}>生成 SQL</Button>
      </Space>
    </Space>
  );
}

export default VisualModelBuilder;
