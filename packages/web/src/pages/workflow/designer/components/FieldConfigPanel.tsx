/**
 * 右侧字段属性配置面板 — 仅负责 Tab 切换与状态编排。
 * 各设置分区与子编辑器见 ./field-config/。
 */
import { useMemo, useState, useEffect } from 'react';
import { Input } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import type { WorkflowFormField } from '@zenith/shared';
import { FORM_FIELD_TYPES } from '../form-types';
import { collectFlat, CONDITION_FIELD_TYPES } from './field-config/helpers';
import { getFieldTypeFlags } from './field-config/field-type-flags';
import { BasicInfoSection } from './field-config/BasicInfoSection';
import { TypeSpecificSection } from './field-config/TypeSpecificSection';
import { AppearanceSection } from './field-config/AppearanceSection';
import { ValidationSection } from './field-config/ValidationSection';
import { VisibilitySection } from './field-config/VisibilitySection';

interface FieldConfigPanelProps {
  field: WorkflowFormField;
  allFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
  /** 重命名字段 key（级联更新所有引用） */
  onRenameKey?: (newKey: string) => void;
}

export default function FieldConfigPanel({
  field,
  allFields,
  onChange,
  onRenameKey,
}: Readonly<FieldConfigPanelProps>) {

  const [activeSection, setActiveSection] = useState<'basic' | 'validation' | 'visibility'>('basic');
  const [configQuery, setConfigQuery] = useState('');
  const fieldInfo = FORM_FIELD_TYPES.find(t => t.type === field.type);
  const flatFields = useMemo(() => collectFlat(allFields), [allFields]);

  // select 选项来源模式（静态/远程）：以显式状态跟踪，避免「无可用数据源时切换不生效」
  const [isRemoteSource, setIsRemoteSource] = useState(field.dataSourceId != null);
  // 切换字段时按该字段是否绑定数据源重置（同字段内的切换保持本地状态）
  useEffect(() => { setIsRemoteSource(field.dataSourceId != null); }, [field.key, field.dataSourceId]);
  const otherKeys = useMemo(() => new Set(flatFields.filter(f => f.key !== field.key).map(f => f.key)), [flatFields, field.key]);

  // 可用作条件依赖的字段（具备明确可比较值的类型，且不是当前字段）
  const conditionFields = useMemo(() => flatFields.filter(
    f => f.key !== field.key && CONDITION_FIELD_TYPES.has(f.type),
  ), [flatFields, field.key]);

  const flags = getFieldTypeFlags(field);
  const duplicateKey = flatFields.filter(f => f.key === field.key).length > 1;

  // Tab 已配置徽标（F08）：一眼看出该字段配了哪些规则
  const hasValidationConfig = !!(
    field.minLength !== undefined || field.maxLength !== undefined
    || field.min !== undefined || field.max !== undefined
    || field.pattern || field.unique || field.compareRules?.length
    || field.validationFormula || (field.dateLimit && field.dateLimit !== 'none')
    || field.maxSize || field.accept
  );
  const hasVisibilityConfig = !!(
    field.visibilityRules?.rules?.length || field.requiredRules?.rules?.length
    || field.readOnlyRules?.rules?.length || field.visibilityCondition?.field || field.hidden
  );

  // 配置项搜索（F08）：关键词 → 所在 Tab
  const searchIndex: Array<{ label: string; keywords: string; tab: 'basic' | 'validation' | 'visibility' }> = [
    { label: '名称 / 字段标识', keywords: '名称 标识 key', tab: 'basic' },
    { label: '提示文字 / 帮助', keywords: '提示 占位 placeholder 帮助', tab: 'basic' },
    { label: '必填 / 默认值 / 默认值公式', keywords: '必填 默认值 公式', tab: 'basic' },
    { label: '选项 / 级联 / 联动赋值 / 数据源', keywords: '选项 级联 联动 赋值 数据源 批量', tab: 'basic' },
    { label: '宽度 / 标签位置 / 折叠', keywords: '宽度 列宽 标签 位置 对齐 折叠 外观', tab: 'basic' },
    { label: '长度 / 数值范围', keywords: '长度 最小 最大 范围', tab: 'validation' },
    { label: '正则 / 唯一 / 字段比较', keywords: '正则 pattern 唯一 重复 比较', tab: 'validation' },
    { label: '校验公式', keywords: '校验 公式 validation', tab: 'validation' },
    { label: '显隐规则 / 条件必填 / 条件只读', keywords: '显隐 隐藏 条件 必填 只读 联动', tab: 'visibility' },
  ];
  const searchHits = configQuery.trim()
    ? searchIndex.filter((it) => (it.label + it.keywords).toLowerCase().includes(configQuery.trim().toLowerCase()))
    : [];

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

      {/* 配置项搜索 */}
      <div className="fd-form-config__search">
        <Input
          size="small"
          prefix={<Search size={13} />}
          placeholder="搜索配置项，如「正则」「显隐」"
          value={configQuery}
          onChange={setConfigQuery}
          showClear
        />
        {searchHits.length > 0 && (
          <div className="fd-form-config__search-hits">
            {searchHits.map((hit) => (
              <button
                key={hit.label}
                type="button"
                className="fd-form-config__search-hit"
                onClick={() => { setActiveSection(hit.tab); setConfigQuery(''); }}
              >
                {hit.label}
              </button>
            ))}
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
        {flags.showValidationTab && (
          <button
            type="button"
            className={`fd-form-config__tab ${activeSection === 'validation' ? 'fd-form-config__tab--active' : ''}`}
            onClick={() => setActiveSection('validation')}
          >
            校验规则{hasValidationConfig && <span className="fd-form-config__tab-dot" />}
          </button>
        )}
        <button
          type="button"
          className={`fd-form-config__tab ${activeSection === 'visibility' ? 'fd-form-config__tab--active' : ''}`}
          onClick={() => setActiveSection('visibility')}
        >
          显隐设置{hasVisibilityConfig && <span className="fd-form-config__tab-dot" />}
        </button>
      </div>

      {/* 基础设置 */}
      {activeSection === 'basic' && (
        <div className="fd-form-config__section">
          <BasicInfoSection
            field={field}
            flags={flags}
            otherKeys={otherKeys}
            duplicateKey={duplicateKey}
            flatFields={flatFields}
            onChange={onChange}
            onRenameKey={onRenameKey}
          />
          <TypeSpecificSection
            field={field}
            allFields={allFields}
            flatFields={flatFields}
            flags={flags}
            isRemoteSource={isRemoteSource}
            setIsRemoteSource={setIsRemoteSource}
            onChange={onChange}
          />
          <AppearanceSection field={field} flags={flags} onChange={onChange} />
        </div>
      )}

      {/* 校验规则 */}
      {activeSection === 'validation' && flags.showValidationTab && (
        <ValidationSection
          field={field}
          conditionFields={conditionFields}
          flatFields={flatFields}
          flags={flags}
          onChange={onChange}
        />
      )}

      {/* 显隐设置 */}
      {activeSection === 'visibility' && (
        <VisibilitySection
          field={field}
          conditionFields={conditionFields}
          flags={flags}
          onChange={onChange}
        />
      )}
    </div>
  );
}
