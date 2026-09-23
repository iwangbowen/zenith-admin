import { ArrayField, Button, Form, Space, Typography, useFormState } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import { getByPath } from '@zenith/shared/core';
import { CMS_FIELD_TYPES, CMS_FIELD_TYPE_LABELS } from '@zenith/shared/cms';

const options = CMS_FIELD_TYPES.filter((type) => !['object', 'array', 'blocks', 'reference', 'references', 'image', 'file', 'select', 'radio', 'checkbox'].includes(type)).map((type) => ({ value: type, label: CMS_FIELD_TYPE_LABELS[type] }));

function ChildFields({ field }: Readonly<{ field: string }>) {
  return <ArrayField field={field}>{({ arrayFields, add }) => <Space vertical align="start" style={{ width: '100%' }}>
    {arrayFields.map(({ field: child, key, remove }) => <Space key={key} wrap>
      <Form.Input field={`${child}.name`} label="标识" rules={[{ required: true }]} style={{ width: 160 }} />
      <Form.Input field={`${child}.label`} label="名称" rules={[{ required: true }]} style={{ width: 180 }} />
      <Form.Select field={`${child}.fieldType`} label="类型" initValue="text" optionList={options} style={{ width: 140 }} />
      <Form.Checkbox field={`${child}.required`} noLabel>发布必填</Form.Checkbox>
      <Button aria-label="删除子字段" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={remove} />
    </Space>)}
    <Button icon={<Plus size={14} />} onClick={() => add({ fieldType: 'text' })}>添加子字段</Button>
  </Space>}</ArrayField>;
}

export default function ModelFieldRules({ field }: Readonly<{ field: string }>) {
  const state = useFormState();
  const type = getByPath(state.values, `${field}.fieldType`);
  return <div style={{ width: '100%', padding: '0 16px 16px' }}>
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
    {(type === 'object' || type === 'array') && <ChildFields field={`${field}.configuration.fields`} />}
    {type === 'blocks' && <ArrayField field={`${field}.configuration.blockTypes`}>{({ arrayFields, add }) => <Space vertical align="start" style={{ width: '100%' }}>
      {arrayFields.map(({ field: block, key, remove }) => <div key={key}>
        <Space wrap>
          <Form.Input field={`${block}.code`} label="区块标识" rules={[{ required: true }]} />
          <Form.Input field={`${block}.label`} label="区块名称" rules={[{ required: true }]} />
          <Button type="danger" theme="borderless" onClick={remove}>删除区块</Button>
        </Space>
        <ChildFields field={`${block}.fields`} />
      </div>)}
      <Button onClick={() => add({ fields: [] })}>添加区块类型</Button>
    </Space>}</ArrayField>}
    <Typography.Text size="small" type="tertiary">保存为模型工作稿；发布新版本后供新稿使用，已审核修订保留原模型版本。</Typography.Text>
  </div>;
}
