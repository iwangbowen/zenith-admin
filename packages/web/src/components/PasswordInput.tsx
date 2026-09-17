import type { ComponentProps } from 'react';
import { Input, withField } from '@douyinfe/semi-ui';

/**
 * 统一密码输入：默认掩码，并使用 Semi 自带的显隐按钮。
 * 所有密码 / 密钥字段都经此组件接入，避免各页面重复实现显隐状态。
 */
export type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'mode' | 'type'>;

export function PasswordInput(props: PasswordInputProps) {
  return <Input {...props} mode="password" />;
}

/** Form 内使用的密码字段，保留 field / rules / label 等表单能力。 */
export const FormPasswordInput = withField(PasswordInput, { maintainCursor: true });
