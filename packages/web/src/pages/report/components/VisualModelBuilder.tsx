import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Button, Input, InputNumber, Select, Space, Toast, Typography } from '@douyinfe/semi-ui';
import { Wand2 } from 'lucide-react';
import {
  BASIC_COMPARISON_OPERATOR_SYMBOLS,
  buildVisualSql,
  REPORT_VISUAL_AGGREGATE_OPTIONS,
  visualMetricAlias,
} from '@zenith/shared';
import type { ReportVisualModel, ReportVisualMetric, ReportVisualFilter, ReportVisualJoin, ReportMetaColumn } from '@zenith/shared';
import { reportDatasetKeys, useReportMetaTables } from '@/hooks/queries/report-datasets';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, unwrap } from '@/lib/query';

const OP_OPTIONS = [
  ...(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const)
    .map((value) => ({ value, label: BASIC_COMPARISON_OPERATOR_SYMBOLS[value] })),
  { value: 'like', label: '包含' },
];

const EMPTY_MODEL: ReportVisualModel = { table: '', alias: '', joins: [], dimensions: [], metrics: [], filters: [], orderBy: null, limit: 100 };

interface Props {
  initial?: ReportVisualModel | null;
  onGenerate: (sql: string, model: ReportVisualModel) => void;
}

/** 可视化建模器：选表 → 维度/指标/筛选/排序 → 生成 SQL（内置只读主库） */
export function VisualModelBuilder({ initial, onGenerate }: Readonly<Props>) {
  const [model, setModel] = useState<ReportVisualModel>(initial ?? EMPTY_MODEL);
  const tablesQuery = useReportMetaTables();
  const tables = tablesQuery.data ?? [];
  const tableNames = useMemo(
    () => Array.from(new Set([model.table, ...(model.joins ?? []).map((join) => join.table)].filter(Boolean))),
    [model.joins, model.table],
  );
  const columnQueries = useQueries({
    queries: tableNames.map((table) => ({
      queryKey: reportDatasetKeys.metaColumns(table),
      queryFn: () => request.get<ReportMetaColumn[]>(`/api/report/meta/tables/${encodeURIComponent(table)}/columns`).then(unwrap),
      enabled: !!table,
      staleTime: LOOKUP_STALE_TIME,
    })),
  });
  const tableColumnsMap = new Map<string, ReportMetaColumn[]>();
  tableNames.forEach((table, index) => { tableColumnsMap.set(table, columnQueries[index]?.data ?? []); });
  const aliasEntries = useMemo(() => {
    const baseAlias = (model.alias?.trim() || model.table || '').trim();
    return [
      ...(model.table ? [{ alias: baseAlias, table: model.table, label: `${baseAlias} ← ${model.table}` }] : []),
      ...((model.joins ?? []).filter((join) => join.table).map((join) => {
        const alias = join.alias?.trim() || join.table;
        return { alias, table: join.table, label: `${alias} ← ${join.table}` };
      })),
    ];
  }, [model.alias, model.joins, model.table]);
  const aliasTableMap = useMemo(() => new Map(aliasEntries.map((entry) => [entry.alias, entry.table])), [aliasEntries]);
  const columnOptions = aliasEntries.flatMap((entry) => (tableColumnsMap.get(entry.table) ?? []).map((c) => ({
    value: `${entry.alias}.${c.name}`,
    label: `${entry.alias}.${c.name}（${c.type}）`,
  })));
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
  function patchJoin(index: number, p: Partial<ReportVisualJoin>) {
    setModel((prev) => ({ ...prev, joins: (prev.joins ?? []).map((join, i) => (i === index ? { ...join, ...p } : join)) }));
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
    <Space vertical align="start" spacing={8} style={{ width: '100%', marginTop: 8, padding: 12, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
      <Space wrap>
        <Select filter placeholder="选择数据表" value={model.table || undefined} style={{ width: 240 }}
          optionList={tables.map((t) => ({ value: t, label: t }))} loading={tablesQuery.isFetching}
          onChange={(v) => setModel({ ...EMPTY_MODEL, table: String(v ?? ''), alias: String(v ?? ''), limit: model.limit })} />
        <Input placeholder="主表别名（可选）" value={model.alias ?? ''} style={{ width: 180 }} showClear
          onChange={(v) => patch({ alias: v || model.table })} />
        <Select multiple filter placeholder="维度（分组列）" value={model.dimensions} style={{ minWidth: 260 }} maxTagCount={3}
          optionList={columnOptions} disabled={!model.table} loading={columnQueries.some((query) => query.isFetching)}
          onChange={(v) => patch({ dimensions: (v as string[]) ?? [] })} />
      </Space>

      <Space wrap>
        <Typography.Text type="tertiary" size="small" style={{ width: 40 }}>关联</Typography.Text>
        <Button size="small" disabled={!model.table} onClick={() => patch({
          joins: [...(model.joins ?? []), {
            type: 'left',
            table: '',
            alias: '',
            sourceAlias: aliasEntries[0]?.alias ?? model.table,
            sourceField: '',
            targetField: '',
          }],
        })}>添加 JOIN</Button>
      </Space>
      {(model.joins ?? []).map((join, index) => {
        const joinAlias = join.alias?.trim() || join.table || '';
        const sourceTable = aliasTableMap.get(join.sourceAlias?.trim() || aliasEntries[0]?.alias || '');
        const sourceColumns = sourceTable ? (tableColumnsMap.get(sourceTable) ?? []) : [];
        const targetColumns = join.table ? (tableColumnsMap.get(join.table) ?? []) : [];
        return (
          <Space key={`${join.table}-${index}`} wrap>
            <Select value={join.type} style={{ width: 90 }}
              optionList={[{ value: 'left', label: 'LEFT' }, { value: 'inner', label: 'INNER' }]}
              onChange={(value) => patchJoin(index, { type: value as ReportVisualJoin['type'] })} />
            <Select filter placeholder="关联表" value={join.table || undefined} style={{ width: 180 }}
              optionList={tables.map((t) => ({ value: t, label: t }))} loading={tablesQuery.isFetching}
              onChange={(value) => patchJoin(index, { table: String(value ?? ''), alias: String(value ?? ''), targetField: '' })} />
            <Input placeholder="别名" value={join.alias ?? ''} style={{ width: 120 }} showClear
              onChange={(value) => patchJoin(index, { alias: value || join.table })} />
            <Select filter placeholder="来源别名" value={join.sourceAlias || undefined} style={{ width: 140 }}
              optionList={aliasEntries.map((entry) => ({ value: entry.alias, label: entry.label }))}
              onChange={(value) => patchJoin(index, { sourceAlias: String(value ?? '') })} />
            <Select filter placeholder="来源字段" value={join.sourceField || undefined} style={{ width: 180 }}
              optionList={sourceColumns.map((column) => ({ value: column.name, label: `${column.name}（${column.type}）` }))}
              onChange={(value) => patchJoin(index, { sourceField: String(value ?? '') })} />
            <Select filter placeholder="关联字段" value={join.targetField || undefined} style={{ width: 180 }}
              optionList={targetColumns.map((column) => ({ value: column.name, label: `${column.name}（${column.type}）` }))}
              onChange={(value) => patchJoin(index, { targetField: String(value ?? '') })} />
            <Typography.Text type="tertiary" size="small">{joinAlias ? `引用前缀：${joinAlias}.字段名` : '设置别名后可用于字段映射'}</Typography.Text>
            <Button theme="borderless" type="danger" size="small" onClick={() => patch({ joins: (model.joins ?? []).filter((_, i) => i !== index) })}>删除</Button>
          </Space>
        );
      })}

      <Space wrap>
        <Typography.Text type="tertiary" size="small" style={{ width: 40 }}>指标</Typography.Text>
        <Button size="small" disabled={!model.table} onClick={() => patch({ metrics: [...model.metrics, { field: '', aggregate: 'sum' }] })}>添加指标</Button>
      </Space>
      {model.metrics.map((m, i) => (
        <Space key={i} wrap>
          <Select filter placeholder={m.aggregate === 'count' ? '计数可不选字段' : '字段'} value={m.field || undefined} style={{ width: 200 }}
            optionList={columnOptions} showClear onChange={(v) => patchMetric(i, { field: v ? String(v) : '' })} />
          <Select value={m.aggregate} style={{ width: 90 }}           optionList={REPORT_VISUAL_AGGREGATE_OPTIONS}
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
