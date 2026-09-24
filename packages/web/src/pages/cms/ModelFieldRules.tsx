import { ArrayField, Button, Form, Space, Typography, useFormState } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import { getByPath } from '@zenith/shared/core';
import { CMS_COMPONENT_FIELD_TYPES, CMS_FIELD_TYPE_LABELS, type CmsModelField } from '@zenith/shared/cms';
import { useAllCmsModels } from '@/hooks/queries/cms-models';

const options = CMS_COMPONENT_FIELD_TYPES.map((type) => ({ value: type, label: CMS_FIELD_TYPE_LABELS[type] }));

function ChildFields({ field }: Readonly<{ field: string }>) {
  return <ArrayField field={field}>{({ arrayFields, addWithInitValue }) => <Space vertical align="start" style={{ width: '100%' }}>
    {arrayFields.map(({ field: child, key, remove }) => <Space key={key} wrap>
      <Form.Input field={`${child}.name`} label="标识" rules={[{ required: true }]} style={{ width: 160 }} />
      <Form.Input field={`${child}.label`} label="名称" rules={[{ required: true }]} style={{ width: 180 }} />
      <Form.Select field={`${child}.fieldType`} label="类型" initValue="text" optionList={options} style={{ width: 140 }} />
      <Form.Checkbox field={`${child}.required`} noLabel>发布必填</Form.Checkbox>
      <Button aria-label="删除子字段" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={remove} />
    </Space>)}
    <Button icon={<Plus size={14} />} onClick={() => addWithInitValue({ fieldType: 'text' })}>添加子字段</Button>
  </Space>}</ArrayField>;
}

export default function ModelFieldRules({ field, siteId }: Readonly<{ field: string; siteId?: number }>) {
  const state = useFormState();
  const type = getByPath(state.values, `${field}.fieldType`);
  const models = useAllCmsModels(siteId);
  const siblings = (getByPath(state.values, 'fields') ?? []) as Partial<CmsModelField>[];
  const requiredField = getByPath(state.values, `${field}.configuration.requiredWhen.field`);
  const requiredType = siblings.find((sibling) => sibling.name === requiredField)?.fieldType;
  return <div style={{ width: '100%', padding: '8px 0 4px' }}>
    <Space wrap>
      {type === 'number' ? <>
        <Form.InputNumber field={`${field}.configuration.min`} label="最小值" style={{ width: 150 }} />
        <Form.InputNumber field={`${field}.configuration.max`} label="最大值" style={{ width: 150 }} />
      </> : <>
        <Form.InputNumber field={`${field}.configuration.minLength`} label="最小长度" min={0} style={{ width: 150 }} />
        <Form.InputNumber field={`${field}.configuration.maxLength`} label="最大长度" min={1} style={{ width: 150 }} />
      </>}
      <Form.Checkbox field={`${field}.configuration.unique`} noLabel>站内唯一</Form.Checkbox>
    </Space>
    <Space wrap>
      <Form.Select field={`${field}.configuration.requiredWhen.field`} label="条件必填" showClear placeholder="选择条件字段" style={{ width: 220 }} optionList={siblings.filter((sibling) => sibling.name).map((sibling) => ({ value: sibling.name, label: sibling.label ?? sibling.name }))} />
      {requiredField ? requiredType === 'number' ? <Form.InputNumber field={`${field}.configuration.requiredWhen.equals`} label="等于" />
        : requiredType === 'switch' ? <Form.Switch field={`${field}.configuration.requiredWhen.equals`} label="等于" initValue={false} />
          : <Form.Input field={`${field}.configuration.requiredWhen.equals`} label="等于" /> : null}
      {type === 'reference' || type === 'references' ? <Form.Select field={`${field}.configuration.referenceModelIds`} label="允许引用的类型" multiple showClear style={{ width: 300 }} optionList={(models.data ?? []).map((model) => ({ value: model.id, label: model.name }))} /> : null}
    </Space>
    {(type === 'object' || type === 'array') && <ChildFields field={`${field}.configuration.fields`} />}
    {type === 'blocks' && <ArrayField field={`${field}.configuration.blockTypes`}>{({ arrayFields, addWithInitValue }) => <Space vertical align="start" style={{ width: '100%' }}>
      {arrayFields.map(({ field: block, key, remove }) => <div key={key}>
        <Space wrap>
          <Form.Input field={`${block}.code`} label="区块标识" rules={[{ required: true }]} />
          <Form.Input field={`${block}.label`} label="区块名称" rules={[{ required: true }]} />
          <Button type="danger" theme="borderless" onClick={remove}>删除区块</Button>
        </Space>
        <ChildFields field={`${block}.fields`} />
      </div>)}
      <Button onClick={() => addWithInitValue({ fields: [] })}>添加区块类型</Button>
    </Space>}</ArrayField>}
    <Typography.Text size="small" type="tertiary">保存为模型工作稿；发布新版本后供新稿使用，已审核修订保留原模型版本。</Typography.Text>
  </div>;
}
