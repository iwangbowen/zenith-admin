// ─── 选项来源与联动编辑器（日期范围联动/远程数据源/联动赋值/级联）（拆分自 FieldConfigPanel.tsx）───
import { Input, Select, Typography, TagInput, RadioGroup, Radio } from '@douyinfe/semi-ui';
import type { WorkflowFormField } from '@zenith/shared';
import { useWorkflowDesignerDataSourceOptions } from '@/hooks/queries/workflow-designer';
import { AUTOFILL_EXCLUDE, collectFlat, createsCascadeCycle } from './helpers';

export function DateRangeLinkageEditor({
  field, allFields, onChange,
}: Readonly<{
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
}>) {
  const rangeFields = collectFlat(allFields).filter(f => f.type === 'dateRange' && f.key !== field.key);
  if (rangeFields.length === 0) return null;
  return (
    <div className="fd-form-config__field">
      <Typography.Text strong size="small">联动：自动计算天数</Typography.Text>
      <Select
        value={field.daysFromKey ?? ''}
        onChange={(v) => onChange({ daysFromKey: (v as string) || undefined })}
        placeholder="选择日期范围字段（不联动则留空）"
        style={{ width: '100%' }}
        showClear
        optionList={[
          { value: '', label: '不联动' },
          ...rangeFields.map(f => ({ value: f.key, label: f.label })),
        ]}
      />
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
        选定后，此字段会根据日期范围自动填入「结束-开始+1」天数并禁用手填
      </Typography.Text>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
        若结束日期早于开始日期，运行时会自动清空计算结果，避免产生负数天数。
      </Typography.Text>
    </div>
  );
}

// ─── select 选项来源：静态 / 远程数据源 ───────────────────────────────

export function DataSourceSourceEditor({
  field, remote, onRemoteChange, onChange,
}: Readonly<{
  field: WorkflowFormField;
  remote: boolean;
  onRemoteChange: (remote: boolean) => void;
  onChange: (updates: Partial<WorkflowFormField>) => void;
}>) {
  const sourcesQuery = useWorkflowDesignerDataSourceOptions();
  const sources = sourcesQuery.data ?? [];

  return (
    <div className="fd-form-config__field">
      <Typography.Text strong size="small">选项来源</Typography.Text>
      <div style={{ marginTop: 4 }}>
        <RadioGroup
          type="button"
          value={remote ? 'remote' : 'static'}
          onChange={(e) => {
            if (e.target.value === 'remote') {
              onRemoteChange(true);
              onChange({ options: undefined, optionsFrom: undefined, autoFill: undefined, ...(sources[0] ? { dataSourceId: sources[0].id } : {}) });
            } else {
              onRemoteChange(false);
              onChange({ dataSourceId: undefined });
            }
          }}
        >
          <Radio value="static">静态选项</Radio>
          <Radio value="remote">远程数据源</Radio>
        </RadioGroup>
      </div>
      {remote && (
        <Select
          value={field.dataSourceId}
          onChange={(v) => onChange({ dataSourceId: (v as number) ?? undefined })}
          placeholder={sources.length ? '选择数据源' : '暂无启用的数据源，请先在「远程数据源」登记'}
          style={{ width: '100%', marginTop: 6 }}
          optionList={sources.map((s) => ({ value: s.id, label: s.name }))}
          showClear
        />
      )}
    </div>
  );
}

export function AutoFillEditor({
  field, allFields, onChange,
}: Readonly<{
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
}>) {
  const flat = collectFlat(allFields);
  const options = (field.options ?? []).filter(Boolean);
  const candidates = flat.filter((f) => f.key !== field.key && !AUTOFILL_EXCLUDE.has(f.type));
  const current = field.autoFill;
  const targets = current?.targets ?? [];
  // 远程数据源模式：按选中记录字段回填，而非静态选项映射
  const remoteMode = field.dataSourceId != null;

  if ((!remoteMode && options.length === 0) || candidates.length === 0) return null;

  const setTargets = (next: string[]) => {
    if (next.length === 0) { onChange({ autoFill: undefined }); return; }
    if (remoteMode) {
      const map = Object.fromEntries(
        next.map((t) => [t, current?.dataSourceFieldMap?.[t] ?? '']).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
      onChange({ autoFill: { targets: next, byOption: {}, dataSourceFieldMap: map } });
      return;
    }
    const byOption: Record<string, Record<string, string>> = {};
    for (const opt of options) {
      const m = current?.byOption[opt] ?? {};
      byOption[opt] = Object.fromEntries(next.filter((t) => m[t] !== undefined).map((t) => [t, m[t]]));
    }
    onChange({ autoFill: { targets: next, byOption } });
  };

  const setCell = (opt: string, targetKey: string, value: string) => {
    if (!current) return;
    const optMap = { ...(current.byOption[opt] ?? {}) };
    if (value === '') delete optMap[targetKey]; else optMap[targetKey] = value;
    onChange({ autoFill: { ...current, byOption: { ...current.byOption, [opt]: optMap } } });
  };

  const setSourceField = (targetKey: string, sourceField: string) => {
    if (!current) return;
    const map = { ...(current.dataSourceFieldMap ?? {}) };
    if (sourceField === '') delete map[targetKey]; else map[targetKey] = sourceField;
    onChange({ autoFill: { ...current, dataSourceFieldMap: map } });
  };

  return (
    <div className="fd-form-config__field">
      <Typography.Text strong size="small">联动赋值（选择后自动填充）</Typography.Text>
      <Select
        multiple
        value={targets}
        onChange={(v) => setTargets((v as string[]) ?? [])}
        placeholder="选择要自动填充的目标字段（留空不启用）"
        style={{ width: '100%' }}
        showClear
        optionList={candidates.map((f) => ({ value: f.key, label: f.label }))}
      />
      {targets.length > 0 && remoteMode && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {targets.map((tk) => {
            const tf = candidates.find((c) => c.key === tk);
            return (
              <div key={tk} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Typography.Text size="small" style={{ width: 96, flexShrink: 0 }} ellipsis={{ showTooltip: true }}>
                  {tf?.label ?? tk}
                </Typography.Text>
                <Input
                  size="small"
                  value={current?.dataSourceFieldMap?.[tk] ?? ''}
                  onChange={(v) => setSourceField(tk, v)}
                  placeholder="数据源记录字段名，如 phone"
                  style={{ flex: 1 }}
                />
              </div>
            );
          })}
          <Typography.Text type="tertiary" size="small">
            选中某选项时，按其在数据源中的完整记录，把对应字段值回填到目标字段。
          </Typography.Text>
        </div>
      )}
      {targets.length > 0 && !remoteMode && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {targets.map((tk) => {
            const tf = candidates.find((c) => c.key === tk);
            return (
              <div key={tk} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 8 }}>
                <Typography.Text size="small" strong>{tf?.label ?? tk}</Typography.Text>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {options.map((opt) => (
                    <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Typography.Text size="small" style={{ width: 80, flexShrink: 0 }}>{opt}</Typography.Text>
                      <Input
                        size="small"
                        value={current?.byOption[opt]?.[tk] ?? ''}
                        onChange={(v) => setCell(opt, tk, v)}
                        placeholder="填充值"
                        style={{ flex: 1 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <Typography.Text type="tertiary" size="small">选择某选项时，按上表把对应值写入目标字段（留空则不填充）。</Typography.Text>
        </div>
      )}
    </div>
  );
}

// ─── select 级联：依赖父字段的选项映射 ────────────────────────────

export function CascadeEditor({
  field, allFields, onChange,
}: Readonly<{
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
}>) {
  const flatFields = collectFlat(allFields);
  const parentCandidates = flatFields.filter(
    f => (f.type === 'select') && f.key !== field.key && (f.options?.length ?? 0) > 0,
  );
  if (parentCandidates.length === 0) return null;

  const current = field.optionsFrom;
  const parent = current ? parentCandidates.find(f => f.key === current.sourceKey) : null;
  const currentCreatesCycle = current ? createsCascadeCycle(field.key, current.sourceKey, flatFields) : false;

  const setParent = (sourceKey: string | undefined) => {
    if (!sourceKey) {
      onChange({ optionsFrom: undefined });
      return;
    }
    if (createsCascadeCycle(field.key, sourceKey, flatFields)) return;
    const pf = parentCandidates.find(f => f.key === sourceKey);
    const mapping: Record<string, string[]> = {};
    for (const opt of pf?.options ?? []) mapping[opt] = current?.mapping[opt] ?? [];
    onChange({ optionsFrom: { sourceKey, mapping } });
  };

  const setMapping = (parentValue: string, opts: string[]) => {
    if (!current) return;
    onChange({ optionsFrom: { ...current, mapping: { ...current.mapping, [parentValue]: opts } } });
  };

  return (
    <div className="fd-form-config__field">
      <Typography.Text strong size="small">级联：选项依赖父字段</Typography.Text>
      <Select
        value={current?.sourceKey ?? ''}
        onChange={(v) => setParent((v as string) || undefined)}
        placeholder="选择父字段（不级联则留空）"
        style={{ width: '100%' }}
        showClear
        optionList={[
          { value: '', label: '不级联' },
          ...parentCandidates.map(f => {
            const disabled = createsCascadeCycle(field.key, f.key, flatFields);
            return { value: f.key, label: disabled ? `${f.label}（会形成循环）` : f.label, disabled };
          }),
        ]}
      />
      {currentCreatesCycle && (
        <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 6 }}>
          当前级联依赖形成循环，请切换父字段或清空级联配置。
        </Typography.Text>
      )}
      {current && parent && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(parent.options ?? []).map(opt => (
            <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Typography.Text size="small" style={{ width: 80, flexShrink: 0 }}>{opt}</Typography.Text>
              <TagInput
                size="small"
                value={current.mapping[opt] ?? []}
                onChange={(v) => setMapping(opt, v)}
                placeholder="子选项"
                style={{ flex: 1 }}
              />
            </div>
          ))}
          <Typography.Text type="tertiary" size="small">
            为每个父选项配置可见的子选项；父值变化时已选的子值会被自动清空
          </Typography.Text>
          {(parent.options ?? []).some(opt => (current.mapping[opt]?.length ?? 0) > 0) && (
            <div className="fd-form-config__cascade-preview">
              <Typography.Text strong size="small">级联预览</Typography.Text>
              {(parent.options ?? []).map(parentValue => {
                const opts = current.mapping[parentValue] ?? [];
                return (
                  <div key={parentValue} className="fd-form-config__cascade-preview-row">
                    <span>{parentValue}</span>
                    <Typography.Text type="tertiary" size="small">
                      {opts.length > 0 ? opts.join('、') : '未配置子选项'}
                    </Typography.Text>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
