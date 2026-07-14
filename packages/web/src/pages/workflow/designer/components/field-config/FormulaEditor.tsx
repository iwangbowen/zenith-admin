// ─── 公式编辑器（拆分自 TypeSpecificSection）───────────────────────────
// 能力：光标处插入函数/字段引用、明细列聚合引用、实时试算、语法/引用/循环依赖校验。
import { useMemo, useRef, useState } from 'react';
import { Input, TextArea, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { WorkflowFormField, WorkflowFormFieldType } from '@zenith/shared';
import { FORMULA_FN_GROUPS, evalFormula } from '../../form-formula';
import { formulaError, formulaCycleError } from './helpers';

/** 无标量值、不适合被公式引用的类型 */
const REF_EXCLUDE = new Set<WorkflowFormFieldType>([
  'row', 'group', 'tabs', 'steps', 'divider', 'description',
  'attachment', 'image', 'signature', 'richtext', 'password', 'detail',
]);

interface RefCandidate {
  insert: string;   // 点击插入的片段，如 {amount} / {items.price}
  label: string;    // 展示名
  hint: string;     // Tooltip：字段 key 或说明
}

/** 收集可引用字段：普通字段 → {key}；明细子列 → {明细key.列key}（聚合用） */
function collectRefCandidates(fields: WorkflowFormField[], currentKey: string): RefCandidate[] {
  const out: RefCandidate[] = [];
  const walk = (list: WorkflowFormField[]): void => {
    for (const f of list) {
      if (f.type === 'detail') {
        for (const child of f.children ?? []) {
          if (REF_EXCLUDE.has(child.type)) continue;
          out.push({
            insert: `{${f.key}.${child.key}}`,
            label: `${f.label || f.key}.${child.label || child.key}`,
            hint: `明细列聚合引用 {${f.key}.${child.key}}，配合 SUM/AVG/COUNT 使用`,
          });
        }
        continue;
      }
      if (f.columns) for (const c of f.columns) walk(c.fields);
      if (f.panes) for (const p of f.panes) walk(p.fields);
      if (f.type === 'group' && f.children) walk(f.children);
      if (f.key === currentKey || REF_EXCLUDE.has(f.type)) continue;
      out.push({ insert: `{${f.key}}`, label: f.label || f.key, hint: `{${f.key}}` });
    }
  };
  walk(fields);
  return out;
}

/** 从公式中提取去重后的 {引用} 列表 */
function extractRefs(formula: string): string[] {
  return Array.from(new Set(Array.from(formula.matchAll(/\{([^}]+)\}/g), (m) => m[1].trim()).filter(Boolean)));
}

/** 试算样例值 → evalFormula 的 values：明细引用按逗号拆成行数组，普通引用透传标量 */
function buildSampleValues(refs: string[], samples: Record<string, string>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const detailRows = new Map<string, Array<Record<string, unknown>>>();
  for (const ref of refs) {
    const raw = samples[ref] ?? '1';
    const dot = ref.indexOf('.');
    if (dot < 0) {
      const n = Number(raw);
      values[ref] = raw.trim() !== '' && Number.isFinite(n) ? n : raw;
      continue;
    }
    const base = ref.slice(0, dot);
    const col = ref.slice(dot + 1);
    const cells = raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      .map((s) => { const n = Number(s); return Number.isFinite(n) ? n : s; });
    const rows = detailRows.get(base) ?? [];
    cells.forEach((cell, i) => { rows[i] = { ...(rows[i] ?? {}), [col]: cell }; });
    detailRows.set(base, rows);
  }
  for (const [base, rows] of detailRows) values[base] = rows;
  return values;
}

interface FormulaEditorProps {
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  flatFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
}

export function FormulaEditor({ field, allFields, flatFields, onChange }: Readonly<FormulaEditorProps>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [samples, setSamples] = useState<Record<string, string>>({});

  const formula = field.formula ?? '';
  const syntaxError = formulaError(field.formula, flatFields, field.key);
  const cycleError = formulaCycleError(allFields, field.key);
  const refCandidates = useMemo(() => collectRefCandidates(allFields, field.key), [allFields, field.key]);
  const refs = useMemo(() => extractRefs(formula), [formula]);

  // 试算：语法有效时按样例值实时计算
  const testResult = useMemo(() => {
    if (!formula.trim() || syntaxError) return null;
    return evalFormula(formula, buildSampleValues(refs, samples), field.precision ?? 2);
  }, [formula, syntaxError, refs, samples, field.precision]);

  // 在光标处插入片段并恢复焦点；函数片段光标落在括号内
  const insertSnippet = (snippet: string) => {
    const el = wrapperRef.current?.querySelector('textarea');
    const start = el?.selectionStart ?? formula.length;
    const end = el?.selectionEnd ?? formula.length;
    const next = formula.slice(0, start) + snippet + formula.slice(end);
    const inner = snippet.endsWith(')') ? snippet.indexOf('(') + 1 : snippet.length;
    const caret = start + inner;
    onChange({ formula: next });
    requestAnimationFrame(() => {
      const ta = wrapperRef.current?.querySelector('textarea');
      ta?.focus();
      ta?.setSelectionRange(caret, caret);
    });
  };

  return (
    <>
      <div className="fd-form-config__field" ref={wrapperRef}>
        <Typography.Text strong size="small">公式表达式</Typography.Text>
        <TextArea
          value={formula}
          onChange={(v) => onChange({ formula: v })}
          placeholder="如：{amount}*{days}、IF({days}>3,{amount}*0.9,{amount})、SUM({items.amount})"
          rows={3}
        />
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
          支持 + - * / 与比较/三元；点击下方字段或函数插入到光标处；明细汇总用 {'{明细key.列key}'}
        </Typography.Text>

        {/* 字段引用插入 */}
        {refCandidates.length > 0 && (
          <div className="fd-formula-fns">
            <div className="fd-formula-fns__group">
              <Typography.Text type="tertiary" size="small" className="fd-formula-fns__label">插入字段</Typography.Text>
              <div className="fd-formula-fns__list">
                {refCandidates.map((c) => (
                  <Tooltip key={c.insert} content={c.hint}>
                    <button
                      type="button"
                      className="fd-formula-fns__chip fd-formula-fns__chip--field"
                      onClick={() => insertSnippet(c.insert)}
                    >
                      {c.label}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 函数插入 */}
        <div className="fd-formula-fns">
          {FORMULA_FN_GROUPS.map((g) => (
            <div key={g.group} className="fd-formula-fns__group">
              <Typography.Text type="tertiary" size="small" className="fd-formula-fns__label">{g.group}</Typography.Text>
              <div className="fd-formula-fns__list">
                {g.fns.map((f) => (
                  <Tooltip key={f.name} content={f.desc}>
                    <button
                      type="button"
                      className="fd-formula-fns__chip"
                      onClick={() => insertSnippet(f.insert)}
                    >
                      {f.name}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </div>

        {(syntaxError || cycleError) && (
          <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>
            {syntaxError ?? cycleError}
          </Typography.Text>
        )}
      </div>

      {/* 实时试算：为每个引用填样例值，即时查看计算结果 */}
      {refs.length > 0 && !syntaxError && (
        <div className="fd-form-config__field fd-formula-test">
          <Typography.Text strong size="small">试算</Typography.Text>
          <div className="fd-formula-test__inputs">
            {refs.map((ref) => (
              <div key={ref} className="fd-formula-test__row">
                <Typography.Text type="tertiary" size="small" className="fd-formula-test__ref" ellipsis={{ showTooltip: true }}>
                  {`{${ref}}`}
                </Typography.Text>
                <Input
                  size="small"
                  value={samples[ref] ?? '1'}
                  onChange={(v) => setSamples((prev) => ({ ...prev, [ref]: v }))}
                  placeholder={ref.includes('.') ? '多行值用逗号分隔，如 1,2,3' : '样例值'}
                />
              </div>
            ))}
          </div>
          <div className="fd-formula-test__result">
            <Typography.Text type="tertiary" size="small">结果：</Typography.Text>
            {testResult === null
              ? <Typography.Text type="warning" size="small">无法计算，请检查样例值</Typography.Text>
              : <Typography.Text strong size="small">{String(testResult)}</Typography.Text>}
          </div>
        </div>
      )}
    </>
  );
}
