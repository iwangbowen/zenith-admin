import type { ComponentProps, ReactNode } from 'react';
import { Form } from '@douyinfe/semi-ui';
import { useDictItems } from '@/hooks/useDictItems';

interface FormStatusRadioGroupProps {
  field?: string;
  label?: string;
  disabled?: boolean;
  /** Semi RadioGroup 外观（默认圆点，`button` 为按钮组） */
  type?: 'default' | 'button' | 'card' | 'pureCard';
  /** 字段下方的说明文字 */
  extraText?: ReactNode;
  /** 透传给 Form.RadioGroup 的校验规则 */
  rules?: ComponentProps<typeof Form.RadioGroup>['rules'];
}

/**
 * 通用启用 / 禁用单选组：选项与文案来自字典 `common_status`，
 * 与筛选栏 `StatusSelect`、状态标签同源；页面内禁止再写「启用 / 停用」字面量选项。
 */
export function FormStatusRadioGroup({ field = 'status', label = '状态', disabled, type, extraText, rules }: Readonly<FormStatusRadioGroupProps>) {
  const { items } = useDictItems('common_status');
  return (
    <Form.RadioGroup field={field} label={label} disabled={disabled} type={type} extraText={extraText} rules={rules}>
      {items.map((item) => (
        <Form.Radio key={item.value} value={item.value}>{item.label}</Form.Radio>
      ))}
    </Form.RadioGroup>
  );
}

export default FormStatusRadioGroup;
