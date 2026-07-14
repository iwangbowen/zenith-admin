/**
 * 画布字段控件预览（F01 所见即所得）
 * 用非 Form 版 Semi 组件按字段配置渲染真实控件外观（禁用态、pointer-events 由外层关闭），
 * 让画布布局与最终填写页一致；交互（选中/拖拽/右键）由外层卡片壳负责。
 */
import { Input, TextArea, InputNumber, DatePicker, TimePicker, Select, Cascader, RadioGroup, Radio, CheckboxGroup, Switch, Slider, TagInput, Rating, Typography } from '@douyinfe/semi-ui';
import type { CascaderData } from '@douyinfe/semi-ui/lib/es/cascader';
import { Paperclip, ImageIcon, PenTool } from 'lucide-react';
import type { WorkflowFormField } from '@zenith/shared';
import { toDateFnsToken, dateFormatHasTime } from '../form-types';

function optionList(field: WorkflowFormField, max = 4) {
  const items = field.optionItems?.length
    ? field.optionItems.map((it) => ({ value: it.value, label: it.label || it.value }))
    : (field.options ?? []).map((o) => ({ value: o, label: o }));
  return items.slice(0, max);
}

function cascaderTree(field: WorkflowFormField): CascaderData[] {
  const walk = (nodes: NonNullable<WorkflowFormField['cascaderOptions']>): CascaderData[] =>
    nodes.map((n) => ({ label: n.label || n.value, value: n.value, ...(n.children?.length ? { children: walk(n.children) } : {}) }));
  return walk(field.cascaderOptions ?? []);
}

/** 附件/图片/签名等区块型占位 */
function BlockPlaceholder({ icon, text }: Readonly<{ icon: React.ReactNode; text: string }>) {
  return (
    <div className="fd-canvas-preview__block">
      {icon}
      <span>{text}</span>
    </div>
  );
}

export default function CanvasFieldPreview({ field }: Readonly<{ field: WorkflowFormField }>) {
  const placeholder = field.placeholder ?? `请输入${field.label}`;
  const pickPlaceholder = field.placeholder ?? `请选择${field.label}`;
  const w = { width: '100%' } as const;

  switch (field.type) {
    case 'textarea':
      return <TextArea rows={2} placeholder={placeholder} disabled />;
    case 'number':
    case 'amount':
      return (
        <InputNumber
          style={w} disabled hideButtons={false}
          placeholder={field.placeholder ?? '0'}
          prefix={field.type === 'amount' ? '¥' : undefined}
          suffix={field.unit || undefined}
          value={typeof field.defaultValue === 'number' ? field.defaultValue : undefined}
        />
      );
    case 'date':
      return <DatePicker style={w} disabled type={dateFormatHasTime(field.dateFormat) ? 'dateTime' : 'date'} format={toDateFnsToken(field.dateFormat)} placeholder={pickPlaceholder} />;
    case 'dateRange':
      return <DatePicker style={w} disabled type={dateFormatHasTime(field.dateFormat) ? 'dateTimeRange' : 'dateRange'} format={toDateFnsToken(field.dateFormat)} />;
    case 'time':
      return <TimePicker style={w} disabled format={field.timeFormat ?? 'HH:mm'} placeholder={pickPlaceholder} />;
    case 'select':
    case 'dictSelect':
    case 'autoComplete':
      return <Select style={w} disabled placeholder={pickPlaceholder} optionList={optionList(field)} />;
    case 'multiSelect':
      return <Select style={w} disabled multiple placeholder={pickPlaceholder} optionList={optionList(field)} />;
    case 'userSelect':
      return <Select style={w} disabled multiple={field.multiple} placeholder={field.placeholder ?? '请选择人员'} />;
    case 'deptSelect':
      return <Select style={w} disabled multiple={field.multiple} placeholder={field.placeholder ?? '请选择部门'} />;
    case 'relation':
      return <Select style={w} disabled placeholder={field.placeholder ?? '请选择关联审批单'} />;
    case 'cascader':
      return <Cascader style={w} disabled placeholder={pickPlaceholder} treeData={cascaderTree(field)} />;
    case 'region':
      return <Select style={w} disabled placeholder="省 / 市 / 区" />;
    case 'radio':
      return (
        <RadioGroup disabled value={typeof field.defaultValue === 'string' ? field.defaultValue : undefined}>
          {optionList(field).map((o) => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}
        </RadioGroup>
      );
    case 'checkbox':
      return <CheckboxGroup disabled direction="horizontal" options={optionList(field)} />;
    case 'switch':
      return <Switch disabled checked={field.defaultValue === true} size="small" />;
    case 'slider':
      return <Slider disabled min={field.min ?? 0} max={field.max ?? 100} value={typeof field.defaultValue === 'number' ? field.defaultValue : (field.min ?? 0)} />;
    case 'nps':
      return (
        <div className="fd-canvas-preview__nps">
          {Array.from({ length: 11 }, (_, i) => <span key={`nps-${i}`}>{i}</span>)}
        </div>
      );
    case 'tags':
      return <TagInput style={w} disabled placeholder={field.placeholder ?? '输入后回车添加'} />;
    case 'rate':
      return <Rating disabled count={field.rateMax ?? 5} value={0} />;
    case 'colorPicker':
      return <div className="fd-canvas-preview__color" style={{ background: typeof field.defaultValue === 'string' ? field.defaultValue : '#1677ff' }} />;
    case 'password':
      return <Input style={w} disabled mode="password" placeholder={placeholder} />;
    case 'pinCode':
      return <Input style={w} disabled placeholder={`${field.maxCount ?? 6} 位验证码`} />;
    case 'formula':
      return <Input style={w} disabled placeholder="按公式自动计算" suffix={field.unit || undefined} />;
    case 'serialNumber':
      return <Input style={w} disabled placeholder={`${field.serialPrefix ?? ''}自动生成`} />;
    case 'attachment':
      return <BlockPlaceholder icon={<Paperclip size={14} />} text={`上传附件（最多 ${field.maxCount ?? 5} 个）`} />;
    case 'image':
      return <BlockPlaceholder icon={<ImageIcon size={14} />} text={`上传图片（最多 ${field.maxCount ?? 5} 张）`} />;
    case 'signature':
      return <BlockPlaceholder icon={<PenTool size={14} />} text="手写签名区" />;
    case 'richtext':
      return <BlockPlaceholder icon={null} text="富文本编辑器" />;
    case 'description':
      return (
        <Typography.Text type="tertiary" size="small" style={{ whiteSpace: 'pre-wrap' }}>
          {field.description || '说明文字内容'}
        </Typography.Text>
      );
    default:
      return <Input style={w} disabled placeholder={placeholder} value={typeof field.defaultValue === 'string' ? field.defaultValue : undefined} />;
  }
}
