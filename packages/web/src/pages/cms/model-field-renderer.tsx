/**
 * CMS 内容模型字段 → 动态表单控件（内容编辑页与站点扩展字段共用）。
 * 值写入 `extend.{name}`；公共 props（label 后缀、labelWidth、rules、初值）由调用方决定，
 * 这里只负责按 `fieldType` 选控件并接入选项。
 */
import type { ReactNode } from 'react';
import { Form } from '@douyinfe/semi-ui';
import type { CmsModelField } from '@zenith/shared/cms';

/**
 * 字段可选项：优先用服务端解析后的 resolvedOptions（字典来源已展开），
 * 回落 options 兼容尚未返回 resolvedOptions 的旧接口响应。
 */
export function cmsModelFieldOptions(field: CmsModelField): { label: string; value: string }[] {
  return field.resolvedOptions ?? field.options ?? [];
}

export interface CmsModelFieldCommonProps {
  field: string;
  label: string;
  placeholder?: string;
  labelWidth?: number;
  rules?: { required?: boolean; message?: string }[];
  initValue?: unknown;
}

interface CmsModelFieldControlProps {
  readonly field: CmsModelField;
  /** 传给 Semi 表单控件的公共 props（`field` / `label` / `rules` / `initValue`…） */
  readonly common: CmsModelFieldCommonProps;
  /** 富文本回退为多行文本时的行数与占位；不传按普通多行文本（3 行）渲染 */
  readonly richtext?: { rows: number; placeholder?: string };
  /** image / file 类型的专用控件；不传则退化为普通输入框 */
  readonly media?: ReactNode;
}

export function CmsModelFieldControl({ field, common, richtext, media }: CmsModelFieldControlProps) {
  const options = cmsModelFieldOptions(field);
  switch (field.fieldType) {
    case 'textarea':
      return <Form.TextArea {...common} rows={3} />;
    case 'richtext':
      return richtext
        ? <Form.TextArea {...common} rows={richtext.rows} placeholder={richtext.placeholder ?? common.placeholder} />
        : <Form.TextArea {...common} rows={3} />;
    case 'number':
      return <Form.InputNumber {...common} style={{ width: '100%' }} />;
    case 'date':
      return <Form.DatePicker {...common} type="date" density="compact" style={{ width: '100%' }} />;
    case 'datetime':
      return <Form.DatePicker {...common} type="dateTime" density="compact" style={{ width: '100%' }} />;
    case 'select':
      return <Form.Select {...common} style={{ width: '100%' }} optionList={options} showClear />;
    case 'radio':
      return (
        <Form.RadioGroup {...common}>
          {options.map((o) => <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>)}
        </Form.RadioGroup>
      );
    case 'checkbox':
      return <Form.CheckboxGroup {...common} options={options} direction="horizontal" />;
    case 'switch':
      return <Form.Switch {...common} />;
    case 'image':
    case 'file':
      if (media) return <>{media}</>;
      return <Form.Input {...common} />;
    default:
      return <Form.Input {...common} />;
  }
}
