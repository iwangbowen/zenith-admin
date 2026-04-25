import dayjs from 'dayjs';
import { DATE_FORMAT, DATE_TIME_FORMAT } from '@/utils/date';

type DateInput = Date | string | number;

export function mockDateTime(value: DateInput = new Date()): string {
  return dayjs(value).format(DATE_TIME_FORMAT);
}

export function mockDateTimeOffset(offsetMs: number): string {
  return mockDateTime(Date.now() + offsetMs);
}

export function mockDate(value: DateInput = new Date()): string {
  return dayjs(value).format(DATE_FORMAT);
}

export function mockDateOffset(offsetDays: number): string {
  return dayjs().add(offsetDays, 'day').format(DATE_FORMAT);
}

export function mockFileTimestamp(value: DateInput = new Date()): string {
  return dayjs(value).format('YYYYMMDD_HHmmss');
}
