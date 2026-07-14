// ─── 字段类型专属设置（选项来源/数字/公式/日期/文件等，拆分自 FieldConfigPanel.tsx）───
import { Input, InputNumber, Select, Switch, Typography, TextArea } from '@douyinfe/semi-ui';
import type { WorkflowFormField } from '@zenith/shared';
import { CURRENCY_OPTIONS, DATE_FORMAT_OPTIONS, TIME_FORMAT_OPTIONS, REGION_LEVEL_OPTIONS, DATE_LIMIT_OPTIONS, toDateFnsToken } from '../../form-types';
import type { FieldTypeFlags } from './field-type-flags';
import { RelationDefinitionPicker, DictCodePicker } from './pickers';
import { OptionsEditor } from './OptionsEditor';
import { DetailChildrenEditor } from './DetailChildrenEditor';
import { FormulaEditor } from './FormulaEditor';
import { DateRangeLinkageEditor, DataSourceSourceEditor, AutoFillEditor, CascadeEditor } from './linkage-editors';

interface TypeSpecificSectionProps {
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  flatFields: WorkflowFormField[];
  flags: FieldTypeFlags;
  isRemoteSource: boolean;
  setIsRemoteSource: (remote: boolean) => void;
  onChange: (updates: Partial<WorkflowFormField>) => void;
}

export function TypeSpecificSection({ field, allFields, flatFields, flags, isRemoteSource, setIsRemoteSource, onChange }: Readonly<TypeSpecificSectionProps>) {
  const {
    hasOptions, supportsCascade, hasChildren, isDescription, isSerialNumber, isAmountOrNumber, isAmount,
    isDate, isFileType, isRate, isFormula, isTime, isRegion, isSwitch, isSlider, isTags, isColorPicker,
    isPinCode, isAutoComplete, isDictSelect, isRelationSelect, isSystemSelect, allowOtherTypes,
  } = flags;

  return (
    <>
          {/* 选项来源（select）：静态选项 / 远程数据源 */}
          {field.type === 'select' && (
            <DataSourceSourceEditor field={field} remote={isRemoteSource} onRemoteChange={setIsRemoteSource} onChange={onChange} />
          )}

          {/* 选项列表（select/multiSelect/...，远程数据源时隐藏） */}
          {hasOptions && !isRemoteSource && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">选项</Typography.Text>
              <OptionsEditor field={field} onChange={onChange} />
            </div>
          )}

          {/* 允许填写「其他」自定义值（仅 select / radio） */}
          {allowOtherTypes && !isRemoteSource && (
            <div className="fd-form-config__field fd-form-config__field--inline">
              <Typography.Text strong size="small">允许填写「其他」</Typography.Text>
              <Switch
                size="small"
                checked={field.allowOther ?? false}
                onChange={(v) => onChange({ allowOther: v || undefined })}
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
              <FormulaEditor
                field={field}
                allFields={allFields}
                flatFields={flatFields}
                onChange={onChange}
              />
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

          {/* 日期可选范围 */}
          {isDate && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">可选范围</Typography.Text>
              <Select
                value={field.dateLimit ?? 'none'}
                onChange={(v) => onChange({ dateLimit: (v as 'none' | 'noPast' | 'noFuture' | 'custom') === 'none' ? undefined : (v as 'noPast' | 'noFuture' | 'custom') })}
                style={{ width: '100%' }}
                optionList={DATE_LIMIT_OPTIONS}
              />
              {field.dateLimit === 'custom' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Input
                    size="small"
                    value={field.minDate ?? ''}
                    onChange={(v) => onChange({ minDate: v || undefined })}
                    placeholder="最早 YYYY-MM-DD"
                  />
                  <Input
                    size="small"
                    value={field.maxDate ?? ''}
                    onChange={(v) => onChange({ maxDate: v || undefined })}
                    placeholder="最晚 YYYY-MM-DD"
                  />
                </div>
              )}
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

          {/* 附件/图片：允许类型 + 单文件大小 */}
          {isFileType && (
            <>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">允许的文件类型</Typography.Text>
                <Input
                  value={field.accept ?? ''}
                  onChange={(v) => onChange({ accept: v || undefined })}
                  placeholder={field.type === 'image' ? '默认 image/*，可改如 .jpg,.png' : '如 .pdf,.doc,.docx,.xls,.xlsx'}
                />
                <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                  逗号分隔的扩展名或 MIME，如 .pdf,.png,image/*；留空不限制
                </Typography.Text>
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">单文件大小上限</Typography.Text>
                <InputNumber
                  value={field.maxSize}
                  onChange={(v) => onChange({ maxSize: v === undefined || v === '' ? undefined : Number(v) })}
                  min={0}
                  suffix="MB"
                  placeholder="不限"
                  style={{ width: '100%' }}
                />
              </div>
            </>
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
    </>
  );
}
