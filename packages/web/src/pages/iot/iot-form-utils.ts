import { Toast } from '@douyinfe/semi-ui';
import { abortSubmit } from '@/lib/abort-submit';

type EmptyJsonValue = 'undefined' | 'null';
type JsonToastSeverity = 'warning' | 'error' | false;

export interface ParseJsonObjectInputOptions<TEmpty extends EmptyJsonValue = EmptyJsonValue> {
  text: string | undefined | null;
  label: string;
  empty: TEmpty;
  toast: JsonToastSeverity;
  abort?: boolean;
  objectMessage?: string;
  invalidJsonMessage?: string;
  errorMessage?: string;
}

type ParseJsonObjectInputResult<TEmpty extends EmptyJsonValue> =
  TEmpty extends 'null' ? Record<string, unknown> | null : Record<string, unknown> | undefined;

function showJsonToast(toast: JsonToastSeverity, message: string) {
  if (toast === 'warning') Toast.warning(message);
  if (toast === 'error') Toast.error(message);
}

export function parseJsonObjectInput<TEmpty extends EmptyJsonValue>({
  text,
  label,
  empty,
  toast,
  abort = false,
  objectMessage,
  invalidJsonMessage,
  errorMessage,
}: ParseJsonObjectInputOptions<TEmpty>): ParseJsonObjectInputResult<TEmpty> {
  const trimmed = text?.trim();
  if (!trimmed) {
    return (empty === 'null' ? null : undefined) as ParseJsonObjectInputResult<TEmpty>;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortSubmitError') throw err;
    if (abort) {
      showJsonToast(toast, invalidJsonMessage ?? `${label} 不是合法 JSON`);
      abortSubmit();
    }
    showJsonToast(toast, objectMessage ?? `${label} 需为 JSON 对象，如 {"power":"on"}`);
    throw new Error(errorMessage ?? `invalid ${label}`, { cause: err });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    showJsonToast(toast, objectMessage ?? `${label} 需为 JSON 对象`);
    if (abort) abortSubmit();
    throw new Error(errorMessage ?? `invalid ${label}`);
  }
  return parsed as ParseJsonObjectInputResult<TEmpty>;
}

export function jsonObjectToText(value: Record<string, unknown> | null | undefined, { pretty = false }: { pretty?: boolean } = {}): string {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value, null, pretty ? 2 : undefined) : '';
}

export function formatIotDateTime(value: string | Date | undefined | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

// CronBuilderPopover edits six-field expressions; some IoT APIs persist five-field cron strings.
export function toSixFieldCron(expr: string): string {
  const value = (expr ?? '').trim();
  return value.split(/\s+/).length === 5 ? `0 ${value}` : value;
}

export function toFiveFieldCron(expr: string): string {
  const value = (expr ?? '').trim();
  const parts = value.split(/\s+/);
  return parts.length === 6 ? parts.slice(1).join(' ') : value;
}
