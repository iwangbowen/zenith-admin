/**
 * 工作流表单渲染器 — 设计器预览和运行时（发起/审批）共用
 * 支持联动：公式实时计算、dateRange→天数、select 级联
 */
import { createContext, useContext, useRef, useState } from 'react';
import { Form, Select, Upload, Button, Tag, Typography, Row, Col, Divider, Rating } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus } from 'lucide-react';
import dayjs from 'dayjs';
import type { WorkflowFormField, WorkflowFormFieldColumn } from '@zenith/shared';
import { CURRENCY_OPTIONS } from '../form-types';

const PHONE_REGEX = /^1[3-9]\d{9}$/;
const EMAIL_REGEX = /^[\w.+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const ID_CARD_REGEX = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]$/;
const URL_REGEX = /^https?:\/\/.+/;
const SAFE_EXPR_REGEX = /^[\d+\-*/(). ]+$/;

const ValuesContext = createContext<Record<string, unknown>>({});

const getColumnKey = (parentKey: string, column: WorkflowFormFieldColumn) =>
  `${parentKey}-col-${column.span}-${column.fields.map(field => field.key).join('-') || 'empty'}`;

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

export function isFieldVisible(field: WorkflowFormField, values: Record<string, unknown>): boolean {
  const cond = field.visibilityCondition;
  if (!cond?.field) return true;
  const left = values[cond.field];
  const right = cond.value;
  const toStr = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  };
  switch (cond.operator) {
    case 'eq': return left === right || toStr(left) === toStr(right);
    case 'neq': return left !== right && toStr(left) !== toStr(right);
    case 'in': return Array.isArray(right) && right.map(toStr).includes(toStr(left));
    case 'contains': return Array.isArray(left) && left.map(toStr).includes(toStr(right));
    default: return true;
  }
}

interface RendererProps {
  fields: WorkflowFormField[];
  initValues?: Record<string, unknown>;
  getFormApi?: (api: FormApi) => void;
  onValueChange?: (values: Record<string, unknown>) => void;
  readOnly?: boolean;
  style?: React.CSSProperties;
}

export default function WorkflowFormRenderer({
  fields, initValues, getFormApi, onValueChange, readOnly, style,
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
        labelPosition="top"
        allowEmpty
        style={style}
        initValues={initValues}
        getFormApi={(api) => { formApiRef.current = api; getFormApi?.(api); }}
        onValueChange={handleValueChange}
      >
        {fields.map(field => (
          isFieldVisible(field, valuesState) ? <FieldRenderer key={field.key} field={field} readOnly={readOnly} /> : null
        ))}
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
  const extraProps = helpText ? { extraText: helpText } : {};
  const unitSuffix = field.unit ? `（${field.unit}）` : '';
  const numberLabel = `${field.label}${unitSuffix}`;
  const disabled = readOnly;

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
        />
      );

    case 'dateRange':
      return (
        <Form.DatePicker
          field={field.key} label={field.label}
          type="dateRange" style={{ width: '100%' }}
          format={field.dateFormat ?? 'yyyy-MM-dd'}
          rules={rules} disabled={disabled}
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
        >
          {options.map(opt => (
            <Select.Option key={opt} value={opt}>{opt}</Select.Option>
          ))}
        </Form.Select>
      );
    }

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

    case 'contact':
      return (
        <Form.Select
          field={field.key} label={field.label}
          placeholder="请选择联系人" style={{ width: '100%' }}
          rules={rules} disabled
        >
          <Select.Option value="demo">（联系人选择器）</Select.Option>
        </Form.Select>
      );

    case 'department':
      return (
        <Form.Select
          field={field.key} label={field.label}
          placeholder="请选择部门" style={{ width: '100%' }}
          rules={rules} disabled
        >
          <Select.Option value="demo">（部门选择器）</Select.Option>
        </Form.Select>
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
          {(field.children || []).map(childField => (
            isFieldVisible(childField, values) ? <FieldRenderer key={childField.key} field={childField} readOnly={readOnly} /> : null
          ))}
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
