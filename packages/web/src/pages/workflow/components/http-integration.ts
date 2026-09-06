import { Toast } from '@douyinfe/semi-ui';
import { abortSubmit } from '@/lib/abort-submit';

export function parseHeadersJson(
  text: string | undefined,
  options: Readonly<{ toastMessage?: string }> = {},
): Record<string, string> | undefined {
  if (!text?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not object');
    }
    return parsed as Record<string, string>;
  } catch {
    Toast.error(options.toastMessage ?? '请求头需为合法的 JSON 对象');
    abortSubmit('headers');
  }
}
