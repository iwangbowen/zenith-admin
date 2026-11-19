import dayjs from 'dayjs';
import type { WorkflowNodeConfig } from '@zenith/shared/workflow';

export function runtimeDelayWakeAt(config: WorkflowNodeConfig, form: Record<string, unknown>, now = new Date()): Date {
  if (config.delayType === 'toDate') {
    const raw = config.targetDate ? form[config.targetDate] : undefined;
    const value = raw ? dayjs(raw as string | number | Date) : null;
    return value?.isValid() ? value.toDate() : now;
  }
  const value = Number(config.delayValue ?? 0);
  return Number.isFinite(value) && value > 0 ? dayjs(now).add(value, config.delayUnit ?? 'hour').toDate() : now;
}
