import { useRef, useState } from 'react';
import { Button, Checkbox, DatePicker, Input, InputNumber, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { RuleDecisionInput, RuleDecisionOutput, RuleDecisionRow, RuleFieldType, RuleHitPolicy, ParsedRuleCell } from '@zenith/shared';
import { parseRuleCell } from '@zenith/shared';
import { useDictList } from '@/hooks/queries/dicts';
import { useDictItems } from '@/hooks/useDictItems';
import { formatDateTimeForApi } from '@/utils/date';
import { coerceRuleValue, isWildcardCell } from './ruleTableUtils';

const { Text } = Typography;
const TYPES = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数值' },
  { value: 'boolean', label: '布尔' },
  { value: 'date', label: '日期' },
];
const NUMBER_OPERATORS = [
  { value: '*', label: '任意' },
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: 'range', label: '区间' },
  { value: 'in', label: 'in' },
  { value: 'notin', label: 'not in' },
];
const DATE_OPERATORS = NUMBER_OPERATORS.filter((o) => o.value !== 'in' && o.value !== 'notin');
const BOOLEAN_OPERATORS = [
  { value: '*', label: '任意' },
  { value: 'true', label: '为真' },
  { value: 'false', label: '为假' },
  { value: '!= true', label: '不为真' },
  { value: '!= false', label: '不为假' },
];
const BOUND_MIN_OPTIONS = [{ value: 'inc', label: '≥' }, { value: 'exc', label: '>' }];
const BOUND_MAX_OPTIONS = [{ value: 'inc', label: '≤' }, { value: 'exc', label: '<' }];

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

interface RangeCondition {
  op: string;
  left?: number;
  right?: number;
  minInc: boolean;
  maxInc: boolean;
  list: string;
}

/** 结构化条件 → UI 状态（number/date 共用；date 的数值为时间戳） */
function toRangeCondition(parsed: ParsedRuleCell): RangeCondition {
  const base: RangeCondition = { op: '*', minInc: true, maxInc: true, list: '' };
  switch (parsed.kind) {
    case 'cmp':
      return { ...base, op: parsed.op === '==' ? '=' : parsed.op, left: parsed.operand };
    case 'interval':
      return { ...base, op: 'range', left: parsed.min, right: parsed.max, minInc: parsed.minInc, maxInc: parsed.maxInc };
    case 'in':
      return { ...base, op: parsed.negate ? 'notin' : 'in', list: parsed.values.join(',') };
    case 'eq':
      return { ...base, op: '=', left: Number(parsed.value) };
    case 'ne':
      return { ...base, op: '!=', left: Number(parsed.value) };
    default:
      return base;
  }
}

function buildNumberCondition(c: RangeCondition): string {
  if (c.op === '*') return '-';
  if (c.op === 'in' || c.op === 'notin') {
    const list = c.list.split(',').map((s) => s.trim()).filter(Boolean).join(',');
    return list ? `${c.op === 'notin' ? 'not in' : 'in'} ${list}` : '';
  }
  if (c.op === 'range') {
    if (c.left == null || c.right == null) return '';
    if (c.minInc && c.maxInc) return `${c.left}-${c.right}`;
    return `${c.minInc ? '[' : '('}${c.left}..${c.right}${c.maxInc ? ']' : ')'}`;
  }
  if (c.left == null) return '';
  return c.op === '=' ? String(c.left) : `${c.op} ${c.left}`;
}

function buildDateCondition(c: { op: string; left?: string; right?: string }): string {
  if (c.op === '*') return '-';
  if (c.op === 'range') return c.left && c.right ? `[${c.left}..${c.right}]` : '';
  if (!c.left) return '';
  return c.op === '=' ? c.left : `${c.op} ${c.left}`;
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

const tsToText = (ts: number | undefined): string | undefined => (ts == null ? undefined : formatDateTimeForApi(ts));

/** 字典条件选择：单选=等值，多选=in 集合；不可表达的语法回退原始文本框 */
function DictConditionCell({ dictCode, cell, onChange }: Readonly<{ dictCode: string; cell: string | undefined; onChange: (v: string) => void }>) {
  const { items } = useDictItems(dictCode);
  const parsed = parseRuleCell(cell, 'string');
  const representable = parsed.kind === 'any' || parsed.kind === 'eq' || (parsed.kind === 'in' && !parsed.negate);
  if (!representable) {
    return <Input size="small" value={cell ?? ''} onChange={onChange} placeholder="值 / in a,b / != x" style={{ width: 168 }} />;
  }
  const selected = parsed.kind === 'eq' ? [String(parsed.value)] : parsed.kind === 'in' ? parsed.values.map(String) : [];
  return (
    <Select
      size="small"
      multiple
      showClear
      maxTagCount={2}
      value={selected}
      placeholder="任意"
      optionList={items.map((i) => ({ value: i.value, label: i.label }))}
      onChange={(next) => {
        const values = (next as string[] | undefined) ?? [];
        onChange(values.length === 0 ? '-' : values.length === 1 ? values[0] : `in ${values.join(',')}`);
      }}
      style={{ minWidth: 168, maxWidth: 240 }}
    />
  );
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
  if (type === 'date') {
    return (
      <DatePicker
        size="small"
        type="dateTime"
        value={value == null || value === '' ? undefined : String(value)}
        onChange={(d) => onChange(d == null ? undefined : formatDateTimeForApi(d as Date))}
        placeholder={placeholder ?? '选择时间'}
        style={{ width: 200 }}
      />
    );
  }
  return <Input size="small" value={value == null ? '' : String(value)} onChange={(v) => onChange(v || undefined)} placeholder={placeholder} style={{ width: 128 }} />;
}

/** 决策表可视化编辑器：输入列/输出列卡片 + 规则矩阵（行=规则，列=各输入条件 + 各输出值）。 */
export default function DecisionTableEditor({ inputs, outputs, rules, hitPolicy, onChange }: Readonly<Props>) {
  const dictListQuery = useDictList({ page: 1, pageSize: 100 });
  const dictOptions = (dictListQuery.data?.list ?? []).map((d) => ({ value: d.code, label: `${d.name}（${d.code}）` }));
  // 条件尚不完整（缺操作数）时暂存已选操作符，避免受控 Select 因单元格文本回退为通配而跳回「任意」
  const [pendingOps, setPendingOps] = useState<Record<string, string>>({});
  // 输出列 key 处于与其它列重复的中间态时，记录数据真正归属的原 key，待 key 唯一后再迁移
  const renameSourceRef = useRef<Record<number, string>>({});

  const emit = (p: Partial<{ inputs: RuleDecisionInput[]; outputs: RuleDecisionOutput[]; rules: RuleDecisionRow[] }>) =>
    onChange({ inputs, outputs, rules, ...p });

  const setInput = (i: number, patch: Partial<RuleDecisionInput>) => {
    // 切换类型时清空不再适用的字典绑定
    const merged = { ...inputs[i], ...patch };
    if (merged.type !== 'string' && merged.dictCode) merged.dictCode = null;
    emit({ inputs: inputs.map((x, k) => (k === i ? merged : x)) });
  };
  // 输出列 key 重命名时同步迁移各规则行 then 中的旧键；key 与其它列重复的中间态不迁移，防止覆盖他列数据
  const setOutput = (i: number, patch: Partial<RuleDecisionOutput>) => {
    const prevKey = outputs[i].key;
    const nextOutputs = outputs.map((x, k) => k === i ? { ...x, ...patch } : x);
    if (patch.key === undefined || patch.key === prevKey) {
      emit({ outputs: nextOutputs });
      return;
    }
    const nextKey = patch.key;
    const sourceKey = renameSourceRef.current[i] ?? prevKey;
    const duplicated = outputs.some((o, k) => k !== i && o.key === nextKey);
    if (duplicated || !nextKey.trim()) {
      renameSourceRef.current[i] = sourceKey;
      emit({ outputs: nextOutputs });
      return;
    }
    delete renameSourceRef.current[i];
    if (sourceKey === nextKey) {
      emit({ outputs: nextOutputs });
      return;
    }
    const nextRules = rules.map((r) => {
      if (!Object.prototype.hasOwnProperty.call(r.then, sourceKey)) return r;
      const then = { ...r.then, [nextKey]: r.then[sourceKey] };
      delete then[sourceKey];
      return { ...r, then };
    });
    emit({ outputs: nextOutputs, rules: nextRules });
  };
  // 新增输入列时为既有规则行补齐通配条件，保持 when 与 inputs 位置对齐
  const addInput = () => emit({
    inputs: [...inputs, { key: `in${inputs.length + 1}`, label: '输入', expr: '', type: 'number' }],
    rules: rules.map((r) => ({ ...r, when: [...r.when, '-'] })),
  });
  const addOutput = () => { renameSourceRef.current = {}; emit({ outputs: [...outputs, { key: `out${outputs.length + 1}`, label: '输出', type: 'string' }] }); };
  const delInput = (i: number) => emit({ inputs: inputs.filter((_, k) => k !== i), rules: rules.map((r) => ({ ...r, when: r.when.filter((_, k) => k !== i) })) });
  const delOutput = (i: number) => { renameSourceRef.current = {}; const key = outputs[i].key; emit({ outputs: outputs.filter((_, k) => k !== i), rules: rules.map((r) => { const t = { ...r.then }; delete t[key]; return { ...r, then: t }; }) }); };
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
    const value = v === undefined || v === '' ? undefined : output.isExpr ? String(v) : coerceRuleValue(v, output.type);
    emit({ rules: rules.map((r, k) => k === ri ? { ...r, then: { ...r.then, [output.key]: value as string | number | boolean | null } } : r) });
  };
  const delRow = (ri: number) => emit({ rules: rules.filter((_, k) => k !== ri) });

  const setOutputDefault = (i: number, output: RuleDecisionOutput, value: string | number | boolean | null | undefined) => {
    const next = value === undefined || value === '' ? undefined : coerceRuleValue(value, output.type);
    setOutput(i, { default: next as string | number | boolean | null | undefined });
  };

  const renderNumberCondition = (ri: number, ci: number, cell: string | undefined) => {
    const pendingKey = `${rules[ri].id}:${ci}`;
    const parsed = toRangeCondition(parseRuleCell(cell, 'number'));
    // 已选但操作数未填完整时以暂存操作符为准（此时单元格文本仍保留旧条件或通配）
    const c: RangeCondition = { ...parsed, op: pendingOps[pendingKey] ?? parsed.op };
    const set = (patch: Partial<RangeCondition>) => {
      const merged = { ...c, ...patch };
      const built = buildNumberCondition(merged);
      if (built !== '') {
        setWhen(ri, ci, built);
        if (pendingOps[pendingKey] !== undefined) setPendingOps((prev) => { const next = { ...prev }; delete next[pendingKey]; return next; });
      } else {
        setPendingOps((prev) => ({ ...prev, [pendingKey]: merged.op }));
      }
    };
    return (
      <Space spacing={4} align="center" style={{ flexWrap: 'nowrap' }}>
        <Select size="small" value={c.op} onChange={(op) => set({ op: String(op) })} optionList={NUMBER_OPERATORS} style={{ width: 84 }} />
        {c.op === 'range' && (
          <>
            <Select size="small" value={c.minInc ? 'inc' : 'exc'} onChange={(v) => set({ minInc: v === 'inc' })} optionList={BOUND_MIN_OPTIONS} style={{ width: 58 }} />
            <InputNumber size="small" value={c.left} onChange={(v) => set({ left: v == null || v === '' ? undefined : Number(v) })} style={{ width: 82 }} />
            <Text type="tertiary" size="small">至</Text>
            <InputNumber size="small" value={c.right} onChange={(v) => set({ right: v == null || v === '' ? undefined : Number(v) })} style={{ width: 82 }} />
            <Select size="small" value={c.maxInc ? 'inc' : 'exc'} onChange={(v) => set({ maxInc: v === 'inc' })} optionList={BOUND_MAX_OPTIONS} style={{ width: 58 }} />
          </>
        )}
        {(c.op === 'in' || c.op === 'notin') && (
          <Input size="small" value={c.list} onChange={(v) => set({ list: v })} placeholder="1,2,3" style={{ width: 150 }} />
        )}
        {c.op !== '*' && c.op !== 'range' && c.op !== 'in' && c.op !== 'notin' && (
          <InputNumber size="small" value={c.left} onChange={(v) => set({ left: v == null || v === '' ? undefined : Number(v) })} style={{ width: 96 }} />
        )}
      </Space>
    );
  };

  const renderDateCondition = (ri: number, ci: number, cell: string | undefined) => {
    const pendingKey = `${rules[ri].id}:${ci}`;
    const parsed = toRangeCondition(parseRuleCell(cell, 'date'));
    const state = { op: pendingOps[pendingKey] ?? parsed.op, left: tsToText(parsed.left), right: tsToText(parsed.right) };
    const set = (patch: Partial<typeof state>) => {
      const merged = { ...state, ...patch };
      const built = buildDateCondition(merged);
      if (built !== '') {
        setWhen(ri, ci, built);
        if (pendingOps[pendingKey] !== undefined) setPendingOps((prev) => { const next = { ...prev }; delete next[pendingKey]; return next; });
      } else {
        setPendingOps((prev) => ({ ...prev, [pendingKey]: merged.op }));
      }
    };
    const picker = (value: string | undefined, onPick: (v?: string) => void) => (
      <DatePicker size="small" type="dateTime" value={value} onChange={(d) => onPick(d == null ? undefined : formatDateTimeForApi(d as Date))} style={{ width: 196 }} />
    );
    return (
      <Space spacing={4} align="center" style={{ flexWrap: 'nowrap' }}>
        <Select size="small" value={state.op} onChange={(op) => set({ op: String(op) })} optionList={DATE_OPERATORS} style={{ width: 84 }} />
        {state.op === 'range' ? (
          <>
            {picker(state.left, (v) => set({ left: v }))}
            <Text type="tertiary" size="small">至</Text>
            {picker(state.right, (v) => set({ right: v }))}
          </>
        ) : state.op === '*' ? null : picker(state.left, (v) => set({ left: v }))}
      </Space>
    );
  };

  const renderCondition = (ri: number, input: RuleDecisionInput, ci: number, cell: string | undefined) => {
    if (input.type === 'number') return renderNumberCondition(ri, ci, cell);
    if (input.type === 'date') return renderDateCondition(ri, ci, cell);
    if (input.type === 'boolean') {
      const parsed = parseBooleanCondition(cell);
      return <Select size="small" value={parsed} onChange={(v) => setWhen(ri, ci, String(v) === '*' ? '-' : String(v))} optionList={BOOLEAN_OPERATORS} style={{ width: 126 }} />;
    }
    if (input.dictCode) {
      return <DictConditionCell dictCode={input.dictCode} cell={cell} onChange={(v) => setWhen(ri, ci, v)} />;
    }
    return <Input size="small" value={cell ?? ''} onChange={(v) => setWhen(ri, ci, v)} placeholder="值 / in a,b / != x；- 任意" style={{ width: 168 }} />;
  };

  const renderThenInput = (ri: number, o: RuleDecisionOutput, raw: unknown) => {
    if (o.isExpr) {
      return <Input size="small" value={raw == null ? '' : String(raw)} onChange={(v) => setThen(ri, o, v)} placeholder="= form.amount * 0.8" style={{ width: 176 }} />;
    }
    return literalInput(raw, o.type, (v) => setThen(ri, o, v), o.default == null ? '输出值' : `默认 ${String(o.default)}`);
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
            <Input size="small" value={c.key} onChange={(v) => setInput(i, { key: v })} placeholder="key" style={{ width: 140 }} />
            <Input size="small" value={c.label} onChange={(v) => setInput(i, { label: v })} placeholder="名称" style={{ width: 140 }} />
            <Input size="small" value={c.expr} onChange={(v) => setInput(i, { expr: v })} placeholder="取值表达式 form.amount" style={{ flex: 1, minWidth: 150 }} />
            <Select size="small" value={c.type} onChange={(v) => setInput(i, { type: v as RuleFieldType })} optionList={TYPES} style={{ width: 92, flexShrink: 0 }} />
            {c.type === 'string' && (
              <Select
                size="small"
                value={c.dictCode ?? undefined}
                onChange={(v) => setInput(i, { dictCode: (v as string) || null })}
                optionList={dictOptions}
                showClear
                filter
                placeholder="字典(可选)"
                style={{ width: 168, flexShrink: 0 }}
              />
            )}
            <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => delInput(i)} />
          </div>
        ))}
        <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={addInput} style={{ marginTop: 6 }}>加输入列</Button>
      </div>
      <div style={sectionStyle}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>输出列</Text>
        {outputs.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <Input size="small" value={c.key} onChange={(v) => setOutput(i, { key: v })} placeholder="key" style={{ width: 140 }} />
            <Input size="small" value={c.label} onChange={(v) => setOutput(i, { label: v })} placeholder="名称" style={{ width: 140 }} />
            <Select size="small" value={c.type} onChange={(v) => setOutput(i, { type: v as RuleFieldType })} optionList={TYPES} style={{ width: 92, flexShrink: 0 }} />
            {literalInput(c.default, c.type, (v) => setOutputDefault(i, c, v), '默认值')}
            <Checkbox checked={!!c.isExpr} onChange={(e) => setOutput(i, { isExpr: !!e.target.checked })}>表达式</Checkbox>
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
        <Text type="tertiary" size="small" style={{ display: 'block' }}>数值/日期条件支持比较、开闭区间与 in 集合；文本支持精确值、in 集合、!=；勾选「表达式」的输出列以 = 开头引用输入（如 = form.amount * 0.8）。</Text>
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
                      {inputs.map((c) => <th key={c.key} style={{ ...th, minWidth: c.type === 'number' ? 300 : c.type === 'date' ? 320 : 180 }}>条件 · {c.label || c.key}</th>)}
                      {outputs.map((c) => <th key={c.key} style={{ ...th, minWidth: 150, background: 'var(--semi-color-fill-0)' }}>输出 · {c.label || c.key}{c.isExpr ? '（表达式）' : ''}</th>)}
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
                        {outputs.map((o) => <td key={o.key} style={td}>{renderThenInput(ri, o, r.then[o.key])}</td>)}
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
