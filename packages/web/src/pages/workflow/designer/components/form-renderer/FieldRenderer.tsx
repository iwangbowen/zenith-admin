/**
 * 单个字段的渲染分派：按字段类型映射到 Semi Form 字段或自定义控件，叠加条件必填 / 只读、
 * 字段级标签覆盖与帮助文案；布局容器（row / group / tabs / steps）交给 layout-fields 递归。
 */
import { useContext } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import { Divider, Form, Select, Typography } from '@douyinfe/semi-ui';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { CURRENCY_OPTIONS, toDateFnsToken, dateFormatHasTime, dateFormatHasDay } from '../../form-types';
import { rmbUpper } from '@/utils/rmb';
import { ReadOnlyTextContext, ValuesContext } from './contexts';
import {
  EMAIL_REGEX, ID_CARD_REGEX, PHONE_REGEX, URL_REGEX,
  buildDisabledDate, fieldLabelNode, getDisplayOptions, optionLabelNode, toCascaderTreeData,
} from './field-utils';
import { buildDetailRules, buildFieldRules, requiredRules } from './field-rules';
import {
  FormColorPicker, FormDataSourceSelect, FormDeptSelect, FormDictSelect, FormFileUpload, FormRating,
  FormRegion, FormRelationSelect, FormRichText, FormSignature, FormUserSelect,
} from './field-controls';
import { FormDetailTable } from './DetailTableInput';
import { FormMatrix } from './MatrixInput';
import { FormLocation } from './LocationInput';
import { FormOptionInput } from './OptionInput';
import { READONLY_TEXT_TYPES } from './read-only-text';
import { ReadOnlyFieldValue } from './ReadOnlyFieldValue';
import { GroupLayout, RowLayout, StepsLayout, TabsLayout, type RenderField } from './layout-fields';

export function FieldRenderer({ field, readOnly }: Readonly<{ field: WorkflowFormField; readOnly?: boolean }>) {
  const values = useContext(ValuesContext);
  const readOnlyAsText = useContext(ReadOnlyTextContext);
  // 整表单只读的查看态：简单值字段直接文本化；字段级 readOnly（编辑态中的禁用字段）仍走控件禁用形态
  if (readOnly && readOnlyAsText && READONLY_TEXT_TYPES.has(field.type)) {
    return <ReadOnlyFieldValue field={field} />;
  }
  const { dynamicRequired, dynamicReadOnly, rules, numberRules } = buildFieldRules(field, values);
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
  const renderField: RenderField = (child) => <FieldRenderer key={child.key} field={child} readOnly={readOnly} />;

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
            ...requiredRules(field, dynamicRequired),
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
            ...requiredRules(field, dynamicRequired),
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
            ...requiredRules(field, dynamicRequired),
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
            ...requiredRules(field, dynamicRequired),
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
          rules={numberRules}
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
          rules={numberRules}
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
          type={dateFormatHasTime(field.dateFormat) ? 'dateTime' : dateFormatHasDay(field.dateFormat) ? 'date' : 'month'}
          insetInput={dateFormatHasTime(field.dateFormat)}
          style={{ width: '100%' }}
          format={toDateFnsToken(field.dateFormat)}
          onChangeWithDateFirst={false}
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
          onChangeWithDateFirst={false}
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

    case 'matrix': {
      const mRows = field.matrixRows ?? [];
      const mCols = field.matrixColumns ?? [];
      const matrixRules = dynamicRequired
        ? [{
          validator: (_r: unknown, v: unknown) => {
            const val = (v ?? {}) as Record<string, string>;
            return mRows.every((r) => !!val[r]);
          },
          message: `请完成${field.label}的全部行选择`,
        }]
        : undefined;
      return (
        <FormMatrix
          field={field.key} label={fieldLabelNode(field, dynamicRequired)}
          rows={mRows} cols={mCols}
          initValue={field.defaultValue as Record<string, string> | undefined}
          rules={matrixRules} disabled={disabled}
          {...extraProps}
        />
      );
    }

    case 'location': {
      const locationRules = dynamicRequired
        ? [{
          validator: (_r: unknown, v: unknown) => {
            const val = (v ?? {}) as { lng?: number; address?: string };
            return !!val.address || val.lng != null;
          },
          message: `请填写${field.label}`,
        }]
        : undefined;
      return (
        <FormLocation
          field={field.key} label={fieldLabelNode(field, dynamicRequired)}
          placeholder={field.placeholder}
          rules={locationRules} disabled={disabled}
          {...extraProps}
        />
      );
    }

    case 'cascader':
      return (
        <Form.Cascader
          field={field.key} label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          treeData={toCascaderTreeData(field.cascaderOptions ?? [])}
          changeOnSelect={field.cascaderChangeOnSelect}
          initValue={field.defaultValue as string[] | undefined}
          showClear
          style={{ width: '100%' }} rules={rules} disabled={disabled}
          {...extraProps}
        />
      );

    case 'nps': {
      const npsExtra = (field.npsMinLabel || field.npsMaxLabel)
        ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            <span>0 · {field.npsMinLabel ?? '完全不推荐'}</span>
            <span>10 · {field.npsMaxLabel ?? '强烈推荐'}</span>
          </div>
        )
        : undefined;
      return (
        <Form.RadioGroup
          field={field.key} label={field.label}
          type="button" buttonSize="middle"
          initValue={typeof field.defaultValue === 'number' ? field.defaultValue : undefined}
          rules={rules} disabled={disabled}
          options={Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: i }))}
          {...extraProps}
          extraText={npsExtra ?? (extraProps as { extraText?: ReactNode }).extraText}
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
        <div className="wf-form-description" style={{ marginBottom: 16, padding: '12px', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>
          {field.description ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{field.description}</ReactMarkdown>
          ) : (
            <Typography.Text type="secondary">说明文字</Typography.Text>
          )}
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
        <FormDetailTable
          field={field.key}
          label={fieldLabelNode(field, dynamicRequired)}
          columns={children}
          disabled={disabled}
          rules={buildDetailRules(field, children, dynamicRequired)}
          {...extraProps}
        />
      );
    }

    case 'row':
      return <RowLayout field={field} renderField={renderField} />;

    case 'divider':
      return field.title
        ? <Divider style={{ margin: '16px 0' }} align="center">{field.title}</Divider>
        : <Divider style={{ margin: '16px 0' }} />;

    case 'group':
      return <GroupLayout field={field} renderField={renderField} />;

    case 'tabs':
      return <TabsLayout field={field} renderField={renderField} />;

    case 'steps':
      return <StepsLayout field={field} renderField={renderField} />;

    default:
      return (
        <Form.Input
          field={field.key} label={field.label}
          placeholder={field.placeholder} rules={rules} disabled={disabled}
        />
      );
  }
}
