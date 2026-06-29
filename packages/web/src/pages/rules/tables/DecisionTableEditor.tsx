import { Button, Input, Select, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleFieldType } from '@zenith/shared';

const { Text } = Typography;
const TYPES = [{ value: 'string', label: '文本' }, { value: 'number', label: '数值' }, { value: 'boolean', label: '布尔' }];

interface Props {
  inputs: RuleDecisionInput[];
  outputs: RuleDecisionOutput[];
  rules: RuleDecisionRow[];
  onChange: (next: { inputs: RuleDecisionInput[]; outputs: RuleDecisionOutput[]; rules: RuleDecisionRow[] }) => void;
}

let rid = 0;
const newRowId = () => `r${Date.now()}_${rid++}`;

/** 决策表可视化编辑器：输入列/输出列卡片 + 规则矩阵（行=规则，列=各输入条件 + 各输出值）。 */
export default function DecisionTableEditor({ inputs, outputs, rules, onChange }: Readonly<Props>) {
  const emit = (p: Partial<{ inputs: RuleDecisionInput[]; outputs: RuleDecisionOutput[]; rules: RuleDecisionRow[] }>) =>
    onChange({ inputs, outputs, rules, ...p });

  const setInput = (i: number, patch: Partial<RuleDecisionInput>) => emit({ inputs: inputs.map((x, k) => k === i ? { ...x, ...patch } : x) });
  const setOutput = (i: number, patch: Partial<RuleDecisionOutput>) => emit({ outputs: outputs.map((x, k) => k === i ? { ...x, ...patch } : x) });
  const addInput = () => emit({ inputs: [...inputs, { key: `in${inputs.length + 1}`, label: '输入', expr: '', type: 'number' }] });
  const addOutput = () => emit({ outputs: [...outputs, { key: `out${outputs.length + 1}`, label: '输出', type: 'string' }] });
  const delInput = (i: number) => emit({ inputs: inputs.filter((_, k) => k !== i), rules: rules.map((r) => ({ ...r, when: r.when.filter((_, k) => k !== i) })) });
  const delOutput = (i: number) => { const key = outputs[i].key; emit({ outputs: outputs.filter((_, k) => k !== i), rules: rules.map((r) => { const t = { ...r.then }; delete t[key]; return { ...r, then: t }; }) }); };
  const addRow = () => emit({ rules: [...rules, { id: newRowId(), when: inputs.map(() => '-'), then: {} }] });
  const setWhen = (ri: number, ci: number, v: string) => emit({ rules: rules.map((r, k) => k === ri ? { ...r, when: r.when.map((w, j) => j === ci ? v : w) } : r) });
  const setThen = (ri: number, key: string, v: string) => emit({ rules: rules.map((r, k) => k === ri ? { ...r, then: { ...r.then, [key]: v } } : r) });
  const delRow = (ri: number) => emit({ rules: rules.filter((_, k) => k !== ri) });

  const col = { padding: '4px 6px', border: '1px solid var(--semi-color-border)' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Text strong>输入列</Text>
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
      <div>
        <Text strong>输出列</Text>
        {outputs.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <Input size="small" value={c.key} onChange={(v) => setOutput(i, { key: v })} placeholder="key" style={{ flex: 1, minWidth: 150 }} />
            <Input size="small" value={c.label} onChange={(v) => setOutput(i, { label: v })} placeholder="名称" style={{ flex: 1, minWidth: 150 }} />
            <Select size="small" value={c.type} onChange={(v) => setOutput(i, { type: v as RuleFieldType })} optionList={TYPES} style={{ width: 100, flexShrink: 0 }} />
            <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => delOutput(i)} />
          </div>
        ))}
        <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={addOutput} style={{ marginTop: 6 }}>加输出列</Button>
      </div>
      <div>
        <Text strong>规则矩阵</Text>
        <Text type="tertiary" size="small" style={{ display: 'block' }}>条件单元格：<code>{'>= 100'}</code>、<code>10-20</code>、<code>gold</code>，留空/<code>-</code> 为通配</Text>
        <div style={{ overflowX: 'auto', marginTop: 6 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              {inputs.map((c) => <th key={c.key} style={col}>{c.label}</th>)}
              {outputs.map((c) => <th key={c.key} style={{ ...col, background: 'var(--semi-color-fill-0)' }}>{c.label}</th>)}
              <th style={col} />
            </tr></thead>
            <tbody>
              {rules.map((r, ri) => (
                <tr key={r.id}>
                  {inputs.map((_, ci) => <td key={ci} style={col}><Input size="small" value={r.when[ci] ?? ''} onChange={(v) => setWhen(ri, ci, v)} style={{ width: 110 }} /></td>)}
                  {outputs.map((o) => <td key={o.key} style={col}><Input size="small" value={String(r.then[o.key] ?? '')} onChange={(v) => setThen(ri, o.key, v)} style={{ width: 110 }} /></td>)}
                  <td style={col}><Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => delRow(ri)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={addRow} style={{ marginTop: 6 }}>加规则行</Button>
      </div>
    </div>
  );
}
