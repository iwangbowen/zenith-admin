import dayjs from 'dayjs';
import { HTTPException } from 'hono/http-exception';
import { DATE_TIME_FORMAT } from '../../lib/datetime';

/** Wall-clock input is interpreted in the explicitly selected IANA zone. */
export function resolveCmsReleaseActivationTime(value: string | null | undefined, timeZone: string): Date | null {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    const parsed = dayjs.tz(value, DATE_TIME_FORMAT, timeZone);
    if (!parsed.isValid() || parsed.format(DATE_TIME_FORMAT) !== value) throw new Error('nonexistent local time');
    return parsed.toDate();
  } catch {
    throw new HTTPException(400, { message: '排期时间在所选时区中不存在或格式不正确，请检查夏令时转换' });
  }
}
export function formatCmsReleaseActivationTime(value: Date | null, timeZone: string): string | null {
  return value ? dayjs(value).tz(timeZone).format(DATE_TIME_FORMAT) : null;
}
