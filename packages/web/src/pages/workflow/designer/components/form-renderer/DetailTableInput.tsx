/**
 * 明细 / 子表控件：可增删复制行、按子字段类型录入、行内公式重算、剪贴板批量粘贴、底部合计，提交数组。
 */
import { Button, DatePicker, Input, InputNumber, Select, Toast, Typography, withField } from '@douyinfe/semi-ui';
import { Plus, Trash2, Copy, ClipboardPaste } from 'lucide-react';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { isWorkflowFieldVisible as isFieldVisible } from '@zenith/shared/workflow';
import { toDateFnsToken, dateFormatHasTime, dateFormatHasDay } from '../../form-types';
import { evalFormula } from '../../form-formula';
import { readClipboardText } from '@/utils/clipboard';

type DetailRow = Record<string, unknown>;

interface DetailTableInputProps {
  value?: DetailRow[];
  onChange?: (value: DetailRow[]) => void;
  columns: WorkflowFormField[];
  disabled?: boolean;
}

function DetailCell({ col, cellValue, disabled, onCellChange }: Readonly<{
  col: WorkflowFormField; cellValue: unknown; disabled?: boolean; onCellChange: (v: unknown) => void;
}>) {
  // 行内公式列：只读展示自动计算结果
  if (col.formula?.trim()) {
    return (
      <Input
        value={cellValue === undefined || cellValue === null ? '' : String(cellValue)}
        placeholder="自动计算"
        disabled
      />
    );
  }
  switch (col.type) {
    case 'number':
    case 'amount':
      return (
        <InputNumber
          value={cellValue as number | undefined}
          onChange={(v) => onCellChange(v === '' || v === undefined ? undefined : Number(v))}
          precision={col.precision}
          prefix={col.type === 'amount' ? '¥' : undefined}
          disabled={disabled} style={{ width: '100%' }}
        />
      );
    case 'date':
      return (
        <DatePicker
          value={cellValue as string | undefined}
          onChange={(_d, dateString) => onCellChange(dateString as string | undefined)}
          type={dateFormatHasTime(col.dateFormat) ? 'dateTime' : dateFormatHasDay(col.dateFormat) ? 'date' : 'month'}
          insetInput={dateFormatHasTime(col.dateFormat)}
          format={toDateFnsToken(col.dateFormat)}
          disabled={disabled} style={{ width: '100%' }}
        />
      );
    case 'select':
      return (
        <Select
          value={cellValue as string | undefined}
          onChange={(v) => onCellChange(v)}
          optionList={(col.options ?? []).map((o) => ({ value: o, label: o }))}
          disabled={disabled} showClear style={{ width: '100%' }}
        />
      );
    default:
      return (
        <Input
          value={(cellValue as string | undefined) ?? ''}
          onChange={(v) => onCellChange(v || undefined)}
          disabled={disabled}
        />
      );
  }
}

function DetailTableInput({ value, onChange, columns, disabled }: Readonly<DetailTableInputProps>) {
  const rows = Array.isArray(value) ? value : [];
  const summaryCols = columns.filter((c) => (c.type === 'number' || c.type === 'amount') && c.detailSummary);

  const setRows = (next: DetailRow[]) => onChange?.(next);
  // 行内公式列重算（引用同行其它列 {列key}）
  const applyRowFormulas = (row: DetailRow): DetailRow => {
    let nr = row;
    for (const col of columns) {
      if (!col.formula?.trim()) continue;
      const res = evalFormula(col.formula, nr, col.precision ?? 2);
      nr = { ...nr, [col.key]: res ?? undefined };
    }
    return nr;
  };
  const addRow = () => setRows([...rows, applyRowFormulas({})]);
  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));
  const copyRow = (idx: number) => {
    const next = [...rows];
    next.splice(idx + 1, 0, structuredClone(rows[idx]));
    setRows(next);
  };
  const setCell = (idx: number, key: string, cellVal: unknown) =>
    setRows(rows.map((r, i) => (i === idx ? applyRowFormulas({ ...r, [key]: cellVal }) : r)));

  // 剪贴板单元格 → 按列类型强转（数字/金额转 Number；select 按显示名或值匹配选项）
  const coerceCell = (col: WorkflowFormField, raw: string): unknown => {
    const text = raw.trim();
    if (!text) return undefined;
    if (col.type === 'number' || col.type === 'amount') {
      const n = Number(text.replace(/[,¥￥\s]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    if (col.type === 'select') {
      const item = col.optionItems?.find((it) => it.label === text || it.value === text);
      return item ? item.value : text;
    }
    return text;
  };

  // 从剪贴板粘贴（Excel/表格文本）：行按换行、单元格按制表符拆分，按列顺序追加
  const pasteRows = async () => {
    const text = await readClipboardText();
    if (text === null) {
      Toast.error('无法读取剪贴板：需 HTTPS 访问并允许剪贴板权限');
      return;
    }
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) {
      Toast.info('剪贴板没有可粘贴的内容');
      return;
    }
    const parsed: DetailRow[] = lines.map((line) => {
      const cells = line.split('\t');
      const row: DetailRow = {};
      columns.forEach((col, i) => {
        const v = coerceCell(col, cells[i] ?? '');
        if (v !== undefined) row[col.key] = v;
      });
      return row;
    }).filter((row) => Object.keys(row).length > 0);
    if (parsed.length === 0) {
      Toast.info('未解析到有效数据（按列顺序、制表符分隔）');
      return;
    }
    setRows([...rows, ...parsed.map(applyRowFormulas)]);
    Toast.success(`已粘贴 ${parsed.length} 行明细`);
  };

  const sumOf = (key: string) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

  if (columns.length === 0) {
    return <Typography.Text type="tertiary">请在设计器中为明细配置子列</Typography.Text>;
  }

  return (
    <div className="wf-detail-table" style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 44 }} />
          {columns.map((col) => (
            <col key={col.key} style={col.detailColumnWidth ? { width: col.detailColumnWidth } : undefined} />
          ))}
          {!disabled && <col style={{ width: 84 }} />}
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--semi-color-fill-0)' }}>
            <th style={{ padding: '8px 10px', fontSize: 12, color: 'var(--semi-color-text-2)' }}>#</th>
            {columns.map((col) => (
              <th key={col.key} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 12, color: 'var(--semi-color-text-1)', fontWeight: 600 }}>
                {col.label}
              </th>
            ))}
            {!disabled && <th style={{ padding: '8px 10px' }} />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (disabled ? 1 : 2)} style={{ padding: '16px', textAlign: 'center', color: 'var(--semi-color-text-2)' }}>
                暂无明细
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={`detail-row-${idx}`} style={{ borderTop: '1px solid var(--semi-color-border)' }}>
                <td style={{ padding: '6px 10px', color: 'var(--semi-color-text-2)', fontSize: 12 }}>{idx + 1}</td>
                {columns.map((col) => (
                  <td key={col.key} style={{ padding: '6px 8px' }}>
                    {isFieldVisible(col, row) ? (
                      <DetailCell col={col} cellValue={row[col.key]} disabled={disabled} onCellChange={(v) => setCell(idx, col.key, v)} />
                    ) : (
                      <span style={{ color: 'var(--semi-color-text-3)' }}>—</span>
                    )}
                  </td>
                ))}
                {!disabled && (
                  <td style={{ padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <Button theme="borderless" size="small" icon={<Copy size={13} />} onClick={() => copyRow(idx)} aria-label="复制明细行" title="复制该行" />
                    <Button type="danger" theme="borderless" size="small" icon={<Trash2 size={13} />} onClick={() => removeRow(idx)} aria-label="删除明细行" />
                  </td>
                )}
              </tr>
            ))
          )}
          {summaryCols.length > 0 && rows.length > 0 && (
            <tr style={{ borderTop: '1px solid var(--semi-color-border)', background: 'var(--semi-color-fill-0)' }}>
              <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--semi-color-text-2)' }}>合计</td>
              {columns.map((col) => (
                <td key={col.key} style={{ padding: '8px 10px', fontWeight: 600 }}>
                  {summaryCols.some((s) => s.key === col.key) ? sumOf(col.key) : ''}
                </td>
              ))}
              {!disabled && <td />}
            </tr>
          )}
        </tbody>
      </table>
      {!disabled && (
        <div style={{ padding: 8, display: 'flex', gap: 8 }}>
          <Button size="small" theme="light" icon={<Plus size={13} />} onClick={addRow}>添加明细行</Button>
          <Button size="small" theme="light" icon={<ClipboardPaste size={13} />} onClick={() => void pasteRows()} title="从 Excel 复制后粘贴，按列顺序、制表符分隔">
            从剪贴板粘贴
          </Button>
        </div>
      )}
    </div>
  );
}

export const FormDetailTable = withField(DetailTableInput);
