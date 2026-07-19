import { Button, Input, InputNumber, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleFieldType, RuleHitPolicy } from '@zenith/shared';
import { coerceRuleValue, isWildcardCell } from './ruleTableUtils';

const { Text } = Typography;
const TYPES = [{ value: 'string', label: '文本' }, { value: 'number', label: '数值' }, { value: 'boolean', label: '布尔' }];
const NUMBER_OPERATORS = [
  { value: '*', label: '任意' },
  { value: '=', label: '=' },
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: 'range', label: '区间' },
];
const BOOLEAN_OPERATORS = [
  { value: '*', label: '任意' },
  { value: 'true', label: '为真' },
  { value: 'false', label: '为假' },
  { value: '!= true', label: '不为真' },
  { value: '!= false', label: '不为假' },
];

interface Props {
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
  hitPolicy: RuleHitPolicy;
  onChange: (next: { inputs: RuleDecisionInput[]; outputs: RuleDecisionOutput[]; rules: RuleDecisionRow[] }) => void;
}

let rid = 0;
const newRowId = () => `r${Date.now()}_${rid++}`;
const boolOptions = [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }];

function parseNumberCondition(cell: string | undefined): { op: string; left?: number; right?: number } {
  const text = (cell ?? '').trim();
  if (isWildcardCell(text)) return { op: '*' };
  const range = text.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (range) return { op: 'range', left: Number(range[1]), right: Number(range[2]) };
  const comparison = text.match(/^(>=|<=|>|<|==|===|=)\s*(-?\d+(?:\.\d+)?)$/);
  if (comparison) return { op: comparison[1] === '==' || comparison[1] === '===' ? '=' : comparison[1], left: Number(comparison[2]) };
  const n = Number(text);
  return Number.isFinite(n) ? { op: '=', left: n } : { op: '=' };
}

function buildNumberCondition(op: string, left?: number | null, right?: number | null): string {
  if (op === '*') return '-';
  if (op === 'range') return left == null || right == null ? '' : `${left}-${right}`;
  if (left == null) return '';
  return op === '=' ? String(left) : `${op} ${left}`;
}

function parseBooleanCondition(cell: string | undefined): string {
  const text = (cell ?? '').trim().toLowerCase();
  if (isWildcardCell(text)) return '*';
  if (text === 'true' || text === '== true' || text === '=== true') return 'true';
  if (text === 'false' || text === '== false' || text === '=== false') return 'false';
  if (text === '!= true' || text === '!== true') return '!= true';
  if (text === '!= false' || text === '!== false') return '!= false';
  return '*';
}

function literalInput(value: unknown, type: RuleFieldType, onChange: (value: string | number | boolean | null | undefined) => void, placeholder?: string) {
  if (type === 'number') {
    const n = value === '' || value == null ? undefined : Number(value);
    return <InputNumber size="small" value={Number.isFinite(n) ? n : undefined} onChange={(v) => onChange(v == null || v === '' ? undefined : Number(v))} placeholder={placeholder} style={{ width: 128 }} />;
  }
  if (type === 'boolean') {
    const v = value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : undefined;
    return <Select size="small" value={v} onChange={(next) => onChange(next === 'true')} optionList={boolOptions} showClear placeholder={placeholder} style={{ width: 112 }} />;
  }
  return <Input size="small" value={value == null ? '' : String(value)} onChange={(v) => onChange(v || undefined)} placeholder={placeholder} style={{ width: 128 }} />;
}

/** 决策表可视化编辑器：输入列/输出列卡片 + 规则矩阵（行=规则，列=各输入条件 + 各输出值）。 */
export default function DecisionTableEditor({ inputs, outputs, rules, hitPolicy, onChange }: Readonly<Props>) {
  const emit = (p: Partial<{ inputs: RuleDecisionInput[]; outputs: RuleDecisionOutput[]; rules: RuleDecisionRow[] }>) =>
    onChange({ inputs, outputs, rules, ...p });

  const setInput = (i: number, patch: Partial<RuleDecisionInput>) => emit({ inputs: inputs.map((x, k) => k === i ? { ...x, ...patch } : x) });
  // 输出列 key 重命名时同步迁移各规则行 then 中的旧键，避免已填输出值丢失
  const setOutput = (i: number, patch: Partial<RuleDecisionOutput>) => {
    const prevKey = outputs[i].key;
    const nextOutputs = outputs.map((x, k) => k === i ? { ...x, ...patch } : x);
    if (patch.key === undefined || patch.key === prevKey) {
      emit({ outputs: nextOutputs });
      return;
    }
    const nextKey = patch.key;
    const nextRules = rules.map((r) => {
      if (!Object.prototype.hasOwnProperty.call(r.then, prevKey)) return r;
      const then = { ...r.then, [nextKey]: r.then[prevKey] };
      delete then[prevKey];
      return { ...r, then };
    });
    emit({ outputs: nextOutputs, rules: nextRules });
  };
  const addInput = () => emit({ inputs: [...inputs, { key: `in${inputs.length + 1}`, label: '输入', expr: '', type: 'number' }] });
  const addOutput = () => emit({ outputs: [...outputs, { key: `out${outputs.length + 1}`, label: '输出', type: 'string' }] });
  const delInput = (i: number) => emit({ inputs: inputs.filter((_, k) => k !== i), rules: rules.map((r) => ({ ...r, when: r.when.filter((_, k) => k !== i) })) });
  const delOutput = (i: number) => { const key = outputs[i].key; emit({ outputs: outputs.filter((_, k) => k !== i), rules: rules.map((r) => { const t = { ...r.then }; delete t[key]; return { ...r, then: t }; }) }); };
  const addRow = () => emit({ rules: [...rules, { id: newRowId(), when: inputs.map(() => '-'), then: {} }] });
  const dupRow = (ri: number) => emit({ rules: [...rules.slice(0, ri + 1), { ...rules[ri], id: newRowId() }, ...rules.slice(ri + 1)] });
  // first/priority 等策略下行序即语义，支持上移/下移调整
  const moveRow = (ri: number, dir: -1 | 1) => {
    const target = ri + dir;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[ri], next[target]] = [next[target], next[ri]];
    emit({ rules: next });
  };
  const setRow = (ri: number, patch: Partial<RuleDecisionRow>) => emit({ rules: rules.map((r, k) => k === ri ? { ...r, ...patch } : r) });
  const setWhen = (ri: number, ci: number, v: string) => emit({ rules: rules.map((r, k) => k === ri ? { ...r, when: r.when.map((w, j) => j === ci ? v : w) } : r) });
  const setThen = (ri: number, output: RuleDecisionOutput, v: string | number | boolean | null | undefined) => {
    const value = v === undefined || v === '' ? undefined : coerceRuleValue(v, output.type);
    emit({ rules: rules.map((r, k) => k === ri ? { ...r, then: { ...r.then, [output.key]: value as string | number | boolean | null } } : r) });
  };
  const delRow = (ri: number) => emit({ rules: rules.filter((_, k) => k !== ri) });

  const setOutputDefault = (i: number, output: RuleDecisionOutput, value: string | number | boolean | null | undefined) => {
    const next = value === undefined || value === '' ? undefined : coerceRuleValue(value, output.type);
    setOutput(i, { default: next as string | number | boolean | null | undefined });
  };

  const renderCondition = (ri: number, input: RuleDecisionInput, ci: number, cell: string | undefined) => {
    if (input.type === 'number') {
      const parsed = parseNumberCondition(cell);
      const setNumber = (op = parsed.op, left = parsed.left, right = parsed.right) => setWhen(ri, ci, buildNumberCondition(op, left, right));
      return (
        <Space spacing={4} align="center" style={{ flexWrap: 'nowrap' }}>
          <Select size="small" value={parsed.op} onChange={(op) => setNumber(String(op), parsed.left, parsed.right)} optionList={NUMBER_OPERATORS} style={{ width: 76 }} />
          {parsed.op === 'range' ? (
            <>
              <InputNumber size="small" value={parsed.left} onChange={(v) => setNumber('range', v == null || v === '' ? undefined : Number(v), parsed.right)} style={{ width: 86 }} />
              <Text type="tertiary" size="small">至</Text>
              <InputNumber size="small" value={parsed.right} onChange={(v) => setNumber('range', parsed.left, v == null || v === '' ? undefined : Number(v))} style={{ width: 86 }} />
            </>
          ) : parsed.op === '*' ? null : (
            <InputNumber size="small" value={parsed.left} onChange={(v) => setNumber(parsed.op, v == null || v === '' ? undefined : Number(v), parsed.right)} style={{ width: 96 }} />
          )}
        </Space>
      );
    }
    if (input.type === 'boolean') {
      const parsed = parseBooleanCondition(cell);
      return <Select size="small" value={parsed} onChange={(v) => setWhen(ri, ci, String(v) === '*' ? '-' : String(v))} optionList={BOOLEAN_OPERATORS} style={{ width: 126 }} />;
    }
    return <Input size="small" value={cell ?? ''} onChange={(v) => setWhen(ri, ci, v)} placeholder="精确匹配，- 为任意" style={{ width: 150 }} />;
  };

  const th = { position: 'sticky', top: 0, zIndex: 2, padding: '8px 10px', border: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-1)', whiteSpace: 'nowrap' } as const;
  const td = { padding: '6px 8px', border: '1px solid var(--semi-color-border)', verticalAlign: 'middle', background: 'var(--semi-color-bg-0)' } as const;

  const sectionStyle = { padding: '2px 0 12px', borderBottom: '1px solid var(--semi-color-border)' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={sectionStyle}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>输入列</Text>
        {inputs.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <Input size="small" value={c.key} onChange={(v) => setInput(i, { key: v })} placeholder="key" style={{ width: 150 }} />
            <Input size="small" value={c.label} onChange={(v) => setInput(i, { label: v })} placeholder="名称" style={{ width: 150 }} />
            <Input size="small" value={c.expr} onChange={(v) => setInput(i, { expr: v })} placeholder="取值表达式 form.amount" style={{ flex: 1, minWidth: 160 }} />
            <Select size="small" value={c.type} onChange={(v) => setInput(i, { type: v as RuleFieldType })} optionList={TYPES} style={{ width: 100, flexShrink: 0 }} />
            <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => delInput(i)} />
          </div>
        ))}
        <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={addInput} style={{ marginTop: 6 }}>加输入列</Button>
      </div>
      <div style={sectionStyle}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>输出列</Text>
        {outputs.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <Input size="small" value={c.key} onChange={(v) => setOutput(i, { key: v })} placeholder="key" style={{ width: 150 }} />
            <Input size="small" value={c.label} onChange={(v) => setOutput(i, { label: v })} placeholder="名称" style={{ width: 150 }} />
            <Select size="small" value={c.type} onChange={(v) => setOutput(i, { type: v as RuleFieldType })} optionList={TYPES} style={{ width: 100, flexShrink: 0 }} />
            {literalInput(c.default, c.type, (v) => setOutputDefault(i, c, v), '默认值')}
            <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => delOutput(i)} />
          </div>
        ))}
        <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={addOutput} style={{ marginTop: 6 }}>加输出列</Button>
      </div>
      <div style={{ padding: '2px 0 0' }}>
        <Space spacing={8} align="center">
          <Text strong>规则矩阵</Text>
          <Tag size="small">{hitPolicy === 'priority' ? '优先级生效' : '按当前命中策略求值'}</Tag>
        </Space>
        <Text type="tertiary" size="small" style={{ display: 'block' }}>数值条件可选比较符或区间，布尔条件用下拉，文本条件精确匹配；留空或 - 为任意。</Text>
        {inputs.length === 0 && outputs.length === 0 ? (
          <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>请先添加输入列 / 输出列，再添加规则行</Text>
        ) : (
          <>
            {rules.length > 0 && (
              <div style={{ overflowX: 'auto', maxHeight: '54vh', marginTop: 8, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, minWidth: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, left: 0, zIndex: 4, minWidth: 52 }}>#</th>
                      <th style={{ ...th, minWidth: 140 }}>规则名</th>
                      {hitPolicy === 'priority' && <th style={{ ...th, minWidth: 96 }}>优先级</th>}
                      {inputs.map((c) => <th key={c.key} style={{ ...th, minWidth: c.type === 'number' ? 280 : 170 }}>条件 · {c.label || c.key}</th>)}
                      {outputs.map((c) => <th key={c.key} style={{ ...th, minWidth: 150, background: 'var(--semi-color-fill-0)' }}>输出 · {c.label || c.key}</th>)}
                      <th style={{ ...th, right: 0, zIndex: 4, minWidth: 168 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r, ri) => (
                      <tr key={r.id}>
                        <td style={{ ...td, position: 'sticky', left: 0, zIndex: 1, textAlign: 'center' }}><Text code>{ri + 1}</Text></td>
                        <td style={td}><Input size="small" value={r.label ?? ''} onChange={(v) => setRow(ri, { label: v || undefined })} placeholder={r.id} style={{ width: 126 }} /></td>
                        {hitPolicy === 'priority' && (
                          <td style={td}><InputNumber size="small" value={r.priority ?? 0} onChange={(v) => setRow(ri, { priority: v == null || v === '' ? undefined : Number(v) })} style={{ width: 82 }} /></td>
                        )}
                        {inputs.map((input, ci) => <td key={input.key || ci} style={td}>{renderCondition(ri, input, ci, r.when[ci])}</td>)}
                        {outputs.map((o) => <td key={o.key} style={td}>{literalInput(r.then[o.key], o.type, (v) => setThen(ri, o, v), o.default == null ? '输出值' : `默认 ${String(o.default)}`)}</td>)}
                        <td style={{ ...td, position: 'sticky', right: 0, zIndex: 1 }}>
                          <Space spacing={2} style={{ flexWrap: 'nowrap' }}>
                            <Button size="small" theme="borderless" icon={<ChevronUp size={14} />} disabled={ri === 0} onClick={() => moveRow(ri, -1)} />
                            <Button size="small" theme="borderless" icon={<ChevronDown size={14} />} disabled={ri === rules.length - 1} onClick={() => moveRow(ri, 1)} />
                            <Button size="small" theme="borderless" onClick={() => dupRow(ri)}>复制</Button>
                            <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => delRow(ri)} />
                          </Space>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={addRow} style={{ marginTop: 6 }}>加规则行</Button>
          </>
        )}
      </div>
    </div>
  );
}
