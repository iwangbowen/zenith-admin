/**
 * 工作流表单渲染器 — 设计器预览和运行时（发起/审批）共用
 * 支持联动：公式实时计算、dateRange→天数、select 级联
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Form, Select, Upload, Button, Tag, Typography, Row, Col, Divider, Rating, withField } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, Eraser } from 'lucide-react';
import dayjs from 'dayjs';
import type { WorkflowFormField, WorkflowFormFieldColumn, WorkflowFieldVisibilityCondition, WorkflowFieldVisibilityRuleGroup } from '@zenith/shared';
import { CURRENCY_OPTIONS } from '../form-types';
import RegionSelect from '@/components/RegionSelect';
import RichTextEditor from '@/components/RichTextEditor';
import UserSelect from '@/components/UserSelect';
import DepartmentSelect from '@/components/DepartmentSelect';
import DictSelect from '@/components/DictSelect';

const PHONE_REGEX = /^1[3-9]\d{9}$/;
const EMAIL_REGEX = /^[\w.+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const ID_CARD_REGEX = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]$/;
const URL_REGEX = /^https?:\/\/.+/;
const SAFE_EXPR_REGEX = /^[\d+\-*/(). ]+$/;

const ValuesContext = createContext<Record<string, unknown>>({});

const getColumnKey = (parentKey: string, column: WorkflowFormFieldColumn) =>
  `${parentKey}-col-${column.span}-${column.fields.map(field => field.key).join('-') || 'empty'}`;

// ─── 字段列宽（响应式并排） ──────────────────────────────────────────
const LAYOUT_FULL_WIDTH_TYPES = new Set<string>(['row', 'divider', 'group', 'description', 'detail']);
const VALID_COLUMN_SPANS = new Set([12, 8, 6]);
function colSpanOf(field: WorkflowFormField): number {
  if (LAYOUT_FULL_WIDTH_TYPES.has(field.type)) return 24;
  return field.columnSpan && VALID_COLUMN_SPANS.has(field.columnSpan) ? field.columnSpan : 24;
}

// ─── 手写签名板 ─────────────────────────────────────────────────────
interface SignaturePadProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  width?: number;
  height?: number;
}

function SignaturePad({ value, onChange, disabled, width = 360, height = 150 }: Readonly<SignaturePadProps>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastExported = useRef<string | undefined>(undefined);

  const getCtx = () => canvasRef.current?.getContext('2d') ?? null;

  // 外部 value 变化时（如回显）绘制到画布
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    if (value === lastExported.current) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = value;
    }
    lastExported.current = value;
  }, [value]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    drawing.current = true;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1d1d1d';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const handleUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const dataUrl = canvasRef.current?.toDataURL('image/png');
    lastExported.current = dataUrl;
    onChange?.(dataUrl ?? '');
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    lastExported.current = '';
    onChange?.('');
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          border: '1px dashed var(--semi-color-border)',
          borderRadius: 6,
          background: 'var(--semi-color-bg-1)',
          touchAction: 'none',
          cursor: disabled ? 'not-allowed' : 'crosshair',
          maxWidth: '100%',
        }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
      />
      {!disabled && (
        <Button size="small" theme="borderless" icon={<Eraser size={12} />} onClick={handleClear} style={{ alignSelf: 'flex-start' }}>
          清除
        </Button>
      )}
    </div>
  );
}

const FormRegion = withField(RegionSelect);
const FormRichText = withField(RichTextEditor);
const FormSignature = withField(SignaturePad);
const FormUserSelect = withField(UserSelect);
const FormDeptSelect = withField(DepartmentSelect);
const FormDictSelect = withField(DictSelect);

export function flattenFields(fields: WorkflowFormField[]): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  for (const f of fields) {
    out.push(f);
    if (f.type === 'row' && f.columns) {
      for (const col of f.columns) out.push(...flattenFields(col.fields));
    } else if ((f.type === 'group' || f.type === 'detail') && f.children) {
      out.push(...flattenFields(f.children));
    }
  }
  return out;
}

export function evalFormula(formula: string, values: Record<string, unknown>, precision = 2): number | null {
  const replaced = formula.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = values[key.trim()];
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? String(n) : '0';
  });
  if (!SAFE_EXPR_REGEX.test(replaced)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${replaced});`)() as number;
    if (!Number.isFinite(result)) return null;
    return Number(result.toFixed(precision));
  } catch {
    return null;
  }
}

const toComparableStr = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};

function evalCondition(cond: WorkflowFieldVisibilityCondition, values: Record<string, unknown>): boolean {
  if (!cond?.field) return true;
  const left = values[cond.field];
  const right = cond.value;
  switch (cond.operator) {
    case 'eq': return left === right || toComparableStr(left) === toComparableStr(right);
    case 'neq': return left !== right && toComparableStr(left) !== toComparableStr(right);
    case 'in': {
      const arr = Array.isArray(right)
        ? right
        : (typeof right === 'string' ? right.split(',').map(s => s.trim()).filter(Boolean) : []);
      return arr.map(toComparableStr).includes(toComparableStr(left));
    }
    case 'contains': return Array.isArray(left) && left.map(toComparableStr).includes(toComparableStr(right));
    default: return true;
  }
}

function evalRuleGroup(group: WorkflowFieldVisibilityRuleGroup, values: Record<string, unknown>): boolean {
  const rules = group.rules?.filter(r => r?.field) ?? [];
  if (rules.length === 0) return true;
  return group.logic === 'or'
    ? rules.some(r => evalCondition(r, values))
    : rules.every(r => evalCondition(r, values));
}

export function isFieldVisible(field: WorkflowFormField, values: Record<string, unknown>): boolean {
  // 高级联动（多条件 and/or）优先，完全决定显隐
  if (field.visibilityRules && (field.visibilityRules.rules?.length ?? 0) > 0) {
    return evalRuleGroup(field.visibilityRules, values);
  }
  // 默认隐藏（无联动规则时始终隐藏）
  if (field.hidden) return false;
  // 兼容旧版单条件
  if (field.visibilityCondition?.field) {
    return evalCondition(field.visibilityCondition, values);
  }
  return true;
}

interface RendererProps {
  fields: WorkflowFormField[];
  initValues?: Record<string, unknown>;
  getFormApi?: (api: FormApi) => void;
  onValueChange?: (values: Record<string, unknown>) => void;
  readOnly?: boolean;
  style?: React.CSSProperties;
  labelPosition?: 'top' | 'left' | 'inset';
  labelAlign?: 'left' | 'right';
  labelWidth?: number;
}

export default function WorkflowFormRenderer({
  fields, initValues, getFormApi, onValueChange, readOnly, style, labelPosition = 'top', labelAlign, labelWidth,
}: Readonly<RendererProps>) {
  const formApiRef = useRef<FormApi | null>(null);
  const valuesRef = useRef<Record<string, unknown>>(initValues ?? {});
  const [valuesState, setValuesState] = useState<Record<string, unknown>>(initValues ?? {});

  const all = flattenFields(fields);
  const formulaFields = all.filter(f => f.type === 'formula' && f.formula);
  const dayFields = all.filter(f => f.daysFromKey && (f.type === 'number' || f.type === 'amount'));
  const cascadeFields = all.filter(f => f.optionsFrom);

  const handleValueChange = (next: Record<string, unknown>) => {
    valuesRef.current = next;
    setValuesState(next);
    const api = formApiRef.current;
    if (api) {
      // 公式
      for (const f of formulaFields) {
        if (!f.formula) continue;
        const result = evalFormula(f.formula, next, f.precision ?? 2);
        const display = result === null ? '当前不可计算' : `${result}${f.unit ?? ''}`;
        if (next[f.key] !== display) api.setValue(f.key, display);
      }
      // 日期范围 → 天数
      for (const f of dayFields) {
        if (!f.daysFromKey) continue;
        const range = next[f.daysFromKey];
        if (Array.isArray(range) && range.length === 2 && range[0] && range[1]) {
          const start = dayjs(range[0] as string | Date);
          const end = dayjs(range[1] as string | Date);
          if (start.isValid() && end.isValid()) {
            const days = end.diff(start, 'day') + 1;
            if (Number.isFinite(days) && next[f.key] !== days) {
              api.setValue(f.key, days);
            }
          }
        }
      }
      // 级联：父值变化后过滤已失效的子值
      for (const f of cascadeFields) {
        if (!f.optionsFrom) continue;
        const pv = next[f.optionsFrom.sourceKey];
        const allowed = typeof pv === 'string' ? (f.optionsFrom.mapping[pv] ?? []) : [];
        const cur = next[f.key];
        if (cur === undefined || cur === null || cur === '') continue;
        if (Array.isArray(cur)) {
          const filtered = cur.filter(v => allowed.includes(String(v)));
          if (filtered.length !== cur.length) api.setValue(f.key, filtered);
        } else if (typeof cur === 'string' && !allowed.includes(cur)) {
          api.setValue(f.key, undefined);
        }
      }
    }
    onValueChange?.(next);
  };

  return (
    <ValuesContext.Provider value={valuesState}>
      <Form
        labelPosition={labelPosition}
        labelAlign={labelAlign}
        labelWidth={labelPosition === 'left' || labelPosition === 'inset' ? (labelWidth ?? 96) : undefined}
        allowEmpty
        style={style}
        initValues={initValues}
        getFormApi={(api) => { formApiRef.current = api; getFormApi?.(api); }}
        onValueChange={handleValueChange}
      >
        <Row gutter={16}>
          {fields.map(field => (
            isFieldVisible(field, valuesState) ? (
              <Col span={colSpanOf(field)} key={field.key}>
                <FieldRenderer field={field} readOnly={readOnly} />
              </Col>
            ) : null
          ))}
        </Row>
      </Form>
    </ValuesContext.Provider>
  );
}

function FieldRenderer({ field, readOnly }: Readonly<{ field: WorkflowFormField; readOnly?: boolean }>) {
  const values = useContext(ValuesContext);
  const baseRules: Array<Record<string, unknown>> = [];
  if (field.required) baseRules.push({ required: true, message: `请填写${field.label}` });
  if (field.minLength !== undefined) baseRules.push({ type: 'string', minLength: field.minLength, message: `最少${field.minLength}个字符` });
  if (field.maxLength !== undefined) baseRules.push({ type: 'string', maxLength: field.maxLength, message: `最多${field.maxLength}个字符` });
  if (field.pattern) {
    try {
      baseRules.push({ pattern: new RegExp(field.pattern), message: field.patternMessage ?? '格式不正确' });
    } catch { /* invalid regex */ }
  }
  const numberRules: Array<Record<string, unknown>> = [];
  if (field.required) numberRules.push({ required: true, message: `请填写${field.label}` });
  if (field.min !== undefined) numberRules.push({ type: 'number', min: field.min, message: `不小于${field.min}` });
  if (field.max !== undefined) numberRules.push({ type: 'number', max: field.max, message: `不大于${field.max}` });
  const rules = baseRules.length > 0 ? baseRules : undefined;
  const helpText = field.helpText;
  // 字段级标签覆盖（labelPosition/labelAlign/labelWidth），随 extraProps 透传至每个 Form 字段
  const labelOverride: Record<string, unknown> = {};
  if (field.labelPosition) labelOverride.labelPosition = field.labelPosition;
  if (field.labelAlign) labelOverride.labelAlign = field.labelAlign;
  if (field.labelWidth) labelOverride.labelWidth = field.labelWidth;
  const extraProps = { ...(helpText ? { extraText: helpText } : {}), ...labelOverride };
  const unitSuffix = field.unit ? `（${field.unit}）` : '';
  const numberLabel = `${field.label}${unitSuffix}`;
  const disabled = readOnly || field.readOnly;

  switch (field.type) {
    case 'text':
      return (
        <Form.Input
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          initValue={field.defaultValue} rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'textarea':
      return (
        <Form.TextArea
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          autosize={{ minRows: 2, maxRows: 6 }}
          initValue={field.defaultValue} rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'phone':
      return (
        <Form.Input
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? '请输入手机号'}
          initValue={field.defaultValue} disabled={disabled}
          rules={[
            ...(field.required ? [{ required: true, message: `请填写${field.label}` }] : []),
            { pattern: PHONE_REGEX, message: '手机号格式不正确' },
          ]}
          {...extraProps}
        />
      );

    case 'email':
      return (
        <Form.Input
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? '请输入邮箱'}
          initValue={field.defaultValue} disabled={disabled}
          rules={[
            ...(field.required ? [{ required: true, message: `请填写${field.label}` }] : []),
            { pattern: EMAIL_REGEX, message: '邮箱格式不正确' },
          ]}
          {...extraProps}
        />
      );

    case 'idCard':
      return (
        <Form.Input
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? '请输入身份证号'}
          initValue={field.defaultValue} maxLength={18} disabled={disabled}
          rules={[
            ...(field.required ? [{ required: true, message: `请填写${field.label}` }] : []),
            { pattern: ID_CARD_REGEX, message: '身份证号格式不正确' },
          ]}
          {...extraProps}
        />
      );

    case 'url':
      return (
        <Form.Input
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? '请输入网址'}
          initValue={field.defaultValue} disabled={disabled}
          rules={[
            ...(field.required ? [{ required: true, message: `请填写${field.label}` }] : []),
            { pattern: URL_REGEX, message: '网址需以 http:// 或 https:// 开头' },
          ]}
          {...extraProps}
        />
      );

    case 'password':
      return (
        <Form.Input
          field={field.key} label={field.label}
          mode="password"
          placeholder={field.placeholder ?? `请输入${field.label}`}
          initValue={field.defaultValue} rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'pinCode':
      return (
        <Form.PinCode
          field={field.key} label={field.label}
          count={field.maxCount ?? 6}
          initValue={field.defaultValue}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'autoComplete':
      return (
        <Form.AutoComplete
          field={field.key} label={field.label}
          data={field.options ?? []}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          initValue={field.defaultValue}
          style={{ width: '100%' }} rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'rate':
      return (
        <Form.Slot label={field.label} {...extraProps}>
          <Rating count={field.rateMax ?? 5} defaultValue={Number(field.defaultValue) || 0} disabled={disabled} />
        </Form.Slot>
      );

    case 'formula':
      return (
        <Form.Input
          field={field.key} label={numberLabel} disabled
          initValue="请填写依赖字段后自动计算"
          extraText={field.formula ? `公式：${field.formula}` : helpText}
        />
      );

    case 'number': {
      const auto = !!field.daysFromKey;
      return (
        <Form.InputNumber
          field={field.key}
          label={auto ? `${numberLabel}（自动）` : numberLabel}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          precision={field.precision} step={field.step}
          min={field.min} max={field.max}
          initValue={field.defaultValue}
          style={{ width: '100%' }}
          disabled={disabled || auto}
          rules={numberRules.length > 0 ? numberRules : undefined}
          {...extraProps}
        />
      );
    }

    case 'amount': {
      const currencyLabel = CURRENCY_OPTIONS.find(c => c.value === (field.currency ?? 'CNY'))?.label ?? 'CNY';
      const amountSuffix = field.unit ? ` · ${field.unit}` : '';
      const amountLabel = `${field.label}（${currencyLabel}${amountSuffix}）`;
      return (
        <Form.InputNumber
          field={field.key} label={amountLabel}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          precision={field.precision ?? 2}
          min={field.min} max={field.max}
          initValue={field.defaultValue}
          style={{ width: '100%' }}
          prefix="¥" disabled={disabled}
          rules={numberRules.length > 0 ? numberRules : undefined}
          {...extraProps}
        />
      );
    }

    case 'date':
      return (
        <Form.DatePicker
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          style={{ width: '100%' }}
          format={field.dateFormat ?? 'yyyy-MM-dd'}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'dateRange':
      return (
        <Form.DatePicker
          field={field.key} label={field.label}
          type="dateRange" style={{ width: '100%' }}
          format={field.dateFormat ?? 'yyyy-MM-dd'}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'time':
      return (
        <Form.TimePicker
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          style={{ width: '100%' }}
          format={field.timeFormat ?? 'HH:mm'}
          initValue={field.defaultValue}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'region':
      return (
        <FormRegion
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? '请选择省/市/区'}
          initValue={field.defaultValue}
          rules={rules} disabled={disabled}
          style={{ width: '100%' }}
          {...extraProps}
        />
      );

    case 'signature':
      if (disabled) {
        const sig = (values[field.key] as string) ?? (field.defaultValue as string) ?? '';
        return (
          <Form.Slot label={field.label} {...extraProps}>
            {sig
              ? <img src={sig} alt="签名" style={{ maxWidth: '100%', maxHeight: 150, border: '1px solid var(--semi-color-border)', borderRadius: 6 }} />
              : <Typography.Text type="tertiary">（未签名）</Typography.Text>}
          </Form.Slot>
        );
      }
      return (
        <FormSignature
          field={field.key} label={field.label}
          initValue={field.defaultValue}
          rules={rules}
          {...extraProps}
        />
      );

    case 'richtext':
      if (disabled) {
        const html = (values[field.key] as string) ?? (field.defaultValue as string) ?? '';
        return (
          <Form.Slot label={field.label} {...extraProps}>
            {html
              ? <div className="wf-richtext-readonly" dangerouslySetInnerHTML={{ __html: html }} />
              : <Typography.Text type="tertiary">（无内容）</Typography.Text>}
          </Form.Slot>
        );
      }
      return (
        <FormRichText
          field={field.key} label={field.label}
          initValue={field.defaultValue}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          rules={rules}
          {...extraProps}
        />
      );

    case 'select': {
      let options = field.options ?? [];
      if (field.optionsFrom) {
        const pv = values[field.optionsFrom.sourceKey];
        options = typeof pv === 'string' ? (field.optionsFrom.mapping[pv] ?? []) : [];
      }
      return (
        <Form.Select
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          style={{ width: '100%' }} rules={rules} disabled={disabled}
          {...extraProps}
        >
          {options.map(opt => (
            <Select.Option key={opt} value={opt}>{opt}</Select.Option>
          ))}
        </Form.Select>
      );
    }

    case 'multiSelect': {
      let options = field.options ?? [];
      if (field.optionsFrom) {
        const pv = values[field.optionsFrom.sourceKey];
        options = typeof pv === 'string' ? (field.optionsFrom.mapping[pv] ?? []) : [];
      }
      return (
        <Form.Select
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          multiple style={{ width: '100%' }} rules={rules} disabled={disabled}
          {...extraProps}
        >
          {options.map(opt => (
            <Select.Option key={opt} value={opt}>{opt}</Select.Option>
          ))}
        </Form.Select>
      );
    }

    case 'radio': {
      let options = field.options ?? [];
      if (field.optionsFrom) {
        const pv = values[field.optionsFrom.sourceKey];
        options = typeof pv === 'string' ? (field.optionsFrom.mapping[pv] ?? []) : [];
      }
      return (
        <Form.RadioGroup
          field={field.key} label={field.label}
          initValue={field.defaultValue} rules={rules} disabled={disabled}
          options={options.map(opt => ({ label: opt, value: opt }))}
          {...extraProps}
        />
      );
    }

    case 'checkbox': {
      let options = field.options ?? [];
      if (field.optionsFrom) {
        const pv = values[field.optionsFrom.sourceKey];
        options = typeof pv === 'string' ? (field.optionsFrom.mapping[pv] ?? []) : [];
      }
      return (
        <Form.CheckboxGroup
          field={field.key} label={field.label}
          direction="horizontal"
          rules={rules} disabled={disabled}
          options={options.map(opt => ({ label: opt, value: opt }))}
          {...extraProps}
        />
      );
    }

    case 'switch':
      return (
        <Form.Switch
          field={field.key} label={field.label}
          initValue={field.defaultValue === true}
          disabled={disabled}
          {...extraProps}
        />
      );

    case 'slider': {
      const sMin = field.min ?? 0;
      const sMax = field.max ?? 100;
      return (
        <Form.Slider
          field={field.key} label={numberLabel}
          min={sMin} max={sMax} step={field.step ?? 1}
          marks={field.sliderMarks ? { [sMin]: String(sMin), [sMax]: String(sMax) } : undefined}
          initValue={field.defaultValue}
          disabled={disabled}
          {...extraProps}
        />
      );
    }

    case 'tags':
      return (
        <Form.TagInput
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请输入${field.label}后回车`}
          max={field.maxCount}
          initValue={field.defaultValue}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'attachment':
    case 'image':
      return (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            {field.label}{field.required && <span style={{ color: 'var(--semi-color-danger)' }}> *</span>}
          </Typography.Text>
          <Upload action="" listType={field.type === 'image' ? 'picture' : 'list'} limit={field.maxCount ?? 5} disabled={disabled}>
            <Button icon={<Plus size={14} />} theme="light" disabled={disabled}>
              {field.type === 'image' ? '上传图片' : '上传文件'}
            </Button>
          </Upload>
          {field.maxCount ? (
            <Typography.Text type="tertiary" size="small">
              最多上传 {field.maxCount} 个文件
            </Typography.Text>
          ) : null}
        </div>
      );

    case 'userSelect':
      return (
        <FormUserSelect
          field={field.key} label={field.label}
          multiple={field.multiple}
          placeholder={field.placeholder ?? '请选择人员'}
          initValue={field.defaultValue}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'deptSelect':
      return (
        <FormDeptSelect
          field={field.key} label={field.label}
          multiple={field.multiple}
          placeholder={field.placeholder ?? '请选择部门'}
          initValue={field.defaultValue}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'dictSelect':
      return (
        <FormDictSelect
          field={field.key} label={field.label}
          dictCode={field.dictCode}
          multiple={field.multiple}
          placeholder={field.placeholder ?? '请选择'}
          initValue={field.defaultValue}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'description':
      return (
        <div style={{ marginBottom: 16, padding: '12px', background: 'var(--semi-color-fill-0)', borderRadius: 6 }}>
          <Typography.Text type="secondary">
            {field.description || '说明文字'}
          </Typography.Text>
        </div>
      );

    case 'serialNumber':
      return (
        <Form.Input
          field={field.key} label={field.label} disabled
          initValue={`${field.serialPrefix ?? ''}20260101001`}
        />
      );

    case 'detail': {
      const children = field.children ?? [];
      return (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            {field.label}{field.required && <span style={{ color: 'var(--semi-color-danger)' }}> *</span>}
          </Typography.Text>
          <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: 12, background: 'var(--semi-color-fill-0)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {children.map(child => (
                <Tag key={child.key} color="blue" size="large">{child.label}</Tag>
              ))}
            </div>
            <Button size="small" theme="light" icon={<Plus size={12} />} disabled={disabled}>添加明细行</Button>
          </div>
        </div>
      );
    }

    case 'row':
      return (
        <Row gutter={16}>
          {(field.columns || []).map((col) => (
            <Col span={col.span} key={getColumnKey(field.key, col)}>
              {(col.fields || []).map(childField => (
                isFieldVisible(childField, values) ? <FieldRenderer key={childField.key} field={childField} readOnly={readOnly} /> : null
              ))}
            </Col>
          ))}
        </Row>
      );

    case 'divider':
      return <Divider style={{ margin: '16px 0' }} />;

    case 'group':
      return (
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 15, fontWeight: 600,
            color: 'var(--semi-color-text-0)',
            borderBottom: '1px solid var(--semi-color-border)',
            paddingBottom: 8, marginBottom: 16,
          }}>
            {field.title || field.label}
          </div>
          <Row gutter={16}>
            {(field.children || []).map(childField => (
              isFieldVisible(childField, values) ? (
                <Col span={colSpanOf(childField)} key={childField.key}>
                  <FieldRenderer field={childField} readOnly={readOnly} />
                </Col>
              ) : null
            ))}
          </Row>
        </div>
      );

    default:
      return (
        <Form.Input
          field={field.key} label={field.label}
          placeholder={field.placeholder} rules={rules} disabled={disabled}
        />
      );
  }
}
