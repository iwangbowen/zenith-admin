/**
 * 工作流表单渲染器 — 设计器预览和运行时（发起/审批）共用
 * 支持联动：公式实时计算、dateRange→天数、select 级联
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { Form, Select, Button, Typography, Row, Col, Divider, Rating, Toast, withField, Input, InputNumber, DatePicker, Collapse, Tabs, Steps, RadioGroup } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, Eraser, Trash2 } from 'lucide-react';
import dayjs from 'dayjs';
import type { WorkflowFormField, WorkflowFormFieldColumn, WorkflowFormFieldOptionItem, WorkflowFormFieldCompareRule, WorkflowRelationOption } from '@zenith/shared';
import { evalWorkflowFieldRuleGroup as evalRuleGroup, isWorkflowFieldVisible as isFieldVisible } from '@zenith/shared';
import { CURRENCY_OPTIONS, toDateFnsToken, dateFormatHasTime } from '../form-types';
import { evalFormula } from '../form-formula';
import { rmbUpper } from '@/utils/rmb';
import FileAttachment from '@/components/FileAttachment';
import { uploadedFileToAttachment } from '@/components/FileAttachment/utils';
import RegionSelect from '@/components/RegionSelect';
import RichTextEditor from '@/components/RichTextEditor';
import UserSelect from '@/components/UserSelect';
import DepartmentSelect from '@/components/DepartmentSelect';
import DictSelect from '@/components/DictSelect';
import ColorPickerInput from '@/components/ColorPickerInput';
import { useWorkflowDesignerRelationOptions, useWorkflowDesignerRemoteDataSourceOptions } from '@/hooks/queries/workflow-designer';
import { useSignaturePad } from '@/hooks/useSignaturePad';

const PHONE_REGEX = /^1[3-9]\d{9}$/;
const EMAIL_REGEX = /^[\w.+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const ID_CARD_REGEX = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]$/;
const URL_REGEX = /^https?:\/\/.+/;

const ValuesContext = createContext<Record<string, unknown>>({});

const getColumnKey = (parentKey: string, column: WorkflowFormFieldColumn) =>
  `${parentKey}-col-${column.span}-${column.fields.map(field => field.key).join('-') || 'empty'}`;

// ─── 字段列宽（响应式并排） ──────────────────────────────────────────
const LAYOUT_FULL_WIDTH_TYPES = new Set<string>(['row', 'divider', 'group', 'description', 'detail', 'tabs', 'steps']);
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

interface RelationSelectProps {
  value?: number | number[];
  onChange?: (value: number | number[] | undefined) => void;
  relationDefinitionId?: number;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  showClear?: boolean;
  style?: CSSProperties;
}

function formatRelationOption(option: WorkflowRelationOption): string {
  const serial = option.serialNo ? `[${option.serialNo}] ` : '';
  const definition = option.definitionName ? `（${option.definitionName}）` : '';
  return `${serial}${option.title}${definition}`;
}

function RelationSelect({
  value,
  onChange,
  relationDefinitionId,
  multiple = false,
  placeholder = '请选择关联审批单',
  disabled = false,
  showClear = true,
  style,
}: Readonly<RelationSelectProps>) {
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState(false);
  const optionsQuery = useWorkflowDesignerRelationOptions(
    { definitionId: relationDefinitionId, keyword: keyword.trim() || undefined, limit: 20 },
    active,
  );
  const options = optionsQuery.data ?? [];
  const loading = optionsQuery.isFetching;

  useEffect(() => {
    setKeyword('');
    setActive(false);
  }, [relationDefinitionId]);

  const selectedIds = (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .filter((v): v is number => typeof v === 'number');
  const optionList = [
    ...options.map((o) => ({ value: o.instanceId, label: formatRelationOption(o) })),
    ...selectedIds
      .filter((id) => !options.some((o) => o.instanceId === id))
      .map((id) => ({ value: id, label: `审批单 #${id}` })),
  ];

  const selectValue = multiple ? selectedIds : (selectedIds[0] ?? undefined);
  const handleChange = (nextValue: unknown) => {
    if (multiple) {
      const values = Array.isArray(nextValue)
        ? nextValue.map(Number).filter((id) => Number.isFinite(id))
        : [];
      onChange?.(values.length > 0 ? values : undefined);
      return;
    }
    if (nextValue === undefined || nextValue === null || nextValue === '') {
      onChange?.(undefined);
      return;
    }
    const id = Number(nextValue);
    onChange?.(Number.isFinite(id) ? id : undefined);
  };

  return (
    <Select
      value={selectValue}
      onChange={handleChange}
      multiple={multiple}
      filter
      remote
      onSearch={(nextKeyword) => { setKeyword(nextKeyword); setActive(true); }}
      onFocus={() => { setActive(true); }}
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled}
      showClear={showClear}
      maxTagCount={3}
      style={{ width: '100%', ...style }}
      optionList={optionList}
    />
  );
}

interface DataSourceSelectProps {
  value?: string;
  onChange?: (value: string | undefined) => void;
  dataSourceId?: number;
  placeholder?: string;
  disabled?: boolean;
  showClear?: boolean;
  style?: CSSProperties;
}

function DataSourceSelect({ value, onChange, dataSourceId, placeholder, disabled, showClear = true, style }: Readonly<DataSourceSelectProps>) {
  const [keyword, setKeyword] = useState('');
  const [active, setActive] = useState(false);
  const optionsQuery = useWorkflowDesignerRemoteDataSourceOptions(
    { dataSourceId, keyword: keyword.trim() || undefined },
    active && !!dataSourceId,
  );
  const options = optionsQuery.data ?? [];
  const loading = optionsQuery.isFetching;

  useEffect(() => {
    setKeyword('');
    setActive(false);
  }, [dataSourceId]);

  const current = value === undefined || value === null ? '' : String(value);
  const optionList = [
    ...options.map((o) => ({ value: o.value, label: o.label })),
    ...(current !== '' && !options.some((o) => o.value === current) ? [{ value: current, label: current }] : []),
  ];

  return (
    <Select
      value={current || undefined}
      onChange={(v) => onChange?.((v as string) ?? undefined)}
      filter
      remote
      onSearch={(nextKeyword) => { setKeyword(nextKeyword); setActive(true); }}
      onFocus={() => { setActive(true); }}
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled}
      showClear={showClear}
      style={{ width: '100%', ...style }}
      optionList={optionList}
    />
  );
}

function SignaturePad({ value, onChange, disabled, width = 360, height = 150 }: Readonly<SignaturePadProps>) {
  const { canvasRef, handlePointerDown, handlePointerMove, handlePointerUp, clear } = useSignaturePad({
    value,
    onChange,
    disabled,
    echoValue: true,
  });

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          border: '1px dashed var(--semi-color-border)',
          borderRadius: 'var(--semi-border-radius-medium)',
          background: 'var(--semi-color-bg-1)',
          touchAction: 'none',
          cursor: disabled ? 'not-allowed' : 'crosshair',
          maxWidth: '100%',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      {!disabled && (
        <Button size="small" theme="borderless" icon={<Eraser size={12} />} onClick={clear} style={{ alignSelf: 'flex-start' }}>
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
const FormRelationSelect = withField(RelationSelect);
const FormDataSourceSelect = withField(DataSourceSelect);
const FormColorPicker = withField(ColorPickerInput);
const FormRating = withField(Rating);

// ─── 附件 / 图片上传（接入 Form，存 {name,url,size} 数组） ──────────────
interface UploadedFileValue { name: string; url: string; size?: number }

interface FileUploadInputProps {
  value?: UploadedFileValue[];
  onChange?: (value: UploadedFileValue[]) => void;
  disabled?: boolean;
  isImage?: boolean;
  limit?: number;
  accept?: string;
  maxSizeMb?: number;
}

function FileUploadInput({ value, onChange, disabled, isImage, limit, accept, maxSizeMb }: Readonly<FileUploadInputProps>) {
  const files = Array.isArray(value) ? value : [];
  const attachments = files.map((f, i) => uploadedFileToAttachment(f, i));

  if (disabled) {
    if (files.length === 0) return <Typography.Text type="tertiary">（无附件）</Typography.Text>;
    return <FileAttachment mode="view" value={attachments} showTitle={false} />;
  }

  return (
    <FileAttachment
      mode="edit"
      value={attachments}
      showTitle={false}
      multiple={limit !== 1}
      limit={limit ?? 0}
      accept={accept || (isImage ? 'image/*' : undefined)}
      maxSizeMB={maxSizeMb && maxSizeMb > 0 ? maxSizeMb : undefined}
      uploadTip={isImage ? '上传图片' : '上传文件'}
      onChange={(items) => onChange?.(items.map((a) => ({
        name: a.file.originalName,
        url: a.file.url,
        size: a.file.size,
      })))}
    />
  );
}

const FormFileUpload = withField(FileUploadInput);

// ─── 明细 / 子表（可增删行、按子字段类型录入、底部合计、提交数组） ──────────
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
          onChange={(_d, dateString) => onCellChange((dateString as string) || undefined)}
          type={dateFormatHasTime(col.dateFormat) ? 'dateTime' : 'date'}
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
  const addRow = () => setRows([...rows, {}]);
  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));
  const setCell = (idx: number, key: string, cellVal: unknown) =>
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: cellVal } : r)));

  const sumOf = (key: string) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

  if (columns.length === 0) {
    return <Typography.Text type="tertiary">请在设计器中为明细配置子列</Typography.Text>;
  }

  return (
    <div className="wf-detail-table" style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: 'var(--semi-color-fill-0)' }}>
            <th style={{ width: 44, padding: '8px 10px', fontSize: 12, color: 'var(--semi-color-text-2)' }}>#</th>
            {columns.map((col) => (
              <th key={col.key} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 12, color: 'var(--semi-color-text-1)', fontWeight: 600 }}>
                {col.label}
              </th>
            ))}
            {!disabled && <th style={{ width: 56, padding: '8px 10px' }} />}
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
                    <DetailCell col={col} cellValue={row[col.key]} disabled={disabled} onCellChange={(v) => setCell(idx, col.key, v)} />
                  </td>
                ))}
                {!disabled && (
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
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
        <div style={{ padding: 8 }}>
          <Button size="small" theme="light" icon={<Plus size={13} />} onClick={addRow}>添加明细行</Button>
        </div>
      )}
    </div>
  );
}

const FormDetailTable = withField(DetailTableInput);

// 必填字段标签（带红色星号），用于 withField 自定义控件
function fieldLabelNode(field: WorkflowFormField, required: boolean | undefined = field.required): ReactNode {
  if (!required) return field.label;
  return <span>{field.label}<span style={{ color: 'var(--semi-color-danger)' }}> *</span></span>;
}

function flattenFields(fields: WorkflowFormField[]): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  for (const f of fields) {
    out.push(f);
    if (f.type === 'row' && f.columns) {
      for (const col of f.columns) out.push(...flattenFields(col.fields));
    } else if ((f.type === 'tabs' || f.type === 'steps') && f.panes) {
      for (const pane of f.panes) out.push(...flattenFields(pane.fields));
    } else if ((f.type === 'group' || f.type === 'detail') && f.children) {
      out.push(...flattenFields(f.children));
    }
  }
  return out;
}


function getCascadeAllowedOptions(field: WorkflowFormField, values: Record<string, unknown>): string[] {
  if (!field.optionsFrom) return field.options ?? [];
  const parentValue = values[field.optionsFrom.sourceKey];
  if (Array.isArray(parentValue)) {
    return Array.from(new Set(parentValue.flatMap((value) => field.optionsFrom?.mapping[String(value)] ?? [])));
  }
  return parentValue === undefined || parentValue === null ? [] : (field.optionsFrom.mapping[String(parentValue)] ?? []);
}

// 显隐/条件求值统一走 shared workflow-form-runtime（与服务端发起校验同源），本文件不再本地实现

// ─── 日期可选范围 → disabledDate ─────────────────────────────────────
function buildDisabledDate(field: WorkflowFormField): ((date?: Date) => boolean) | undefined {
  const mode = field.dateLimit;
  if (!mode || mode === 'none') return undefined;
  if (mode === 'noPast') return (d?: Date) => !!d && dayjs(d).isBefore(dayjs(), 'day');
  if (mode === 'noFuture') return (d?: Date) => !!d && dayjs(d).isAfter(dayjs(), 'day');
  const min = field.minDate ? dayjs(field.minDate) : null;
  const max = field.maxDate ? dayjs(field.maxDate) : null;
  if (!(min?.isValid()) && !(max?.isValid())) return undefined;
  return (d?: Date) => {
    if (!d) return false;
    const day = dayjs(d);
    if (min?.isValid() && day.isBefore(min, 'day')) return true;
    if (max?.isValid() && day.isAfter(max, 'day')) return true;
    return false;
  };
}

// ─── 增强选项：合并 optionItems 元信息，按级联允许值过滤排序 ──────────
export interface DisplayOption { value: string; label: string; color?: string; disabled?: boolean }
function getDisplayOptions(field: WorkflowFormField, values: Record<string, unknown>): DisplayOption[] {
  const allowed = getCascadeAllowedOptions(field, values);
  const itemMap = new Map<string, WorkflowFormFieldOptionItem>((field.optionItems ?? []).map((it) => [it.value, it]));
  return allowed.map((v) => {
    const it = itemMap.get(v);
    return { value: v, label: it?.label || v, color: it?.color, disabled: it?.disabled };
  });
}

function optionLabelNode(opt: DisplayOption): ReactNode {
  if (!opt.color) return opt.label;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color, display: 'inline-block' }} />
      {opt.label}
    </span>
  );
}

// ─── 跨字段比较校验 ──────────────────────────────────────────────────
function evalCompare(op: WorkflowFormFieldCompareRule['operator'], a: unknown, b: unknown, isDate: boolean): boolean {
  if (a === null || a === undefined || a === '' || b === null || b === undefined || b === '') return true;
  if (Array.isArray(a) || Array.isArray(b)) return true;
  let x: number; let y: number;
  if (isDate) { x = dayjs(a as string).valueOf(); y = dayjs(b as string).valueOf(); }
  else { x = Number(a); y = Number(b); }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  switch (op) {
    case 'gt': return x > y;
    case 'gte': return x >= y;
    case 'lt': return x < y;
    case 'lte': return x <= y;
    case 'eq': return x === y;
    case 'neq': return x !== y;
    default: return true;
  }
}

const COMPARE_OP_TEXT: Record<WorkflowFormFieldCompareRule['operator'], string> = {
  gt: '大于', gte: '不小于', lt: '小于', lte: '不大于', eq: '等于', neq: '不等于',
};

// ─── select / radio 「其他」可填 包装控件 ─────────────────────────────
const OTHER_VALUE = '__other__';
interface OptionInputProps {
  value?: string;
  onChange?: (v: string | undefined) => void;
  disabled?: boolean;
  mode: 'select' | 'radio';
  options: DisplayOption[];
  allowOther?: boolean;
  placeholder?: string;
}
function OptionInput({ value, onChange, disabled, mode, options, allowOther, placeholder }: Readonly<OptionInputProps>) {
  const known = new Set(options.map((o) => o.value));
  const valueIsOther = allowOther && value != null && value !== '' && !known.has(value);
  const [otherMode, setOtherMode] = useState(!!valueIsOther);
  useEffect(() => { if (valueIsOther) setOtherMode(true); }, [valueIsOther]);
  const showOther = !!allowOther && (otherMode || !!valueIsOther);
  const controlValue = showOther ? OTHER_VALUE : value;
  const pick = (v: string) => {
    if (v === OTHER_VALUE) { setOtherMode(true); onChange?.(''); }
    else { setOtherMode(false); onChange?.(v); }
  };
  const otherInput = showOther ? (
    <Input
      style={{ marginTop: 8 }}
      value={value ?? ''}
      onChange={(v) => onChange?.(v)}
      placeholder="请填写其他"
      disabled={disabled}
    />
  ) : null;

  if (mode === 'radio') {
    return (
      <div>
        <RadioGroup
          value={controlValue}
          disabled={disabled}
          onChange={(e) => pick(String(e.target.value))}
          options={[
            ...options.map((o) => ({ label: optionLabelNode(o), value: o.value, disabled: o.disabled })),
            ...(allowOther ? [{ label: '其他', value: OTHER_VALUE }] : []),
          ]}
        />
        {otherInput}
      </div>
    );
  }
  return (
    <div>
      <Select
        value={controlValue}
        disabled={disabled}
        placeholder={placeholder}
        style={{ width: '100%' }}
        onChange={(v) => pick(String(v))}
      >
        {options.map((o) => (
          <Select.Option key={o.value} value={o.value} disabled={o.disabled}>{optionLabelNode(o)}</Select.Option>
        ))}
        {allowOther && <Select.Option value={OTHER_VALUE}>其他…</Select.Option>}
      </Select>
      {otherInput}
    </div>
  );
}
const FormOptionInput = withField(OptionInput);

// ─── 分步容器 ────────────────────────────────────────────────────────
function renderPaneFields(pane: { fields: WorkflowFormField[] }, readOnly: boolean | undefined, values: Record<string, unknown>): ReactNode {
  return (
    <Row gutter={16}>
      {pane.fields.map((cf) => (
        isFieldVisible(cf, values) ? (
          <Col span={colSpanOf(cf)} key={cf.key}><FieldRenderer field={cf} readOnly={readOnly} /></Col>
        ) : null
      ))}
    </Row>
  );
}

function StepsContainer({ field, readOnly }: Readonly<{ field: WorkflowFormField; readOnly?: boolean }>) {
  const values = useContext(ValuesContext);
  const panes = field.panes ?? [];
  const [current, setCurrent] = useState(0);
  if (panes.length === 0) return null;
  const cur = Math.min(current, panes.length - 1);
  return (
    <div style={{ marginBottom: 24 }}>
      <Steps type="basic" size="small" current={cur} onChange={setCurrent} style={{ marginBottom: 16 }}>
        {panes.map((p, i) => <Steps.Step key={`${field.key}-step-${i}`} title={p.title || `步骤${i + 1}`} />)}
      </Steps>
      {panes.map((pane, i) => (
        <div key={`${field.key}-pane-${i}`} style={{ display: i === cur ? 'block' : 'none' }}>
          {renderPaneFields(pane, readOnly, values)}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <Button disabled={cur === 0} onClick={() => setCurrent(cur - 1)}>上一步</Button>
        <Button disabled={cur === panes.length - 1} onClick={() => setCurrent(cur + 1)}>下一步</Button>
      </div>
    </div>
  );
}

interface RendererProps {
  fields: WorkflowFormField[];
  initValues?: Record<string, unknown>;
  getFormApi?: (api: FormApi) => void;
  onValueChange?: (values: Record<string, unknown>) => void;
  readOnly?: boolean;
  style?: CSSProperties;
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

  const all = useMemo(() => flattenFields(fields), [fields]);
  const formulaFields = useMemo(() => all.filter(f => f.type === 'formula' && f.formula), [all]);
  const dayFields = useMemo(() => all.filter(f => f.daysFromKey && (f.type === 'number' || f.type === 'amount')), [all]);
  const cascadeFields = useMemo(() => all.filter(f => f.optionsFrom), [all]);
  const autoFillFields = useMemo(() => all.filter(f => f.autoFill && f.autoFill.targets.length > 0), [all]);

  const handleValueChange = (next: Record<string, unknown>) => {
    const prev = valuesRef.current;
    valuesRef.current = next;
    setValuesState(next);
    const api = formApiRef.current;
    if (api) {
      // 公式
      for (const f of formulaFields) {
        if (!f.formula) continue;
        const result = evalFormula(f.formula, next, f.precision ?? 2);
        if (result !== null && next[f.key] !== result) {
          api.setValue(f.key, result);
        } else if (result === null && next[f.key] !== undefined) {
          api.setValue(f.key, undefined);
        }
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
            if (Number.isFinite(days) && days >= 0 && next[f.key] !== days) {
              api.setValue(f.key, days);
            } else if ((!Number.isFinite(days) || days < 0) && next[f.key] !== undefined) {
              api.setValue(f.key, undefined);
            }
          }
        } else if (next[f.key] !== undefined) {
          api.setValue(f.key, undefined);
        }
      }
      // 级联：父值变化后过滤已失效的子值
      for (const f of cascadeFields) {
        if (!f.optionsFrom) continue;
        const allowed = getCascadeAllowedOptions(f, next);
        const cur = next[f.key];
        if (cur === undefined || cur === null || cur === '') continue;
        if (Array.isArray(cur)) {
          const filtered = cur.filter(v => allowed.includes(String(v)));
          if (filtered.length !== cur.length) {
            api.setValue(f.key, filtered);
            Toast.info(`${f.label}已按父字段选项自动调整`);
          }
        } else if (typeof cur === 'string' && !allowed.includes(cur)) {
          api.setValue(f.key, undefined);
          Toast.info(`${f.label}已清空，当前父字段下该选项不可用`);
        }
      }
      // 联动赋值：源字段选项变化时自动填充目标字段
      for (const f of autoFillFields) {
        if (!f.autoFill) continue;
        if (next[f.key] === prev[f.key]) continue;
        const optKey = next[f.key];
        if (optKey === undefined || optKey === null) continue;
        const fillMap = f.autoFill.byOption[String(optKey)];
        if (!fillMap) continue;
        for (const targetKey of f.autoFill.targets) {
          const raw = fillMap[targetKey];
          if (raw === undefined) continue;
          const tf = all.find(x => x.key === targetKey);
          const val = tf && (tf.type === 'number' || tf.type === 'amount')
            ? (raw === '' ? undefined : Number(raw))
            : raw;
          api.setValue(targetKey, val);
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
  // 条件必填 / 条件只读：满足规则时动态生效（叠加静态 required/readOnly）
  const dynamicRequired = field.required || (!!field.requiredRules?.rules?.length && evalRuleGroup(field.requiredRules, values));
  const dynamicReadOnly = !!field.readOnlyRules?.rules?.length && evalRuleGroup(field.readOnlyRules, values);
  const baseRules: Array<Record<string, unknown>> = [];
  if (dynamicRequired) baseRules.push({ required: true, message: `请填写${field.label}` });
  if (field.minLength !== undefined) baseRules.push({ type: 'string', minLength: field.minLength, message: `最少${field.minLength}个字符` });
  if (field.maxLength !== undefined) baseRules.push({ type: 'string', maxLength: field.maxLength, message: `最多${field.maxLength}个字符` });
  if (field.pattern) {
    try {
      baseRules.push({ pattern: new RegExp(field.pattern), message: field.patternMessage ?? '格式不正确' });
    } catch { /* invalid regex */ }
  }
  const numberRules: Array<Record<string, unknown>> = [];
  if (dynamicRequired) numberRules.push({ required: true, message: `请填写${field.label}` });
  if (field.min !== undefined) numberRules.push({ type: 'number', min: field.min, message: `不小于${field.min}` });
  if (field.max !== undefined) numberRules.push({ type: 'number', max: field.max, message: `不大于${field.max}` });
  // 跨字段比较校验（number/amount/date）
  if (field.compareRules?.length) {
    const isDateField = field.type === 'date' || field.type === 'dateRange';
    for (const cr of field.compareRules) {
      const message = cr.message || `需${COMPARE_OP_TEXT[cr.operator]}目标字段`;
      const validator = (_r: unknown, value: unknown, _cb: unknown, source?: Record<string, unknown>) => {
        const other = source && typeof source === 'object' && cr.field in source ? source[cr.field] : values[cr.field];
        return evalCompare(cr.operator, value, other, isDateField);
      };
      baseRules.push({ validator, message });
      numberRules.push({ validator, message });
    }
  }
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
  const disabled = readOnly || field.readOnly || dynamicReadOnly;

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
            ...(dynamicRequired ? [{ required: true, message: `请填写${field.label}` }] : []),
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
            ...(dynamicRequired ? [{ required: true, message: `请填写${field.label}` }] : []),
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
            ...(dynamicRequired ? [{ required: true, message: `请填写${field.label}` }] : []),
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
            ...(dynamicRequired ? [{ required: true, message: `请填写${field.label}` }] : []),
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
        <FormRating
          field={field.key} label={fieldLabelNode(field, dynamicRequired)}
          count={field.rateMax ?? 5}
          initValue={Number(field.defaultValue) || 0}
          disabled={disabled}
          rules={dynamicRequired ? [{ validator: (_r: unknown, v: unknown) => typeof v === 'number' && v > 0, message: `请为${field.label}评分` }] : undefined}
          {...extraProps}
        />
      );

    case 'formula':
      return (
        <Form.Input
          field={field.key} label={numberLabel} disabled
          initValue={field.defaultValue}
          placeholder="请填写依赖字段后自动计算"
          {...extraProps}
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
      const showUpper = field.amountInWords && (field.currency ?? 'CNY') === 'CNY';
      const upper = showUpper ? rmbUpper(values[field.key] as number) : '';
      const amountExtra = upper ? `大写：${upper}` : (extraProps as { extraText?: ReactNode }).extraText;
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
          extraText={amountExtra}
        />
      );
    }

    case 'date':
      return (
        <Form.DatePicker
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          type={dateFormatHasTime(field.dateFormat) ? 'dateTime' : 'date'}
          insetInput={dateFormatHasTime(field.dateFormat)}
          style={{ width: '100%' }}
          format={toDateFnsToken(field.dateFormat)}
          disabledDate={buildDisabledDate(field)}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'dateRange':
      return (
        <Form.DatePicker
          field={field.key} label={field.label}
          type={dateFormatHasTime(field.dateFormat) ? 'dateTimeRange' : 'dateRange'}
          insetInput={dateFormatHasTime(field.dateFormat)}
          style={{ width: '100%' }}
          format={toDateFnsToken(field.dateFormat)}
          disabledDate={buildDisabledDate(field)}
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
              ? <img src={sig} alt="签名" style={{ maxWidth: '100%', maxHeight: 150, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }} />
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
              ? <div className="wf-richtext-readonly" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
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
      if (field.dataSourceId) {
        return (
          <FormDataSourceSelect
            field={field.key} label={field.label}
            dataSourceId={field.dataSourceId}
            placeholder={field.placeholder ?? `请选择${field.label}`}
            initValue={field.defaultValue}
            rules={rules} disabled={disabled}
            {...extraProps}
          />
        );
      }
      const options = getDisplayOptions(field, values);
      if (field.allowOther) {
        return (
          <FormOptionInput
            field={field.key} label={field.label}
            mode="select" options={options} allowOther
            placeholder={field.placeholder ?? `请选择${field.label}`}
            initValue={field.defaultValue}
            rules={rules} disabled={disabled}
            {...extraProps}
          />
        );
      }
      return (
        <Form.Select
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          style={{ width: '100%' }} rules={rules} disabled={disabled}
          {...extraProps}
        >
          {options.map(opt => (
            <Select.Option key={opt.value} value={opt.value} disabled={opt.disabled}>{optionLabelNode(opt)}</Select.Option>
          ))}
        </Form.Select>
      );
    }

    case 'multiSelect': {
      const options = getDisplayOptions(field, values);
      return (
        <Form.Select
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          multiple style={{ width: '100%' }} rules={rules} disabled={disabled}
          {...extraProps}
        >
          {options.map(opt => (
            <Select.Option key={opt.value} value={opt.value} disabled={opt.disabled}>{optionLabelNode(opt)}</Select.Option>
          ))}
        </Form.Select>
      );
    }

    case 'radio': {
      const options = getDisplayOptions(field, values);
      if (field.allowOther) {
        return (
          <FormOptionInput
            field={field.key} label={field.label}
            mode="radio" options={options} allowOther
            initValue={field.defaultValue}
            rules={rules} disabled={disabled}
            {...extraProps}
          />
        );
      }
      return (
        <Form.RadioGroup
          field={field.key} label={field.label}
          initValue={field.defaultValue} rules={rules} disabled={disabled}
          options={options.map(opt => ({ label: optionLabelNode(opt), value: opt.value, disabled: opt.disabled }))}
          {...extraProps}
        />
      );
    }

    case 'checkbox': {
      const options = getDisplayOptions(field, values);
      return (
        <Form.CheckboxGroup
          field={field.key} label={field.label}
          direction="horizontal"
          rules={rules} disabled={disabled}
          options={options.map(opt => ({ label: optionLabelNode(opt), value: opt.value, disabled: opt.disabled }))}
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

    case 'colorPicker':
      return (
        <FormColorPicker
          field={field.key} label={field.label}
          alpha={field.alpha}
          initValue={field.defaultValue}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'attachment':
    case 'image': {
      const limitParts = [
        field.maxCount ? `最多 ${field.maxCount} 个` : '',
        field.maxSize ? `单个 ≤ ${field.maxSize}MB` : '',
        field.accept ? `类型：${field.accept}` : '',
      ].filter(Boolean);
      return (
        <FormFileUpload
          field={field.key}
          label={fieldLabelNode(field, dynamicRequired)}
          isImage={field.type === 'image'}
          limit={field.maxCount}
          accept={field.accept}
          maxSizeMb={field.maxSize}
          disabled={disabled}
          rules={dynamicRequired ? [{ validator: (_r: unknown, v: unknown) => Array.isArray(v) && v.length > 0, message: `请上传${field.label}` }] : undefined}
          extraText={limitParts.length ? limitParts.join(' · ') : undefined}
          {...extraProps}
        />
      );
    }

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

    case 'relation':
      return (
        <FormRelationSelect
          field={field.key} label={field.label}
          relationDefinitionId={field.relationDefinitionId}
          multiple={field.multiple}
          placeholder={field.placeholder ?? '请选择关联审批单'}
          initValue={field.defaultValue}
          rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'description':
      return (
        <div style={{ marginBottom: 16, padding: '12px', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>
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
      const requiredChildren = children.filter(c => c.required);
      const detailRules: Array<Record<string, unknown>> = [];
      if (dynamicRequired) {
        detailRules.push({ validator: (_r: unknown, v: unknown) => Array.isArray(v) && v.length > 0, message: `请至少添加一行${field.label}` });
      }
      if (requiredChildren.length > 0) {
        detailRules.push({
          validator: (_r: unknown, v: unknown) =>
            Array.isArray(v) && v.every((row) => requiredChildren.every((c) => {
              const cell = (row as Record<string, unknown>)[c.key];
              return cell !== undefined && cell !== null && cell !== '';
            })),
          message: `${field.label}存在必填子项未填写`,
        });
      }
      const uniqueChildren = children.filter(c => c.unique);
      for (const uc of uniqueChildren) {
        detailRules.push({
          validator: (_r: unknown, v: unknown) => {
            if (!Array.isArray(v)) return true;
            const seen = new Set<string>();
            for (const row of v) {
              const cell = (row as Record<string, unknown>)[uc.key];
              if (cell === undefined || cell === null || cell === '') continue;
              const k = String(cell);
              if (seen.has(k)) return false;
              seen.add(k);
            }
            return true;
          },
          message: `${field.label}「${uc.label}」列存在重复值`,
        });
      }
      return (
        <FormDetailTable
          field={field.key}
          label={fieldLabelNode(field, dynamicRequired)}
          columns={children}
          disabled={disabled}
          rules={detailRules.length > 0 ? detailRules : undefined}
          {...extraProps}
        />
      );
    }

    case 'row': {
      const columns = field.columns || [];
      // 所有子字段都被隐藏时不渲染空白容器
      const hasVisibleChild = columns.some((col) => (col.fields || []).some((cf) => isFieldVisible(cf, values)));
      if (!hasVisibleChild) return null;
      return (
        <Row gutter={16}>
          {columns.map((col) => (
            <Col span={col.span} key={getColumnKey(field.key, col)}>
              {(col.fields || []).map(childField => (
                isFieldVisible(childField, values) ? <FieldRenderer key={childField.key} field={childField} readOnly={readOnly} /> : null
              ))}
            </Col>
          ))}
        </Row>
      );
    }

    case 'divider':
      return <Divider style={{ margin: '16px 0' }} />;

    case 'group': {
      // 所有子字段都被隐藏时不渲染分组标题与空白容器
      const visibleChildren = (field.children || []).filter((cf) => isFieldVisible(cf, values));
      if (visibleChildren.length === 0) return null;
      const groupBody = (
        <Row gutter={16}>
          {visibleChildren.map(childField => (
            <Col span={colSpanOf(childField)} key={childField.key}>
              <FieldRenderer field={childField} readOnly={readOnly} />
            </Col>
          ))}
        </Row>
      );
      if (field.collapsible) {
        return (
          <div style={{ marginBottom: 24 }}>
            <Collapse defaultActiveKey={field.defaultCollapsed ? [] : ['group']} expandIconPosition="left">
              <Collapse.Panel header={field.title || field.label} itemKey="group">
                <div style={{ paddingTop: 8 }}>{groupBody}</div>
              </Collapse.Panel>
            </Collapse>
          </div>
        );
      }
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
          {groupBody}
        </div>
      );
    }

    case 'tabs': {
      const panes = field.panes ?? [];
      if (panes.length === 0) return null;
      return (
        <div style={{ marginBottom: 24 }}>
          <Tabs type="line" keepDOM lazyRender={false}>
            {panes.map((pane, i) => (
              <Tabs.TabPane tab={pane.title || `标签${i + 1}`} itemKey={String(i)} key={`${field.key}-tab-${i}`}>
                <div style={{ paddingTop: 8 }}>{renderPaneFields(pane, readOnly, values)}</div>
              </Tabs.TabPane>
            ))}
          </Tabs>
        </div>
      );
    }

    case 'steps':
      return <StepsContainer field={field} readOnly={readOnly} />;

    default:
      return (
        <Form.Input
          field={field.key} label={field.label}
          placeholder={field.placeholder} rules={rules} disabled={disabled}
        />
      );
  }
}
