import type { ComponentProps } from 'react';
import { Button, Form, Space, Tooltip, Typography, useFormApi } from '@douyinfe/semi-ui';
import { Eye, EyeOff, PencilLine, Undo2 } from 'lucide-react';
import type { SensitiveFormFieldsControl } from '@/hooks/useSensitiveFormFields';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { useRevealedValue } from './useRevealedValue';

type FormInputProps = ComponentProps<typeof Form.Input>;

export interface SensitiveFormInputProps extends Omit<FormInputProps, 'field' | 'label'> {
  /** `useSensitiveFormFields()` 的返回值 */
  control: SensitiveFormFieldsControl<{ id: number }>;
  field: string;
  label: string;
}

/**
 * 编辑表单里的敏感字段输入框。
 *
 * - 值对当前用户是掩码时默认**锁定**：展示掩码 + 「查看明文」（需权限，逐次审计）+ 「修改」
 * - 点「修改」后变成普通输入框（起始为空，若已查看明文则带入明文），可「取消修改」恢复锁定
 * - 新增、或用户本就能看到明文时，与普通 `Form.Input` 行为一致
 */
export function SensitiveFormInput({ control, field, label, ...inputProps }: SensitiveFormInputProps) {
  const formApi = useFormApi();
  const recordId = control.record?.id ?? 0;
  const reveal = useRevealedValue({ entity: control.entity, id: recordId, field });
  const maskedValue = (control.record as Record<string, unknown> | null)?.[field];
  const maskedText = typeof maskedValue === 'string' && maskedValue ? maskedValue : EMPTY_PLACEHOLDER;

  if (control.isLocked(field)) {
    const text = reveal.revealed ?? maskedText;
    return (
      <Form.Slot label={label}>
        <Space spacing={4} wrap className="sensitive-form-locked">
          <Typography.Text className="sensitive-form-locked__value">{text}</Typography.Text>
          {reveal.canReveal && (
            reveal.revealed === null ? (
              <Tooltip content="查看明文（记录审计）">
                <Button size="small" theme="borderless" type="tertiary" icon={<Eye size={14} />} loading={reveal.revealing} aria-label="查看明文" onClick={() => void reveal.show()} />
              </Tooltip>
            ) : (
              <Tooltip content="收起明文">
                <Button size="small" theme="borderless" type="tertiary" icon={<EyeOff size={14} />} aria-label="收起明文" onClick={reveal.hide} />
              </Tooltip>
            )
          )}
          <Button
            size="small"
            theme="borderless"
            icon={<PencilLine size={14} />}
            onClick={() => {
              control.unlock(field);
              formApi.setValue(field, reveal.revealed ?? '');
            }}
          >
            修改
          </Button>
        </Space>
      </Form.Slot>
    );
  }

  const unlocked = control.isUnlocked(field);
  return (
    <Form.Input
      {...inputProps}
      field={field}
      label={label}
      extraText={unlocked ? (
        <Space spacing={4}>
          <Typography.Text type="tertiary" size="small">留空则保持原值不变</Typography.Text>
          <Button size="small" theme="borderless" type="tertiary" icon={<Undo2 size={12} />} onClick={() => { control.relock(field); formApi.setValue(field, maskedValue); }}>取消修改</Button>
        </Space>
      ) : inputProps.extraText}
    />
  );
}
