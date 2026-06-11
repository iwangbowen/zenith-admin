/**
 * CronBuilderModal — 全功能 Cron 表达式可视化编辑器
 *
 * 支持 6 字段（秒/分/时/日/月/周），每个字段支持：
 *   every   → *
 *   interval→ * /N（每隔 N）
 *   specific→ a,b,c（指定多个值）
 *   range   → a-b（连续范围）
 */
import { useState, useEffect, useCallback } from 'react';
import { Button, InputNumber, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';

type FieldKey = 'sec' | 'min' | 'hour' | 'dom' | 'month' | 'dow';
type FieldMode = 'every' | 'interval' | 'specific' | 'range';

interface FieldConfig {
  mode: FieldMode;
  interval: number;
  specific: number[];
  rangeStart: number;
  rangeEnd: number;
}

type CronState = Record<FieldKey, FieldConfig>;

const FIELD_META: { key: FieldKey; label: string; min: number; max: number; names?: string[] }[] = [
  { key: 'sec',   label: '秒',   min: 0,  max: 59 },
  { key: 'min',   label: '分',   min: 0,  max: 59 },
  { key: 'hour',  label: '时',   min: 0,  max: 23 },
  { key: 'dom',   label: '日',   min: 1,  max: 31 },
  {
    key: 'month', label: '月',   min: 1,  max: 12,
    names: ['', '一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'],
  },
  {
    key: 'dow',   label: '周',   min: 0,  max: 6,
    names: ['周日','周一','周二','周三','周四','周五','周六'],
  },
];

function defaultField(min: number, max: number): FieldConfig {
  return { mode: 'every', interval: 1, specific: [], rangeStart: min, rangeEnd: max };
}

function fieldToExpr(cfg: FieldConfig, min: number): string {
  switch (cfg.mode) {
    case 'every':    return '*';
    case 'interval': return `*/${Math.max(1, cfg.interval)}`;
    case 'specific': {
      const vals = [...cfg.specific].sort((a, b) => a - b);
      return vals.length > 0 ? vals.join(',') : String(min);
    }
    case 'range':    return `${cfg.rangeStart}-${cfg.rangeEnd}`;
    default:         return '*';
  }
}

function buildCronFromState(state: CronState): string {
  return [
    fieldToExpr(state.sec,   0),
    fieldToExpr(state.min,   0),
    fieldToExpr(state.hour,  0),
    fieldToExpr(state.dom,   1),
    fieldToExpr(state.month, 1),
    fieldToExpr(state.dow,   0),
  ].join(' ');
}

function describeField(cfg: FieldConfig, meta: typeof FIELD_META[number]): string {
  const { label, names } = meta;
  const getName = (v: number) => names?.[v] ?? String(v);
  switch (cfg.mode) {
    case 'every':    return `每${label}`;
    case 'interval': return `每隔 ${cfg.interval} ${label}`;
    case 'specific': {
      if (cfg.specific.length === 0) return `${label}（未指定）`;
      return [...cfg.specific].sort((a, b) => a - b).map(getName).join('、');
    }
    case 'range':    return `${getName(cfg.rangeStart)} 至 ${getName(cfg.rangeEnd)}`;
    default:         return '*';
  }
}

function describeExpression(state: CronState): string {
  const sec   = state.sec.mode   === 'every' ? '' : `${describeField(state.sec,   FIELD_META[0])}`;
  const min   = describeField(state.min,   FIELD_META[1]);
  const hour  = describeField(state.hour,  FIELD_META[2]);
  const dom   = state.dom.mode   === 'every' ? '' : describeField(state.dom,   FIELD_META[3]);
  const month = state.month.mode === 'every' ? '' : describeField(state.month, FIELD_META[4]);
  const dow   = state.dow.mode   === 'every' ? '' : describeField(state.dow,   FIELD_META[5]);

  const parts: string[] = [];
  if (month) parts.push(month);
  if (dom)   parts.push(dom);
  if (dow)   parts.push(`星期${dow}`);
  const secPart = sec ? ` ${sec}` : '';
  parts.push(`${hour} ${min}${secPart}`);
  return parts.join(' ') + ' 执行';
}

/** Parse a single cron field token back to FieldConfig */
function parseFieldToken(token: string, min: number, max: number): FieldConfig {
  const base = defaultField(min, max);
  if (!token || token === '*') return base;
  if (/^\*\/(\d+)$/.test(token)) {
    const n = Number.parseInt(/^\*\/(\d+)$/.exec(token)![1], 10);
    return { ...base, mode: 'interval', interval: n };
  }
  if (/^(\d+)-(\d+)$/.test(token)) {
    const m = /^(\d+)-(\d+)$/.exec(token)!;
    return { ...base, mode: 'range', rangeStart: Number.parseInt(m[1], 10), rangeEnd: Number.parseInt(m[2], 10) };
  }
  if (/^\d+(,\d+)*$/.test(token)) {
    return { ...base, mode: 'specific', specific: token.split(',').map(Number) };
  }
  return base;
}

function parseExprToState(expr: string): CronState {
  const parts = expr.trim().split(/\s+/);
  const p = parts.length === 6 ? parts : ['0', '*', '*', '*', '*', '*'];
  return {
    sec:   parseFieldToken(p[0], 0,  59),
    min:   parseFieldToken(p[1], 0,  59),
    hour:  parseFieldToken(p[2], 0,  23),
    dom:   parseFieldToken(p[3], 1,  31),
    month: parseFieldToken(p[4], 1,  12),
    dow:   parseFieldToken(p[5], 0,   6),
  };
}

// ─── SpecificPicker ─────────────────────────────────────────────────────────

interface SpecificPickerProps {
  readonly min: number;
  readonly max: number;
  readonly value: number[];
  readonly onChange: (v: number[]) => void;
  readonly names?: string[];
}

function SpecificPicker({ min, max, value, onChange, names }: SpecificPickerProps) {
  const opts = Array.from({ length: max - min + 1 }, (_, i) => ({
    value: i + min,
    label: names ? (names[i + min] ?? String(i + min)) : String(i + min),
  }));
  return (
    <Select
      multiple
      value={value}
      onChange={(v) => onChange(v as number[])}
      optionList={opts}
      style={{ width: '100%' }}
      placeholder="选择具体值"
      maxTagCount={8}
    />
  );
}

// ─── FieldEditor ─────────────────────────────────────────────────────────────

interface FieldEditorProps {
  readonly meta: typeof FIELD_META[number];
  readonly config: FieldConfig;
  readonly onChange: (cfg: FieldConfig) => void;
}

function FieldEditor({ meta, config, onChange }: FieldEditorProps) {
  const { min, max, names } = meta;
  const set = (patch: Partial<FieldConfig>) => onChange({ ...config, ...patch });

  const modeOptions = [
    { value: 'every',    label: '每个' },
    { value: 'interval', label: '每隔 N' },
    { value: 'specific', label: '指定值' },
    { value: 'range',    label: '范围' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {modeOptions.map((opt) => (
          <Button
            key={opt.value}
            size="small"
            theme={config.mode === opt.value ? 'solid' : 'light'}
            type={config.mode === opt.value ? 'primary' : 'tertiary'}
            onClick={() => set({ mode: opt.value as FieldMode })}
          >{opt.label}</Button>
        ))}
      </div>

      {config.mode === 'every' && (
        <Typography.Text type="tertiary" size="small">不限制，每{meta.label}都执行（*）</Typography.Text>
      )}

      {config.mode === 'interval' && (
        <Space>
          <span style={{ fontSize: 13 }}>每隔</span>
          <InputNumber
            value={config.interval}
            onChange={(v) => set({ interval: Math.max(1, Number(v) || 1) })}
            min={1}
            max={max - min}
            style={{ width: 80 }}
          />
          <span style={{ fontSize: 13 }}>{meta.label}执行一次</span>
        </Space>
      )}

      {config.mode === 'specific' && (
        <SpecificPicker min={min} max={max} value={config.specific} onChange={(v) => set({ specific: v })} names={names} />
      )}

      {config.mode === 'range' && (
        <Space>
          <span style={{ fontSize: 13 }}>从</span>
          <InputNumber
            value={config.rangeStart}
            onChange={(v) => set({ rangeStart: Math.max(min, Math.min(max, Number(v) || min)) })}
            min={min}
            max={config.rangeEnd}
            style={{ width: 80 }}
          />
          <span style={{ fontSize: 13 }}>到</span>
          <InputNumber
            value={config.rangeEnd}
            onChange={(v) => set({ rangeEnd: Math.max(config.rangeStart, Math.min(max, Number(v) || max)) })}
            min={config.rangeStart}
            max={max}
            style={{ width: 80 }}
          />
          <span style={{ fontSize: 13 }}>{meta.label}</span>
        </Space>
      )}
    </div>
  );
}

// ─── CronBuilderModal ─────────────────────────────────────────────────────────

interface CronBuilderModalProps {
  readonly visible: boolean;
  readonly value: string;
  readonly onClose: () => void;
  readonly onApply: (expr: string) => void;
}

export function CronBuilderModal({ visible, value, onClose, onApply }: CronBuilderModalProps) {
  const [state, setState] = useState<CronState>(() => parseExprToState(value));
  const [activeField, setActiveField] = useState<FieldKey>('min');

  useEffect(() => {
    if (visible) setState(parseExprToState(value));
  }, [visible, value]);

  const setField = useCallback((key: FieldKey, cfg: FieldConfig) => {
    setState((prev) => ({ ...prev, [key]: cfg }));
  }, []);

  const expr = buildCronFromState(state);
  const desc = describeExpression(state);
  const activeMeta = FIELD_META.find((m) => m.key === activeField)!;

  return (
    <AppModal
      title="可视化 Cron 配置"
      visible={visible}
      onCancel={onClose}
      width={560}
      footer={(
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={() => { onApply(expr); onClose(); }}>应用</Button>
        </Space>
      )}
    >
      {/* 表达式预览 */}
      <div
        style={{
          background: 'var(--semi-color-fill-0)',
          border: '1px solid var(--semi-color-border)',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 16,
        }}
      >
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 4 }}>生成表达式</Typography.Text>
        <Typography.Text code style={{ fontSize: 14, letterSpacing: 1 }}>{expr}</Typography.Text>
        <Typography.Text type="secondary" size="small" style={{ display: 'block', marginTop: 4 }}>{desc}</Typography.Text>
      </div>

      {/* 字段选择器 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {FIELD_META.map((meta) => {
          const fieldExpr = fieldToExpr(state[meta.key], meta.min);
          const isActive = activeField === meta.key;
          const isCustom = fieldExpr !== '*';
          let tagColor: 'blue' | 'orange' | 'grey' = 'grey';
          if (isActive) tagColor = 'blue';
          else if (isCustom) tagColor = 'orange';
          return (
            <button
              key={meta.key}
              type="button"
              onClick={() => setActiveField(meta.key)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid ${isActive ? 'var(--semi-color-primary)' : 'var(--semi-color-border)'}`,
                background: isActive ? 'var(--semi-color-primary-light-default)' : 'var(--semi-color-bg-2)',
                cursor: 'pointer',
                minWidth: 64,
                transition: 'all 0.15s',
              }}
            >
              <Typography.Text size="small" type="tertiary">{meta.label}</Typography.Text>
              <Tag
                size="small"
                type={isCustom ? 'solid' : 'ghost'}
                color={tagColor}
                style={{ fontSize: 11, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >{fieldExpr}</Tag>
            </button>
          );
        })}
      </div>

      {/* 当前字段编辑器 */}
      <div
        style={{
          border: '1px solid var(--semi-color-primary-light-active)',
          borderRadius: 8,
          padding: '12px 16px',
          background: 'var(--semi-color-primary-light-default)',
        }}
      >
        <Typography.Text strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>
          {activeMeta.label}字段配置
          <Typography.Text type="tertiary" size="small" style={{ marginLeft: 8 }}>
            {activeMeta.min} – {activeMeta.max}
          </Typography.Text>
        </Typography.Text>
        <FieldEditor
          meta={activeMeta}
          config={state[activeField]}
          onChange={(cfg) => setField(activeField, cfg)}
        />
      </div>
    </AppModal>
  );
}
