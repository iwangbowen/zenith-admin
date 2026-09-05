import { Toast } from '@douyinfe/semi-ui';
import { SEND_SOURCE_OPTIONS, SEND_STATUS_OPTIONS } from '@zenith/shared/messaging';
import type { SendStatus } from '@zenith/shared/messaging';
import { abortSubmit } from '@/lib/abort-submit';

const SEND_STATUS_COLORS: Record<SendStatus, 'orange' | 'green' | 'red'> = {
  pending: 'orange',
  success: 'green',
  failed: 'red',
};

export const SEND_LOG_STATUS_OPTIONS = SEND_STATUS_OPTIONS.map((option) => ({
  ...option,
  color: SEND_STATUS_COLORS[option.value],
}));

export { SEND_SOURCE_OPTIONS };

/**
 * 测试发送表单的「变量」输入是 JSON 文本，接口要求 `Record<string, string>`；
 * 留空视为未填，非 JSON 对象时提示并中断提交。
 */
export function parseTemplateVariables(raw: string | undefined): Record<string, string> | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    Toast.error('变量 JSON 格式错误');
    abortSubmit();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    Toast.error('变量必须是 JSON 对象');
    abortSubmit();
  }
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]));
}