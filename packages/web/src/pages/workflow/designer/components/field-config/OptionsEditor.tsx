// ─── 静态选项列表编辑器（拆分自 FieldConfigPanel.tsx）───
import { useState } from 'react';
import { Button, Input, Switch, Typography, Dropdown, TextArea } from '@douyinfe/semi-ui';
import { Plus, Trash2, Ban, List } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldOptionItem } from '@zenith/shared';
import { OPTION_COLOR_PRESETS } from '../../form-types';
import { deriveOptionItems } from './helpers';

export function OptionsEditor({
  field,
  onChange,
}: Readonly<{ field: WorkflowFormField; onChange: (updates: Partial<WorkflowFormField>) => void }>) {
  const items = deriveOptionItems(field);
  // 是否「值与显示分离」：存在 label 且与 value 不同时默认开启
  const [separate, setSeparate] = useState(items.some((it) => it.label && it.label !== it.value));
  // 批量文本编辑模式（每行一个选项，值|显示名）
  const [batchMode, setBatchMode] = useState(false);
  const [batchDraft, setBatchDraft] = useState('');

  // 写回：同步 optionItems（完整）与 options（值列表镜像，供级联/校验复用）
  const commit = (next: WorkflowFormFieldOptionItem[]) => {
    const cleaned = next.map((it) => ({
      value: it.value,
      ...(it.label && it.label !== it.value ? { label: it.label } : {}),
      ...(it.color ? { color: it.color } : {}),
      ...(it.disabled ? { disabled: true } : {}),
    }));
    onChange({ optionItems: cleaned, options: cleaned.map((it) => it.value) });
  };

  const update = (i: number, patch: Partial<WorkflowFormFieldOptionItem>) => {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
    commit(next);
  };
  const remove = (i: number) => commit(items.filter((_, idx) => idx !== i));
  const add = () => commit([...items, { value: `选项${items.length + 1}` }]);

  // ─── 批量文本编辑：每行「值」或「值|显示名」，应用时按值保留原颜色/禁用 ───
  const openBatch = () => {
    setBatchDraft(items.map((it) => (it.label && it.label !== it.value ? `${it.value}|${it.label}` : it.value)).join('\n'));
    setBatchMode(true);
  };

  const applyBatch = () => {
    const byValue = new Map(items.map((it) => [it.value, it]));
    const next: WorkflowFormFieldOptionItem[] = [];
    const seen = new Set<string>();
    for (const line of batchDraft.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const sep = trimmed.indexOf('|');
      const value = (sep >= 0 ? trimmed.slice(0, sep) : trimmed).trim();
      const label = sep >= 0 ? trimmed.slice(sep + 1).trim() : '';
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const prev = byValue.get(value);
      next.push({
        value,
        ...(label && label !== value ? { label } : {}),
        ...(prev?.color ? { color: prev.color } : {}),
        ...(prev?.disabled ? { disabled: true } : {}),
      });
    }
    if (next.some((it) => it.label)) setSeparate(true);
    commit(next);
    setBatchMode(false);
  };

  const values = items.map((it) => it.value.trim());
  const hasDuplicate = new Set(values.filter(Boolean)).size !== values.filter(Boolean).length;
  const hasEmpty = items.some((it) => !it.value.trim());

  if (batchMode) {
    return (
      <div className="fd-options-editor">
        <TextArea
          value={batchDraft}
          onChange={setBatchDraft}
          rows={Math.min(12, Math.max(5, batchDraft.split('\n').length + 1))}
          placeholder={'每行一个选项，可从 Excel/文本粘贴\n值与显示分离用竖线：值|显示名'}
        />
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '4px 0 8px' }}>
          空行忽略、重复值去重；已有选项的颜色/禁用状态按值保留
        </Typography.Text>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" type="primary" onClick={applyBatch}>应用</Button>
          <Button size="small" type="tertiary" onClick={() => setBatchMode(false)}>取消</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fd-options-editor">
      <div className="fd-form-config__field fd-form-config__field--inline" style={{ marginBottom: 4 }}>
        <Typography.Text type="tertiary" size="small">选项值与显示分离</Typography.Text>
        <Switch size="small" checked={separate} onChange={setSeparate} />
      </div>
      {items.map((it, i) => (
        <div key={`opt-${i}`} className="fd-options-editor__row">
          <Dropdown
            trigger="click"
            position="bottomLeft"
            render={(
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, width: 132 }}>
                {OPTION_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => update(i, { color: c })}
                    style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: it.color === c ? '2px solid var(--semi-color-text-0)' : '1px solid var(--semi-color-border)', cursor: 'pointer' }}
                  />
                ))}
                <button
                  type="button"
                  aria-label="无色"
                  onClick={() => update(i, { color: undefined })}
                  style={{ width: 18, height: 18, borderRadius: '50%', background: 'transparent', border: '1px dashed var(--semi-color-border)', cursor: 'pointer' }}
                />
              </div>
            )}
          >
            <button
              type="button"
              className="fd-options-editor__color"
              title="选项颜色"
              style={{ background: it.color || 'transparent', borderStyle: it.color ? 'solid' : 'dashed' }}
            />
          </Dropdown>
          {separate && (
            <Input
              size="small"
              value={it.value}
              onChange={(v) => update(i, { value: v })}
              placeholder="值"
              style={{ width: 88 }}
            />
          )}
          <Input
            size="small"
            value={separate ? (it.label ?? '') : it.value}
            onChange={(v) => (separate ? update(i, { label: v }) : update(i, { value: v }))}
            placeholder={separate ? '显示名' : `选项 ${i + 1}`}
          />
          <button
            type="button"
            className={`fd-options-editor__flag ${it.disabled ? 'fd-options-editor__flag--active' : ''}`}
            title={it.disabled ? '已禁用（点击启用）' : '禁用该选项'}
            onClick={() => update(i, { disabled: !it.disabled })}
          >
            <Ban size={12} />
          </button>
          <button
            type="button"
            className="fd-options-editor__delete"
            onClick={() => remove(i)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="small" type="tertiary" icon={<Plus size={12} />} onClick={add}>
          添加选项
        </Button>
        <Button size="small" type="tertiary" icon={<List size={12} />} onClick={openBatch}>
          批量编辑
        </Button>
      </div>
      {(hasEmpty || hasDuplicate) && (
        <Typography.Text type="warning" size="small" style={{ display: 'block', marginTop: 4 }}>
          {hasEmpty ? '存在空选项，运行时不会有明确显示；' : ''}
          {hasDuplicate ? '存在重复选项值，建议去重。' : ''}
        </Typography.Text>
      )}
    </div>
  );
}
