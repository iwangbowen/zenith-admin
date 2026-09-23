/**
 * CMS 内容模型字段 → 动态表单控件（内容编辑页与站点扩展字段共用）。
 * 值写入 `extend.{name}`；公共 props（label 后缀、labelWidth、rules、初值）由调用方决定，
 * 这里只负责按 `fieldType` 选控件并接入选项。
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { ArrayField, Button, Form, Space, Spin, useFormState, withField } from '@douyinfe/semi-ui';
import type { CmsModelField } from '@zenith/shared/cms';
import { getByPath } from '@zenith/shared/core';
import CmsContentReferenceInput from './CmsContentReferenceInput';

const RichTextEditor = lazy(() => import('@/components/RichTextEditor'));
const FormRichText = withField((props: { value?: string; onChange?: (value: string) => void; placeholder?: string }) => <Suspense fallback={<Spin />}><RichTextEditor {...props} height={220} /></Suspense>);
const FormContentReference = withField(CmsContentReferenceInput);

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
  readonly siteId?: number;
}

export function CmsModelFieldControl({ field, common, media, siteId }: CmsModelFieldControlProps) {
  const options = cmsModelFieldOptions(field);
  switch (field.fieldType) {
    case 'textarea':
      return <Form.TextArea {...common} rows={3} />;
    case 'richtext':
      return <FormRichText {...common} />;
    case 'reference': case 'references':
      return <FormContentReference {...common} siteId={siteId} multiple={field.fieldType === 'references'} />;
    case 'object':
      return <Form.Section text={common.label}>{field.configuration?.fields?.map((child) => <CmsModelFieldControl key={child.name} field={{ ...field, ...child, required: child.required ?? false, configuration: null }} common={{ field: `${common.field}.${child.name}`, label: child.label }} siteId={siteId} />)}</Form.Section>;
    case 'array': case 'blocks':
      return <Form.Section text={common.label}><ArrayField field={common.field}>{({ arrayFields, addWithInitValue }) => <Space vertical align="start" style={{ width: '100%' }}>
        {arrayFields.map(({ field: item, key, remove }) => <div key={key} style={{ width: '100%' }}>
          <ComponentFields definition={field} path={item} siteId={siteId} />
          <Button type="danger" theme="borderless" onClick={remove}>移除此组件</Button>
        </div>)}
        <Button onClick={() => addWithInitValue(field.fieldType === 'blocks' ? { blockType: field.configuration?.blockTypes?.[0]?.code } : {})}>添加组件</Button>
      </Space>}</ArrayField></Form.Section>;
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

function ComponentFields({ definition, path, siteId }: Readonly<{ definition: CmsModelField; path: string; siteId?: number }>) {
  const state = useFormState();
  const blockType = getByPath(state.values, `${path}.blockType`);
  const fields = definition.fieldType === 'blocks' ? definition.configuration?.blockTypes?.find((block) => block.code === blockType)?.fields : definition.configuration?.fields;
  return <>
    {definition.fieldType === 'blocks' && <Form.Select field={`${path}.blockType`} label="区块类型" optionList={definition.configuration?.blockTypes?.map((block) => ({ value: block.code, label: block.label }))} />}
    {fields?.map((child) => <CmsModelFieldControl key={child.name} field={{ ...definition, ...child, required: child.required ?? false, configuration: null }} common={{ field: `${path}.${child.name}`, label: child.label }} siteId={siteId} />)}
  </>;
}
