/**
 * 右侧字段属性配置面板
 */
import { useMemo, useState, useEffect } from 'react';
import { Button, Input, InputNumber, Select, Switch, Typography, TextArea, TagInput, RadioGroup, Radio, Tooltip, Dropdown } from '@douyinfe/semi-ui';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import type { WorkflowFormField, WorkflowFormFieldType, WorkflowFieldVisibilityCondition, WorkflowDataSource, Dict, PaginatedResponse, WorkflowDefinition } from '@zenith/shared';
import { request } from '@/utils/request';
import { CURRENCY_OPTIONS, DATE_FORMAT_OPTIONS, TIME_FORMAT_OPTIONS, REGION_LEVEL_OPTIONS, COLUMN_SPAN_OPTIONS, LABEL_POSITION_OPTIONS, LABEL_ALIGN_OPTIONS, FORM_FIELD_TYPES, toDateFnsToken } from '../form-types';
import { evalFormula } from './WorkflowFormRenderer';

interface FieldConfigPanelProps {
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
  /** 重命名字段 key（级联更新所有引用） */
  onRenameKey?: (newKey: string) => void;
}

const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

// 动态默认值占位符（发起时按登录用户/部门/时间解析）
const DYNAMIC_DEFAULT_TOKENS: Array<{ token: string; label: string }> = [
  { token: '${currentUser}', label: '当前用户姓名' },
  { token: '${currentUserId}', label: '当前用户ID' },
  { token: '${currentDept}', label: '当前部门名称' },
  { token: '${currentDeptId}', label: '当前部门ID' },
  { token: '${today}', label: '今天（日期）' },
  { token: '${now}', label: '现在（日期时间）' },
];

// 根据字段名称生成可读 key：中文转拼音（无声调），非中文连续保留，输出 camelCase
function slugifyToKey(label: string, fallbackType: string): string {
  const source = (label ?? '').trim();
  const py = source
    ? pinyin(source, { toneType: 'none', type: 'string', nonZh: 'consecutive', v: true })
    : '';
  const parts = py.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let key = parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join('');
  // 必须以字母开头
  if (!FIELD_KEY_PATTERN.test(key)) {
    const suffix = key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
    key = `${fallbackType}${suffix}`;
  }
  return key || fallbackType || 'field';
}

// 追加数字后缀确保唯一
function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

function formatVisibilityValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function regexError(pattern?: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : '正则表达式无效';
  }
}

function formulaError(formula: string | undefined, fields: WorkflowFormField[], currentKey: string): string | null {
  const expr = formula?.trim();
  if (!expr) return null;
  const refs = Array.from(expr.matchAll(/\{([^}]+)\}/g), (match) => match[1]?.trim())
    .filter((key): key is string => Boolean(key));
  const keys = new Set(fields.map((field) => field.key));
  // 明细列引用 {明细key.列key} 取点号前的字段 key 校验
  const unknown = refs.filter((key) => {
    const base = key.split('.')[0];
    return base !== currentKey && !keys.has(base);
  });
  if (unknown.length > 0) return `引用字段不存在：${unknown.join('、')}`;
  const sampleValues = Object.fromEntries(refs.map((key) => [key, 1]));
  return evalFormula(expr, sampleValues, 2) === null ? '公式表达式无效，请检查函数与括号是否匹配' : null;
}

function createsCascadeCycle(fieldKey: string, sourceKey: string, fields: WorkflowFormField[]): boolean {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const visited = new Set<string>([fieldKey]);
  let cursor: string | undefined = sourceKey;
  while (cursor) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = byKey.get(cursor)?.optionsFrom?.sourceKey;
  }
  return false;
}

function createLocalFieldKey(type: WorkflowFormFieldType): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${type}_${Date.now()}_${random.replace(/-/g, '').slice(0, 8)}`;
}

export default function FieldConfigPanel({
  field,
  allFields,
  onChange,
  onRenameKey,
}: Readonly<FieldConfigPanelProps>) {

  const [activeSection, setActiveSection] = useState<'basic' | 'validation' | 'visibility'>('basic');
  const fieldInfo = FORM_FIELD_TYPES.find(t => t.type === field.type);
  const flatFields = useMemo(() => collectFlat(allFields), [allFields]);

  // 字段标识(key) 本地草稿：失焦/回车时校验并提交重命名
  const [keyDraft, setKeyDraft] = useState(field.key);
  useEffect(() => { setKeyDraft(field.key); }, [field.key]);

  // select 选项来源模式（静态/远程）：以显式状态跟踪，避免「无可用数据源时切换不生效」
  const [isRemoteSource, setIsRemoteSource] = useState(field.dataSourceId != null);
  // 切换字段时按该字段是否绑定数据源重置（同字段内的切换保持本地状态）
  useEffect(() => { setIsRemoteSource(field.dataSourceId != null); }, [field.key, field.dataSourceId]);
  const otherKeys = useMemo(() => new Set(flatFields.filter(f => f.key !== field.key).map(f => f.key)), [flatFields, field.key]);
  const keyError = (() => {
    if (keyDraft === field.key) return null;
    if (!keyDraft.trim()) return '标识不能为空';
    if (!FIELD_KEY_PATTERN.test(keyDraft)) return '需字母开头，仅含字母、数字、下划线';
    if (otherKeys.has(keyDraft)) return '该标识已被占用';
    return null;
  })();
  const commitKey = () => {
    if (keyDraft === field.key) return;
    if (keyError) { setKeyDraft(field.key); return; }
    onRenameKey?.(keyDraft);
  };
  // 根据名称一键生成唯一 key
  const generateKey = () => {
    const next = uniqueKey(slugifyToKey(field.label, field.type), otherKeys);
    setKeyDraft(next);
    onRenameKey?.(next);
  };

  // 可用作条件依赖的字段（具备明确可比较值的类型，且不是当前字段）
  const conditionFields = useMemo(() => flatFields.filter(
    f => f.key !== field.key && CONDITION_FIELD_TYPES.has(f.type),
  ), [flatFields, field.key]);

  const hasOptions = field.type === 'select' || field.type === 'multiSelect' || field.type === 'radio' || field.type === 'checkbox' || field.type === 'autoComplete';
  const supportsCascade = field.type === 'select' || field.type === 'multiSelect';
  const hasChildren = field.type === 'detail';
  const isDescription = field.type === 'description';
  const isSerialNumber = field.type === 'serialNumber';
  const isAmountOrNumber = field.type === 'amount' || field.type === 'number';
  const isAmount = field.type === 'amount';
  const isDate = field.type === 'date' || field.type === 'dateRange';
  const isFileType = field.type === 'attachment' || field.type === 'image';
  const isLayout = field.type === 'row' || field.type === 'divider' || field.type === 'group';
  const isText = field.type === 'text' || field.type === 'textarea';
  const isFormatted = field.type === 'phone' || field.type === 'email' || field.type === 'idCard' || field.type === 'url' || field.type === 'password';
  const isRate = field.type === 'rate';
  const isFormula = field.type === 'formula';
  const isTime = field.type === 'time';
  const isRegion = field.type === 'region';
  const isSignature = field.type === 'signature';
  const isRichText = field.type === 'richtext';
  const isSwitch = field.type === 'switch';
  const isSlider = field.type === 'slider';
  const isTags = field.type === 'tags';
  const isColorPicker = field.type === 'colorPicker';
  const isPinCode = field.type === 'pinCode';
  const isAutoComplete = field.type === 'autoComplete';
  const isUserSelect = field.type === 'userSelect';
  const isDeptSelect = field.type === 'deptSelect';
  const isDictSelect = field.type === 'dictSelect';
  const isRelationSelect = field.type === 'relation';
  const isSystemSelect = isUserSelect || isDeptSelect || isDictSelect || isRelationSelect;
  const isSpecialInput = isTime || isRegion || isSignature || isRichText || isSwitch || isSlider || isTags || isColorPicker || isPinCode || isSystemSelect;
  // 支持响应式列宽 / 只读 / 隐藏的普通输入字段（排除布局类与纯展示类）
  const supportsLayoutState = !isLayout && !isDescription && !isSerialNumber;
  // 支持字段级标签覆盖（排除布局/分割线/纯展示）
  const supportsLabelOverride = !isLayout && !isDescription;
  // 字段标识(key) 可编辑（排除布局/纯展示类，其 key 不参与数据提交与联动）
  const supportsKeyEdit = !isLayout && !isDescription;
  const showValidationTab = !isDescription && !isSerialNumber && !isLayout && !isFileType && field.type !== 'detail' && !isFormula && !isRate && !isDate && !isSpecialInput;
  const duplicateKey = flatFields.filter(f => f.key === field.key).length > 1;
  const patternError = regexError(field.pattern);
  const textRangeError = field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength
    ? '最小长度不能大于最大长度'
    : null;
  const numberRangeError = field.min !== undefined && field.max !== undefined && field.min > field.max
    ? '最小值不能大于最大值'
    : null;
  const formulaValidationError = isFormula ? formulaError(field.formula, flatFields, field.key) : null;

  return (
    <div className="fd-form-config">
      {/* 字段类型标识 */}
      <div className="fd-form-config__header">
        {fieldInfo && (
          <div className="fd-form-config__type-badge">
            <fieldInfo.icon size={14} />
            <span>{fieldInfo.label}</span>
          </div>
        )}
      </div>

      {/* 切换 Tab */}
      <div className="fd-form-config__tabs">
        <button
          type="button"
          className={`fd-form-config__tab ${activeSection === 'basic' ? 'fd-form-config__tab--active' : ''}`}
          onClick={() => setActiveSection('basic')}
        >
          基础设置
        </button>
        {showValidationTab && (
          <button
            type="button"
            className={`fd-form-config__tab ${activeSection === 'validation' ? 'fd-form-config__tab--active' : ''}`}
            onClick={() => setActiveSection('validation')}
          >
            校验规则
          </button>
        )}
        <button
          type="button"
          className={`fd-form-config__tab ${activeSection === 'visibility' ? 'fd-form-config__tab--active' : ''}`}
          onClick={() => setActiveSection('visibility')}
        >
          显隐设置
        </button>
      </div>

      {/* 基础设置 */}
      {activeSection === 'basic' && (
        <div className="fd-form-config__section">
          {/* 字段名称 */}
          <div className="fd-form-config__field">
            <Typography.Text strong size="small">名称</Typography.Text>
            <Input
              value={field.label}
              onChange={(v) => onChange({ label: v })}
              placeholder="字段名称"
            />
          </div>
          {duplicateKey && (
            <Typography.Text type="danger" size="small" style={{ display: 'block', marginBottom: 12 }}>
              字段 key 重复，运行时取值和联动可能异常，请复制字段或重新添加以生成唯一 key。
            </Typography.Text>
          )}

          {/* 字段标识(key)：提交数据键 + 公式/联动引用锚点，修改自动级联同步引用 */}
          {supportsKeyEdit && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">字段标识(key)</Typography.Text>
              <Input
                value={keyDraft}
                onChange={setKeyDraft}
                onBlur={commitKey}
                onEnterPress={commitKey}
                placeholder="字母开头，仅含字母/数字/下划线"
                validateStatus={keyError ? 'error' : 'default'}
                suffix={(
                  <Tooltip content={field.label.trim() ? '根据名称生成 key' : '请先填写名称'}>
                    <Button
                      icon={<Wand2 size={13} />}
                      size="small" theme="borderless" type="tertiary"
                      disabled={!field.label.trim()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={generateKey}
                      aria-label="根据名称生成 key"
                    />
                  </Tooltip>
                )}
              />
              {keyError ? (
                <Typography.Text type="danger" size="small">{keyError}</Typography.Text>
              ) : (
                <Typography.Text type="tertiary" size="small">用于提交数据与公式/联动引用；修改会自动同步所有引用</Typography.Text>
              )}
            </div>
          )}

          {/* 占位文字（非说明文字、流水号、布局类型、开关、滑块） */}
          {!isDescription && !isSerialNumber && !isLayout && !isSwitch && !isSlider && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">提示文字</Typography.Text>
              <Input
                value={field.placeholder ?? ''}
                onChange={(v) => onChange({ placeholder: v || undefined })}
                placeholder="请输入提示文字"
              />
            </div>
          )}

          {/* 必填开关（非说明文字、流水号、布局类型、公式、开关） */}
          {!isDescription && !isSerialNumber && !isLayout && !isFormula && !isSwitch && (
            <div className="fd-form-config__field fd-form-config__field--inline">
              <Typography.Text strong size="small">必填</Typography.Text>
              <Switch
                checked={field.required ?? false}
                onChange={(v) => onChange({ required: v })}
                size="small"
              />
            </div>
          )}

          {/* 帮助提示（非纯展示） */}
          {!isDescription && !isLayout && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">帮助提示</Typography.Text>
              <Input
                value={field.helpText ?? ''}
                onChange={(v) => onChange({ helpText: v || undefined })}
                placeholder="显示在字段下方的辅助说明"
              />
            </div>
          )}

          {/* 默认值（简单类型） */}
          {(field.type === 'text' || isFormatted) && (
            <div className="fd-form-config__field">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography.Text strong size="small">默认值</Typography.Text>
                <Dropdown
                  trigger="click"
                  position="bottomRight"
                  render={(
                    <Dropdown.Menu>
                      {DYNAMIC_DEFAULT_TOKENS.map((t) => (
                        <Dropdown.Item
                          key={t.token}
                          onClick={() => onChange({ defaultValue: `${typeof field.defaultValue === 'string' ? field.defaultValue : ''}${t.token}` })}
                        >
                          {t.label} <Typography.Text type="tertiary" size="small">{t.token}</Typography.Text>
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  )}
                >
                  <Button size="small" theme="borderless" type="tertiary">插入变量</Button>
                </Dropdown>
              </div>
              <Input
                value={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
                onChange={(v) => onChange({ defaultValue: v || undefined })}
                placeholder="留空表示无默认值，支持 ${currentUser} 等动态变量"
              />
            </div>
          )}
          {isAmountOrNumber && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">默认值</Typography.Text>
              <InputNumber
                value={field.defaultValue as number | undefined}
                onChange={(v) => onChange({ defaultValue: v === undefined || v === '' ? undefined : Number(v) })}
                placeholder="留空表示无默认值"
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 选项来源（select）：静态选项 / 远程数据源 */}
          {field.type === 'select' && (
            <DataSourceSourceEditor field={field} remote={isRemoteSource} onRemoteChange={setIsRemoteSource} onChange={onChange} />
          )}

          {/* 选项列表（select/multiSelect/...，远程数据源时隐藏） */}
          {hasOptions && !isRemoteSource && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">选项</Typography.Text>
              <OptionsEditor
                options={field.options ?? []}
                onChange={(opts) => onChange({ options: opts })}
              />
            </div>
          )}

          {/* 级联：选项依赖父字段（远程数据源时不可用） */}
          {supportsCascade && !isRemoteSource && (
            <CascadeEditor
              field={field}
              allFields={allFields}
              onChange={onChange}
            />
          )}

          {/* 联动赋值：选择某选项时自动填充其它字段（远程数据源时不可用） */}
          {field.type === 'select' && !isRemoteSource && (
            <AutoFillEditor
              field={field}
              allFields={allFields}
              onChange={onChange}
            />
          )}

          {/* 数字/金额精度 */}
          {isAmountOrNumber && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">小数位数</Typography.Text>
              <InputNumber
                value={field.precision ?? 0}
                onChange={(v) => onChange({ precision: v as number })}
                min={0}
                max={6}
                placeholder="请输入小数位数"
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 数字/金额单位 */}
          {(isAmountOrNumber || field.type === 'number') && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">单位</Typography.Text>
              <Input
                value={field.unit ?? ''}
                onChange={(v) => onChange({ unit: v || undefined })}
                placeholder="如 元、天、件"
              />
            </div>
          )}

          {/* 联动：从日期范围自动计算天数 */}
          {field.type === 'number' && (
            <DateRangeLinkageEditor
              field={field}
              allFields={allFields}
              onChange={onChange}
            />
          )}

          {/* 评分上限 */}
          {isRate && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">星级上限</Typography.Text>
              <InputNumber
                value={field.rateMax ?? 5}
                onChange={(v) => onChange({ rateMax: Number(v) || 5 })}
                min={1}
                max={10}
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 公式表达式 */}
          {isFormula && (
            <>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">公式表达式</Typography.Text>
                <TextArea
                  value={field.formula ?? ''}
                  onChange={(v) => onChange({ formula: v })}
                  placeholder="如：{amount}*{days}、IF({days}>3,{amount}*0.9,{amount})、SUM({items.amount})"
                  rows={3}
                />
                <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                  支持 + - * / 与比较/三元，函数 IF/SUM/AVG/MAX/MIN/ROUND/ABS/CEIL/FLOOR；明细汇总用 {'{明细key.列key}'}
                </Typography.Text>
                {formulaValidationError && (
                  <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>
                    {formulaValidationError}
                  </Typography.Text>
                )}
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">结果小数位</Typography.Text>
                <InputNumber
                  value={field.precision ?? 2}
                  onChange={(v) => onChange({ precision: Number(v) })}
                  min={0}
                  max={6}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">单位</Typography.Text>
                <Input
                  value={field.unit ?? ''}
                  onChange={(v) => onChange({ unit: v || undefined })}
                  placeholder="如 元、天"
                />
              </div>
            </>
          )}

          {/* 金额币种 */}
          {isAmount && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">币种</Typography.Text>
              <Select
                value={field.currency ?? 'CNY'}
                onChange={(v) => onChange({ currency: v as string })}
                placeholder="请选择币种"
                style={{ width: '100%' }}
                optionList={CURRENCY_OPTIONS}
              />
            </div>
          )}

          {/* 金额大写（仅人民币） */}
          {isAmount && (field.currency ?? 'CNY') === 'CNY' && (
            <div className="fd-form-config__field fd-form-config__field--inline">
              <Typography.Text strong size="small">显示中文大写</Typography.Text>
              <Switch
                checked={field.amountInWords ?? false}
                onChange={(v) => onChange({ amountInWords: v || undefined })}
                size="small"
              />
            </div>
          )}

          {/* 日期格式 */}
          {isDate && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">日期格式</Typography.Text>
              <Select
                value={toDateFnsToken(field.dateFormat)}
                onChange={(v) => onChange({ dateFormat: v as string })}
                placeholder="请选择日期格式"
                style={{ width: '100%' }}
                optionList={DATE_FORMAT_OPTIONS}
              />
            </div>
          )}

          {/* 时间格式 */}
          {isTime && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">时间格式</Typography.Text>
              <Select
                value={field.timeFormat ?? 'HH:mm'}
                onChange={(v) => onChange({ timeFormat: v as string })}
                placeholder="请选择时间格式"
                style={{ width: '100%' }}
                optionList={TIME_FORMAT_OPTIONS}
              />
            </div>
          )}

          {/* 省市区选择层级 */}
          {isRegion && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">选择层级</Typography.Text>
              <Select
                value={field.regionLevel ?? 'district'}
                onChange={(v) => onChange({ regionLevel: v as 'province' | 'city' | 'district' })}
                placeholder="请选择层级"
                style={{ width: '100%' }}
                optionList={REGION_LEVEL_OPTIONS}
              />
            </div>
          )}

          {/* 开关默认值 */}
          {isSwitch && (
            <div className="fd-form-config__field fd-form-config__field--inline">
              <Typography.Text strong size="small">默认开启</Typography.Text>
              <Switch
                checked={field.defaultValue === true}
                onChange={(v) => onChange({ defaultValue: v })}
                size="small"
              />
            </div>
          )}

          {/* 滑块范围 */}
          {isSlider && (
            <>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">最小值</Typography.Text>
                <InputNumber
                  value={field.min ?? 0}
                  onChange={(v) => onChange({ min: v === undefined || v === '' ? 0 : Number(v) })}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">最大值</Typography.Text>
                <InputNumber
                  value={field.max ?? 100}
                  onChange={(v) => onChange({ max: v === undefined || v === '' ? 100 : Number(v) })}
                  style={{ width: '100%' }}
                />
              </div>
              {field.min !== undefined && field.max !== undefined && field.min > field.max && (
                <Typography.Text type="danger" size="small" style={{ display: 'block', marginBottom: 12 }}>
                  滑块最小值不能大于最大值
                </Typography.Text>
              )}
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">步长</Typography.Text>
                <InputNumber
                  value={field.step ?? 1}
                  onChange={(v) => onChange({ step: v === undefined || v === '' ? 1 : Number(v) })}
                  min={0}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="fd-form-config__field fd-form-config__field--inline">
                <Typography.Text strong size="small">显示刻度</Typography.Text>
                <Switch
                  checked={field.sliderMarks ?? false}
                  onChange={(v) => onChange({ sliderMarks: v || undefined })}
                  size="small"
                />
              </div>
            </>
          )}

          {/* 标签最大数量 */}
          {isTags && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">最大标签数</Typography.Text>
              <InputNumber
                value={field.maxCount}
                onChange={(v) => onChange({ maxCount: v === undefined || v === '' ? undefined : Number(v) })}
                min={1}
                placeholder="不限"
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 数据字典绑定 */}
          {isDictSelect && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">数据字典</Typography.Text>
              <DictCodePicker
                value={field.dictCode}
                onChange={(code) => onChange({ dictCode: code })}
              />
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                运行时将展示所选字典的全部启用项
              </Typography.Text>
            </div>
          )}

          {/* 关联审批单绑定 */}
          {isRelationSelect && (
            <>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">关联流程</Typography.Text>
                <RelationDefinitionPicker
                  value={field.relationDefinitionId}
                  onChange={(id) => onChange({ relationDefinitionId: id })}
                />
                <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                  留空表示可关联任意已发布流程的审批单
                </Typography.Text>
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">展示字段 key</Typography.Text>
                <Input
                  value={field.relationDisplayField ?? ''}
                  onChange={(v) => onChange({ relationDisplayField: v || undefined })}
                  placeholder="可选，如 title / formData.amount"
                />
              </div>
            </>
          )}

          {/* 系统选择器：是否多选 */}
          {isSystemSelect && (
            <div className="fd-form-config__field fd-form-config__field--inline">
              <Typography.Text strong size="small">允许多选</Typography.Text>
              <Switch
                checked={field.multiple ?? false}
                onChange={(v) => onChange({ multiple: v || undefined })}
                size="small"
              />
            </div>
          )}

          {/* 附件/图片限制数 */}
          {isFileType && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">最大数量</Typography.Text>
              <InputNumber
                value={field.maxCount ?? 5}
                onChange={(v) => onChange({ maxCount: v as number })}
                min={1}
                max={20}
                placeholder="请输入最大数量"
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 说明文字内容 */}
          {isDescription && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">说明内容</Typography.Text>
              <TextArea
                value={field.description ?? ''}
                onChange={(v) => onChange({ description: v })}
                placeholder="请输入说明内容"
                rows={4}
              />
            </div>
          )}

          {/* 流水号前缀 */}
          {isSerialNumber && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">编号前缀</Typography.Text>
              <Input
                value={field.serialPrefix ?? ''}
                onChange={(v) => onChange({ serialPrefix: v })}
                placeholder="如：REQ-"
              />
            </div>
          )}

          {/* 验证码位数 */}
          {isPinCode && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">验证码位数</Typography.Text>
              <InputNumber
                value={field.maxCount ?? 6}
                onChange={(v) => onChange({ maxCount: v === undefined || v === '' ? 6 : Number(v) })}
                min={4}
                max={8}
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 自动完成建议项提示 */}
          {isAutoComplete && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
              上方「选项」即为输入时的建议项，用户仍可自由输入其它值。
            </Typography.Text>
          )}

          {/* 颜色选择器：透明度 */}
          {isColorPicker && (
            <div className="fd-form-config__field fd-form-config__field--inline">
              <Typography.Text strong size="small">支持透明度</Typography.Text>
              <Switch
                checked={field.alpha ?? false}
                onChange={(v) => onChange({ alpha: v || undefined })}
                size="small"
              />
            </div>
          )}

          {/* 明细子字段 */}
          {hasChildren && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">明细子字段</Typography.Text>
              <DetailChildrenEditor
                items={field.children ?? []}
                onChange={(children) => onChange({ children })}
              />
            </div>
          )}

          {/* --- 布局与状态（响应式列宽 / 只读 / 隐藏） --- */}
          {supportsLayoutState && (
            <div className="fd-form-config__section" style={{ borderTop: '1px solid var(--semi-color-border)', padding: '12px 0 0', marginTop: 12 }}>
              <div className="fd-form-config__section-title">布局与状态</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">字段宽度</Typography.Text>
                <Select
                  value={field.columnSpan ?? 24}
                  onChange={(v) => onChange({ columnSpan: Number(v) })}
                  style={{ width: '100%' }}
                  optionList={COLUMN_SPAN_OPTIONS}
                />
                <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                  同一行内多个字段会按宽度自动并排（飞书风格）
                </Typography.Text>
              </div>
              <div className="fd-form-config__field fd-form-config__field--inline">
                <Typography.Text strong size="small">只读</Typography.Text>
                <Switch
                  checked={field.readOnly ?? false}
                  onChange={(v) => onChange({ readOnly: v || undefined })}
                  size="small"
                />
              </div>
              <div className="fd-form-config__field fd-form-config__field--inline">
                <Typography.Text strong size="small">默认隐藏</Typography.Text>
                <Switch
                  checked={field.hidden ?? false}
                  onChange={(v) => onChange({ hidden: v || undefined })}
                  size="small"
                />
              </div>
              {field.hidden && (
                <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
                  默认隐藏后，可在「显隐设置」中配置满足条件时再显示
                </Typography.Text>
              )}
            </div>
          )}

          {/* --- 字段级标签设置（覆盖表单级） --- */}
          {supportsLabelOverride && (
            <div className="fd-form-config__section" style={{ borderTop: '1px solid var(--semi-color-border)', padding: '12px 0 0', marginTop: 12 }}>
              <div className="fd-form-config__section-title">标签设置（覆盖表单级）</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">标签位置</Typography.Text>
                <Select
                  value={field.labelPosition ?? ''}
                  onChange={(v) => onChange({ labelPosition: (v as 'top' | 'left' | 'inset') || undefined })}
                  placeholder="跟随表单设置"
                  style={{ width: '100%' }}
                  showClear
                  optionList={[{ value: '', label: '跟随表单' }, ...LABEL_POSITION_OPTIONS]}
                />
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">标签对齐</Typography.Text>
                <Select
                  value={field.labelAlign ?? ''}
                  onChange={(v) => onChange({ labelAlign: (v as 'left' | 'right') || undefined })}
                  placeholder="跟随表单设置"
                  style={{ width: '100%' }}
                  showClear
                  optionList={[{ value: '', label: '跟随表单' }, ...LABEL_ALIGN_OPTIONS]}
                />
              </div>
              {(field.labelPosition === 'left' || field.labelPosition === 'inset') && (
                <div className="fd-form-config__field">
                  <Typography.Text strong size="small">标签宽度</Typography.Text>
                  <InputNumber
                    value={field.labelWidth}
                    onChange={(v) => onChange({ labelWidth: v === undefined || v === '' ? undefined : Number(v) })}
                    min={40}
                    max={400}
                    suffix="px"
                    placeholder="跟随表单"
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* --- 分栏设置 --- */}
          {field.type === 'row' && (
            <div className="fd-form-config__section" style={{ borderTop: 'none', padding: 0, marginTop: 12 }}>
              <div className="fd-form-config__section-title">分栏设置</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small" style={{ marginBottom: 4, display: 'block' }}>列数</Typography.Text>
                <InputNumber
                  min={2} max={4}
                  value={field.columns?.length || 2}
                  placeholder="请输入列数"
                  onChange={(val) => {
                    const num = Number(val) || 2;
                    const existing = field.columns || [];
                    const newCols = Array.from({ length: num }, (_, i) =>
                      existing[i] || { span: Math.floor(24 / num), fields: [] }
                    );
                    onChange({ columns: newCols });
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              {field.columns?.map((col, i) => (
                <div className="fd-form-config__field" key={`${col.span}-${i}`}>
                  <Typography.Text size="small" style={{ marginBottom: 4, display: 'block' }}>第 {i + 1} 列宽度 (24栅格)</Typography.Text>
                  <InputNumber
                    min={1} max={24}
                    value={col.span}
                    placeholder="请输入列宽"
                    onChange={(val) => {
                      const newCols = [...(field.columns || [])];
                      newCols[i] = { ...newCols[i], span: Number(val) || 1 };
                      onChange({ columns: newCols });
                    }}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
              <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: 4 }}>
                总宽度: {field.columns?.reduce((s, c) => s + c.span, 0) || 0} / 24
                {(field.columns?.reduce((s, c) => s + c.span, 0) || 0) !== 24 && (
                  <span style={{ color: 'var(--semi-color-danger)', marginLeft: 8 }}>⚠ 建议总宽度为24</span>
                )}
              </div>
            </div>
          )}

          {/* --- 分割线设置 --- */}
          {field.type === 'divider' && (
            <div className="fd-form-config__field" style={{ marginTop: 12 }}>
              <div style={{ color: 'var(--semi-color-text-2)', fontSize: 13 }}>
                分割线用于视觉分隔表单区域，除了上方可配置的"名称"外无需额外配置。
              </div>
            </div>
          )}

          {/* --- 分组设置 --- */}
          {field.type === 'group' && (
            <div className="fd-form-config__section" style={{ borderTop: 'none', padding: 0, marginTop: 12 }}>
              <div className="fd-form-config__section-title">分组设置</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small" style={{ marginBottom: 4, display: 'block' }}>分组标题</Typography.Text>
                <Input
                  value={field.title || ''}
                  onChange={(val) => onChange({ title: val })}
                  placeholder="输入分组标题"
                />
              </div>
              <div className="fd-form-config__field fd-form-config__field--inline">
                <Typography.Text strong size="small">可折叠</Typography.Text>
                <Switch
                  checked={field.collapsible ?? false}
                  onChange={(v) => onChange({ collapsible: v || undefined, ...(v ? {} : { defaultCollapsed: undefined }) })}
                  size="small"
                />
              </div>
              {field.collapsible && (
                <div className="fd-form-config__field fd-form-config__field--inline">
                  <Typography.Text strong size="small">默认折叠</Typography.Text>
                  <Switch
                    checked={field.defaultCollapsed ?? false}
                    onChange={(v) => onChange({ defaultCollapsed: v || undefined })}
                    size="small"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 校验规则 */}
      {activeSection === 'validation' && showValidationTab && (
        <div className="fd-form-config__section">
          {(isText || isFormatted) && (
            <>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">最小长度</Typography.Text>
                <InputNumber
                  value={field.minLength}
                  onChange={(v) => onChange({ minLength: v === undefined || v === '' ? undefined : Number(v) })}
                  min={0}
                  placeholder="不限"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">最大长度</Typography.Text>
                <InputNumber
                  value={field.maxLength}
                  onChange={(v) => onChange({ maxLength: v === undefined || v === '' ? undefined : Number(v) })}
                  min={1}
                  placeholder="不限"
                  style={{ width: '100%' }}
                />
              </div>
              {textRangeError && (
                <Typography.Text type="danger" size="small" style={{ display: 'block', marginBottom: 12 }}>
                  {textRangeError}
                </Typography.Text>
              )}
            </>
          )}
          {isAmountOrNumber && (
            <>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">最小值</Typography.Text>
                <InputNumber
                  value={field.min}
                  onChange={(v) => onChange({ min: v === undefined || v === '' ? undefined : Number(v) })}
                  placeholder="不限"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">最大值</Typography.Text>
                <InputNumber
                  value={field.max}
                  onChange={(v) => onChange({ max: v === undefined || v === '' ? undefined : Number(v) })}
                  placeholder="不限"
                  style={{ width: '100%' }}
                />
              </div>
              {numberRangeError && (
                <Typography.Text type="danger" size="small" style={{ display: 'block', marginBottom: 12 }}>
                  {numberRangeError}
                </Typography.Text>
              )}
            </>
          )}
          {/* 正则校验（仅 text 类型显式可配；格式化控件已内置） */}
          {isText && (
            <>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">正则表达式</Typography.Text>
                <Input
                  value={field.pattern ?? ''}
                  onChange={(v) => onChange({ pattern: v || undefined })}
                  placeholder="如 ^[A-Z0-9]+$"
                />
                {patternError && (
                  <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>
                    {patternError}
                  </Typography.Text>
                )}
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">校验失败提示</Typography.Text>
                <Input
                  value={field.patternMessage ?? ''}
                  onChange={(v) => onChange({ patternMessage: v || undefined })}
                  placeholder="如：仅允许大写字母和数字"
                />
              </div>
            </>
          )}
          {isFormatted && (
            <Typography.Text type="tertiary" size="small">
              该控件已内置格式校验，无需配置正则。
            </Typography.Text>
          )}
        </div>
      )}

      {/* 显隐设置 */}
      {activeSection === 'visibility' && (
        <div className="fd-form-config__section">
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
            配置多条件组合（且 / 或）联动；规则优先级高于「默认隐藏」
          </Typography.Text>

          {conditionFields.length === 0 ? (
            <Typography.Text type="tertiary" size="small">
              暂无可作为条件的字段（需要先添加单选/多选/数字/文本等类型字段）
            </Typography.Text>
          ) : (
            <>
              <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 6 }}>显隐联动</Typography.Text>
              <VisibilityRulesEditor
                field={field}
                conditionFields={conditionFields}
                onChange={onChange}
                ruleKey="visibilityRules"
                clearLegacy
                toggleLabel="启用条件显隐"
              />

              {supportsLayoutState && (
                <>
                  <div style={{ borderTop: '1px solid var(--semi-color-border)', margin: '14px 0 10px' }} />
                  <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 6 }}>条件必填</Typography.Text>
                  <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>
                    满足条件时该字段变为必填（与固定「必填」取或）
                  </Typography.Text>
                  <VisibilityRulesEditor
                    field={field}
                    conditionFields={conditionFields}
                    onChange={onChange}
                    ruleKey="requiredRules"
                    toggleLabel="启用条件必填"
                  />

                  <div style={{ borderTop: '1px solid var(--semi-color-border)', margin: '14px 0 10px' }} />
                  <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 6 }}>条件只读</Typography.Text>
                  <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>
                    满足条件时该字段变为只读（不可编辑）
                  </Typography.Text>
                  <VisibilityRulesEditor
                    field={field}
                    conditionFields={conditionFields}
                    onChange={onChange}
                    ruleKey="readOnlyRules"
                    toggleLabel="启用条件只读"
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 关联流程选择器（设计态：限制可关联哪个审批流） ──────────────────

let definitionListCache: WorkflowDefinition[] | null = null;

function RelationDefinitionPicker({
  value,
  onChange,
}: Readonly<{ value?: number; onChange: (id: number | undefined) => void }>) {
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>(definitionListCache ?? []);
  const [loading, setLoading] = useState(!definitionListCache);

  useEffect(() => {
    if (definitionListCache) return;
    setLoading(true);
    request.get<WorkflowDefinition[]>('/api/workflows/definitions/published', { silent: true })
      .then((res) => {
        if (res.code === 0 && res.data) {
          definitionListCache = res.data;
          setDefinitions(res.data);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Select
      value={value === undefined ? '' : String(value)}
      onChange={(v) => onChange(v === '' || v === undefined || v === null ? undefined : Number(v))}
      placeholder={loading ? '加载中...' : '请选择关联流程'}
      filter
      showClear
      disabled={loading}
      style={{ width: '100%' }}
      optionList={[
        { value: '', label: '任意流程' },
        ...definitions.map((d) => ({ value: String(d.id), label: d.name })),
      ]}
    />
  );
}

// ─── 数据字典选择器（设计态：选择绑定哪个字典 code） ──────────────────

interface DictOption { code: string; name: string }
let dictListCache: DictOption[] | null = null;

function DictCodePicker({
  value,
  onChange,
}: Readonly<{ value?: string; onChange: (code: string | undefined) => void }>) {
  const [dicts, setDicts] = useState<DictOption[]>(dictListCache ?? []);
  const [loading, setLoading] = useState(!dictListCache);

  useEffect(() => {
    if (dictListCache) return;
    setLoading(true);
    request.get<PaginatedResponse<Dict>>('/api/dicts?page=1&pageSize=200', { silent: true })
      .then((res) => {
        if (res.code === 0 && res.data) {
          const list = res.data.list.map((d) => ({ code: d.code, name: d.name }));
          dictListCache = list;
          setDicts(list);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Select
      value={value || undefined}
      onChange={(v) => onChange((v as string) || undefined)}
      placeholder={loading ? '加载中...' : '请选择数据字典'}
      filter
      showClear
      disabled={loading}
      style={{ width: '100%' }}
      optionList={dicts.map((d) => ({ value: d.code, label: `${d.name}（${d.code}）` }))}
    />
  );
}

// ─── 显隐联动规则编辑器（多条件 and/or） ──────────────────────────────

// 可作为显隐条件依赖的字段类型
const CONDITION_FIELD_TYPES = new Set<WorkflowFormFieldType>([
  'text', 'textarea', 'number', 'amount', 'slider',
  'select', 'multiSelect', 'radio', 'checkbox', 'switch', 'dictSelect',
  'date', 'dateRange',
]);

const VISIBILITY_OP = {
  eq: { value: 'eq', label: '等于' },
  neq: { value: 'neq', label: '不等于' },
  in: { value: 'in', label: '包含在' },
  contains: { value: 'contains', label: '包含' },
  gt: { value: 'gt', label: '大于' },
  lt: { value: 'lt', label: '小于' },
  gte: { value: 'gte', label: '大于等于' },
  lte: { value: 'lte', label: '小于等于' },
  isEmpty: { value: 'isEmpty', label: '为空' },
  notEmpty: { value: 'notEmpty', label: '不为空' },
} as const;

const NO_VALUE_OPERATORS = new Set<string>(['isEmpty', 'notEmpty']);

// 按依赖字段类型给出合适的操作符
function operatorsForField(f: WorkflowFormField | undefined) {
  switch (f?.type) {
    case 'number': case 'amount': case 'slider':
      return [VISIBILITY_OP.eq, VISIBILITY_OP.neq, VISIBILITY_OP.gt, VISIBILITY_OP.lt, VISIBILITY_OP.gte, VISIBILITY_OP.lte, VISIBILITY_OP.isEmpty, VISIBILITY_OP.notEmpty];
    case 'multiSelect': case 'checkbox':
      return [VISIBILITY_OP.contains, VISIBILITY_OP.isEmpty, VISIBILITY_OP.notEmpty];
    case 'select': case 'radio': case 'dictSelect':
      return [VISIBILITY_OP.eq, VISIBILITY_OP.neq, VISIBILITY_OP.in, VISIBILITY_OP.isEmpty, VISIBILITY_OP.notEmpty];
    case 'switch':
      return [VISIBILITY_OP.eq, VISIBILITY_OP.neq];
    default:
      return [VISIBILITY_OP.eq, VISIBILITY_OP.neq, VISIBILITY_OP.in, VISIBILITY_OP.isEmpty, VISIBILITY_OP.notEmpty];
  }
}

// 根据依赖字段类型与操作符渲染合适的「值」编辑器
function ConditionValueEditor({ refField, operator, value, onChange }: Readonly<{
  refField: WorkflowFormField | undefined;
  operator: string;
  value: unknown;
  onChange: (v: unknown) => void;
}>) {
  if (NO_VALUE_OPERATORS.has(operator)) return null;
  const type = refField?.type;
  const options = refField?.options ?? [];

  if (type === 'switch') {
    return (
      <Select
        value={value === true ? 'true' : value === false ? 'false' : undefined}
        onChange={(v) => onChange(v === 'true')} style={{ width: '100%' }}
        optionList={[{ value: 'true', label: '是 / 开' }, { value: 'false', label: '否 / 关' }]}
        placeholder="选择开关状态"
      />
    );
  }
  if (type === 'number' || type === 'amount' || type === 'slider') {
    return (
      <InputNumber
        value={value as number | undefined}
        onChange={(v) => onChange(v === '' || v === undefined ? undefined : Number(v))}
        style={{ width: '100%' }} placeholder="输入数值"
      />
    );
  }
  if (options.length > 0 && (type === 'select' || type === 'radio' || type === 'multiSelect' || type === 'checkbox')) {
    if (operator === 'in') {
      const arr = Array.isArray(value)
        ? value as string[]
        : (typeof value === 'string' && value ? value.split(',').map(s => s.trim()).filter(Boolean) : []);
      return (
        <Select
          multiple value={arr} onChange={(v) => onChange(v)} style={{ width: '100%' }}
          optionList={options.map(o => ({ value: o, label: o }))}
          placeholder="选择一个或多个值"
        />
      );
    }
    return (
      <Select
        value={value as string | undefined} onChange={onChange} style={{ width: '100%' }}
        optionList={options.map(o => ({ value: o, label: o }))}
        showClear placeholder="选择值"
      />
    );
  }
  return (
    <Input
      value={formatVisibilityValue(value)}
      onChange={(v) => onChange(v)}
      placeholder="条件值（多个值用英文逗号分隔表示「包含在」）"
    />
  );
}

function VisibilityRulesEditor({
  field,
  conditionFields,
  onChange,
  ruleKey = 'visibilityRules',
  clearLegacy = false,
  toggleLabel = '启用联动规则',
}: Readonly<{
  field: WorkflowFormField;
  conditionFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
  ruleKey?: 'visibilityRules' | 'requiredRules' | 'readOnlyRules';
  clearLegacy?: boolean;
  toggleLabel?: string;
}>) {
  const group = field[ruleKey];
  const enabled = !!group && (group.rules?.length ?? 0) > 0;
  const newRule = (): WorkflowFieldVisibilityCondition => ({
    field: conditionFields[0].key,
    operator: 'eq',
    value: '',
  });

  // 设置规则组（显隐规则同时清除旧版单条件，避免冲突）
  const setGroup = (logic: 'and' | 'or', rules: WorkflowFieldVisibilityCondition[]) =>
    onChange({ [ruleKey]: { logic, rules }, ...(clearLegacy ? { visibilityCondition: undefined } : {}) });

  const toggle = (v: boolean) => {
    if (v) setGroup('and', [newRule()]);
    else onChange({ [ruleKey]: undefined });
  };

  const updateRule = (index: number, patch: Partial<WorkflowFieldVisibilityCondition>) => {
    if (!group) return;
    setGroup(group.logic, group.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRule = () => {
    if (!group) return;
    setGroup(group.logic, [...group.rules, newRule()]);
  };

  const removeRule = (index: number) => {
    if (!group) return;
    const rules = group.rules.filter((_, i) => i !== index);
    if (rules.length === 0) onChange({ [ruleKey]: undefined });
    else setGroup(group.logic, rules);
  };

  return (
    <>
      <div className="fd-form-config__field fd-form-config__field--inline">
        <Typography.Text strong size="small">{toggleLabel}</Typography.Text>
        <Switch checked={enabled} onChange={toggle} size="small" />
      </div>

      {enabled && group && (
        <>
          <div className="fd-form-config__field fd-form-config__field--inline">
            <Typography.Text size="small">满足条件</Typography.Text>
            <RadioGroup
              type="button"
              value={group.logic}
              onChange={(e) => setGroup(e.target.value as 'and' | 'or', group.rules)}
            >
              <Radio value="and">全部（且）</Radio>
              <Radio value="or">任一（或）</Radio>
            </RadioGroup>
          </div>

          {group.rules.map((rule, index) => {
            const refField = conditionFields.find(f => f.key === rule.field);
            const opList = operatorsForField(refField);
            return (
            <div className="fd-form-config__visibility" key={`rule-${index}-${rule.field}`} style={{ position: 'relative' }}>
              <div className="fd-form-config__field">
                <Typography.Text size="small">当字段</Typography.Text>
                <Select
                  value={rule.field}
                  onChange={(v) => {
                    const nextField = conditionFields.find(f => f.key === v);
                    const nextOps = operatorsForField(nextField);
                    const keepOp = nextOps.some(o => o.value === rule.operator) ? rule.operator : nextOps[0].value;
                    updateRule(index, { field: v as string, operator: keepOp as WorkflowFieldVisibilityCondition['operator'], value: '' });
                  }}
                  placeholder="请选择字段"
                  style={{ width: '100%' }}
                  optionList={conditionFields.map(f => ({ value: f.key, label: f.label }))}
                />
              </div>
              <div className="fd-form-config__field">
                <Typography.Text size="small">条件</Typography.Text>
                <Select
                  value={rule.operator}
                  onChange={(v) => updateRule(index, {
                    operator: v as WorkflowFieldVisibilityCondition['operator'],
                    ...(NO_VALUE_OPERATORS.has(v as string) ? { value: '' } : {}),
                  })}
                  placeholder="请选择条件"
                  style={{ width: '100%' }}
                  optionList={opList}
                />
              </div>
              {!NO_VALUE_OPERATORS.has(rule.operator) && (
                <div className="fd-form-config__field">
                  <Typography.Text size="small">值</Typography.Text>
                  <ConditionValueEditor
                    refField={refField}
                    operator={rule.operator}
                    value={rule.value}
                    onChange={(v) => updateRule(index, { value: v })}
                  />
                </div>
              )}
              {group.rules.length > 1 && (
                <Button
                  size="small"
                  type="danger"
                  theme="borderless"
                  icon={<Trash2 size={12} />}
                  onClick={() => removeRule(index)}
                  style={{ position: 'absolute', top: 4, right: 0 }}
                />
              )}
            </div>
            );
          })}

          <Button size="small" type="tertiary" icon={<Plus size={12} />} onClick={addRule} style={{ marginTop: 4 }}>
            添加条件
          </Button>
        </>
      )}
    </>
  );
}

// ─── 选项编辑器 ──────────────────────────────────────────────────────

function OptionsEditor({
  options,
  onChange,
}: Readonly<{ options: string[]; onChange: (opts: string[]) => void }>) {
  const normalizedOptions = options.map((opt) => opt.trim()).filter(Boolean);
  const hasDuplicate = new Set(normalizedOptions).size !== normalizedOptions.length;
  const hasEmpty = options.some((opt) => !opt.trim());
  return (
    <div className="fd-options-editor">
      {options.map((opt, i) => (
        <div key={`opt-${opt}-${i}`} className="fd-options-editor__row">
          <Input
            size="small"
            value={opt}
            onChange={(v) => {
              const updated = [...options];
              updated[i] = v;
              onChange(updated);
            }}
            placeholder={`选项 ${i + 1}`}
          />
          <button
            type="button"
            className="fd-options-editor__delete"
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <Button
        size="small"
        type="tertiary"
        icon={<Plus size={12} />}
        onClick={() => onChange([...options, `选项${options.length + 1}`])}
      >
        添加选项
      </Button>
      {(hasEmpty || hasDuplicate) && (
        <Typography.Text type="warning" size="small">
          {hasEmpty ? '存在空选项，运行时不会有明确显示；' : ''}
          {hasDuplicate ? '存在重复选项，建议去重。' : ''}
        </Typography.Text>
      )}
    </div>
  );
}

// ─── 明细子字段编辑器 ────────────────────────────────────────────────

const DETAIL_CHILD_TYPES: Array<{ value: WorkflowFormFieldType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'amount', label: '金额' },
  { value: 'date', label: '日期' },
  { value: 'select', label: '单选' },
];

function DetailChildrenEditor({
  items,
  onChange,
}: Readonly<{ items: WorkflowFormField[]; onChange: (fields: WorkflowFormField[]) => void }>) {
  const addChild = () => {
    const key = createLocalFieldKey('text');
    onChange([
      ...items,
      { key, label: `列${items.length + 1}`, type: 'text' },
    ]);
  };

  const updateChild = (index: number, updates: Partial<WorkflowFormField>) => {
    const updated = [...items];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const removeChild = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="fd-detail-children">
      {items.map((child, i) => (
        <div key={child.key} className="fd-detail-children__row">
          <Input
            size="small"
            value={child.label}
            onChange={(v) => updateChild(i, { label: v })}
            placeholder="列名"
            style={{ flex: 1 }}
          />
          <Select
            size="small"
            value={child.type}
            onChange={(v) => updateChild(i, { type: v as WorkflowFormFieldType })}
            placeholder="选择类型"
            style={{ width: 90 }}
            optionList={DETAIL_CHILD_TYPES}
          />
          {(child.type === 'select') && (
            <TagInput
              size="small"
              value={child.options ?? []}
              onChange={(v) => updateChild(i, { options: v })}
              placeholder="选项"
              style={{ flex: 1 }}
            />
          )}
          {(child.type === 'number' || child.type === 'amount') && (
            <button
              type="button"
              className={`fd-detail-children__sum ${child.detailSummary ? 'fd-detail-children__sum--active' : ''}`}
              title={child.detailSummary ? '取消合计' : '在底部显示合计'}
              onClick={() => updateChild(i, { detailSummary: !child.detailSummary })}
            >
              Σ
            </button>
          )}
          <button
            type="button"
            className="fd-detail-children__delete"
            onClick={() => removeChild(i)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <Button
        size="small"
        type="tertiary"
        icon={<Plus size={12} />}
        onClick={addChild}
      >
        添加列
      </Button>
    </div>
  );
}

// ─── dateRange → 天数 联动配置 ────────────────────────────────────

function collectFlat(list: WorkflowFormField[]): WorkflowFormField[] {
  const out: WorkflowFormField[] = [];
  for (const f of list) {
    out.push(f);
    if (f.type === 'row' && f.columns) for (const c of f.columns) out.push(...collectFlat(c.fields));
    else if ((f.type === 'group' || f.type === 'detail') && f.children) out.push(...collectFlat(f.children));
  }
  return out;
}

function DateRangeLinkageEditor({
  field, allFields, onChange,
}: Readonly<{
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
}>) {
  const rangeFields = collectFlat(allFields).filter(f => f.type === 'dateRange' && f.key !== field.key);
  if (rangeFields.length === 0) return null;
  return (
    <div className="fd-form-config__field">
      <Typography.Text strong size="small">联动：自动计算天数</Typography.Text>
      <Select
        value={field.daysFromKey ?? ''}
        onChange={(v) => onChange({ daysFromKey: (v as string) || undefined })}
        placeholder="选择日期范围字段（不联动则留空）"
        style={{ width: '100%' }}
        showClear
        optionList={[
          { value: '', label: '不联动' },
          ...rangeFields.map(f => ({ value: f.key, label: f.label })),
        ]}
      />
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
        选定后，此字段会根据日期范围自动填入「结束-开始+1」天数并禁用手填
      </Typography.Text>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
        若结束日期早于开始日期，运行时会自动清空计算结果，避免产生负数天数。
      </Typography.Text>
    </div>
  );
}

// ─── select 选项来源：静态 / 远程数据源 ───────────────────────────────

function DataSourceSourceEditor({
  field, remote, onRemoteChange, onChange,
}: Readonly<{
  field: WorkflowFormField;
  remote: boolean;
  onRemoteChange: (remote: boolean) => void;
  onChange: (updates: Partial<WorkflowFormField>) => void;
}>) {
  const [sources, setSources] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    request.get<PaginatedResponse<WorkflowDataSource>>('/api/workflows/data-sources?page=1&pageSize=100&status=enabled', { silent: true })
      .then((res) => { if (res.code === 0 && res.data) setSources(res.data.list.map((d) => ({ id: d.id, name: d.name }))); })
      .catch(() => { /* 忽略加载失败 */ });
  }, []);

  return (
    <div className="fd-form-config__field">
      <Typography.Text strong size="small">选项来源</Typography.Text>
      <div style={{ marginTop: 4 }}>
        <RadioGroup
          type="button"
          value={remote ? 'remote' : 'static'}
          onChange={(e) => {
            if (e.target.value === 'remote') {
              onRemoteChange(true);
              onChange({ options: undefined, optionsFrom: undefined, autoFill: undefined, ...(sources[0] ? { dataSourceId: sources[0].id } : {}) });
            } else {
              onRemoteChange(false);
              onChange({ dataSourceId: undefined });
            }
          }}
        >
          <Radio value="static">静态选项</Radio>
          <Radio value="remote">远程数据源</Radio>
        </RadioGroup>
      </div>
      {remote && (
        <Select
          value={field.dataSourceId}
          onChange={(v) => onChange({ dataSourceId: (v as number) ?? undefined })}
          placeholder={sources.length ? '选择数据源' : '暂无启用的数据源，请先在「远程数据源」登记'}
          style={{ width: '100%', marginTop: 6 }}
          optionList={sources.map((s) => ({ value: s.id, label: s.name }))}
          showClear
        />
      )}
    </div>
  );
}

// ─── select 联动赋值：选中某选项时自动填充其它字段 ──────────────────

const AUTOFILL_EXCLUDE = new Set<WorkflowFormFieldType>(['row', 'group', 'divider', 'description', 'detail']);

function AutoFillEditor({
  field, allFields, onChange,
}: Readonly<{
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
}>) {
  const flat = collectFlat(allFields);
  const options = (field.options ?? []).filter(Boolean);
  const candidates = flat.filter((f) => f.key !== field.key && !AUTOFILL_EXCLUDE.has(f.type));
  const current = field.autoFill;
  const targets = current?.targets ?? [];

  if (options.length === 0 || candidates.length === 0) return null;

  const setTargets = (next: string[]) => {
    if (next.length === 0) { onChange({ autoFill: undefined }); return; }
    const byOption: Record<string, Record<string, string>> = {};
    for (const opt of options) {
      const m = current?.byOption[opt] ?? {};
      byOption[opt] = Object.fromEntries(next.filter((t) => m[t] !== undefined).map((t) => [t, m[t]]));
    }
    onChange({ autoFill: { targets: next, byOption } });
  };

  const setCell = (opt: string, targetKey: string, value: string) => {
    if (!current) return;
    const optMap = { ...(current.byOption[opt] ?? {}) };
    if (value === '') delete optMap[targetKey]; else optMap[targetKey] = value;
    onChange({ autoFill: { targets: current.targets, byOption: { ...current.byOption, [opt]: optMap } } });
  };

  return (
    <div className="fd-form-config__field">
      <Typography.Text strong size="small">联动赋值（选择后自动填充）</Typography.Text>
      <Select
        multiple
        value={targets}
        onChange={(v) => setTargets((v as string[]) ?? [])}
        placeholder="选择要自动填充的目标字段（留空不启用）"
        style={{ width: '100%' }}
        showClear
        optionList={candidates.map((f) => ({ value: f.key, label: f.label }))}
      />
      {targets.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {targets.map((tk) => {
            const tf = candidates.find((c) => c.key === tk);
            return (
              <div key={tk} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: 8 }}>
                <Typography.Text size="small" strong>{tf?.label ?? tk}</Typography.Text>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {options.map((opt) => (
                    <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Typography.Text size="small" style={{ width: 80, flexShrink: 0 }}>{opt}</Typography.Text>
                      <Input
                        size="small"
                        value={current?.byOption[opt]?.[tk] ?? ''}
                        onChange={(v) => setCell(opt, tk, v)}
                        placeholder="填充值"
                        style={{ flex: 1 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <Typography.Text type="tertiary" size="small">选择某选项时，按上表把对应值写入目标字段（留空则不填充）。</Typography.Text>
        </div>
      )}
    </div>
  );
}

// ─── select 级联：依赖父字段的选项映射 ────────────────────────────

function CascadeEditor({
  field, allFields, onChange,
}: Readonly<{
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
}>) {
  const flatFields = collectFlat(allFields);
  const parentCandidates = flatFields.filter(
    f => (f.type === 'select') && f.key !== field.key && (f.options?.length ?? 0) > 0,
  );
  if (parentCandidates.length === 0) return null;

  const current = field.optionsFrom;
  const parent = current ? parentCandidates.find(f => f.key === current.sourceKey) : null;
  const currentCreatesCycle = current ? createsCascadeCycle(field.key, current.sourceKey, flatFields) : false;

  const setParent = (sourceKey: string | undefined) => {
    if (!sourceKey) {
      onChange({ optionsFrom: undefined });
      return;
    }
    if (createsCascadeCycle(field.key, sourceKey, flatFields)) return;
    const pf = parentCandidates.find(f => f.key === sourceKey);
    const mapping: Record<string, string[]> = {};
    for (const opt of pf?.options ?? []) mapping[opt] = current?.mapping[opt] ?? [];
    onChange({ optionsFrom: { sourceKey, mapping } });
  };

  const setMapping = (parentValue: string, opts: string[]) => {
    if (!current) return;
    onChange({ optionsFrom: { ...current, mapping: { ...current.mapping, [parentValue]: opts } } });
  };

  return (
    <div className="fd-form-config__field">
      <Typography.Text strong size="small">级联：选项依赖父字段</Typography.Text>
      <Select
        value={current?.sourceKey ?? ''}
        onChange={(v) => setParent((v as string) || undefined)}
        placeholder="选择父字段（不级联则留空）"
        style={{ width: '100%' }}
        showClear
        optionList={[
          { value: '', label: '不级联' },
          ...parentCandidates.map(f => {
            const disabled = createsCascadeCycle(field.key, f.key, flatFields);
            return { value: f.key, label: disabled ? `${f.label}（会形成循环）` : f.label, disabled };
          }),
        ]}
      />
      {currentCreatesCycle && (
        <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 6 }}>
          当前级联依赖形成循环，请切换父字段或清空级联配置。
        </Typography.Text>
      )}
      {current && parent && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(parent.options ?? []).map(opt => (
            <div key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Typography.Text size="small" style={{ width: 80, flexShrink: 0 }}>{opt}</Typography.Text>
              <TagInput
                size="small"
                value={current.mapping[opt] ?? []}
                onChange={(v) => setMapping(opt, v)}
                placeholder="子选项"
                style={{ flex: 1 }}
              />
            </div>
          ))}
          <Typography.Text type="tertiary" size="small">
            为每个父选项配置可见的子选项；父值变化时已选的子值会被自动清空
          </Typography.Text>
          {(parent.options ?? []).some(opt => (current.mapping[opt]?.length ?? 0) > 0) && (
            <div className="fd-form-config__cascade-preview">
              <Typography.Text strong size="small">级联预览</Typography.Text>
              {(parent.options ?? []).map(parentValue => {
                const opts = current.mapping[parentValue] ?? [];
                return (
                  <div key={parentValue} className="fd-form-config__cascade-preview-row">
                    <span>{parentValue}</span>
                    <Typography.Text type="tertiary" size="small">
                      {opts.length > 0 ? opts.join('、') : '未配置子选项'}
                    </Typography.Text>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
