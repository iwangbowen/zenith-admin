import { CronExpressionParser } from 'cron-parser';
import { HTTPException } from 'hono/http-exception';
import type { UpdateWorkflowScheduleInput } from '@zenith/shared/workflow';
import type { WorkflowScheduleRow, NewWorkflowSchedule } from '../../db/schema';
import { APP_TIME_ZONE } from '../../lib/datetime';

export const WORKFLOW_SCHEDULE_DEFAULT_TZ = APP_TIME_ZONE;

export function computeWorkflowScheduleNextRun(cron: string, timezone?: string | null, from = new Date()): Date | null {
  try {
    return CronExpressionParser.parse(cron.trim(), {
      currentDate: from, tz: timezone?.trim() || WORKFLOW_SCHEDULE_DEFAULT_TZ,
    }).next().toDate();
  } catch {
    return null;
  }
}

/** Compare effective values, since edit forms submit unchanged cron/timezone/status too. */
export function planWorkflowScheduleUpdate(existing: WorkflowScheduleRow, input: UpdateWorkflowScheduleInput, now = new Date()) {
  const patch: Partial<NewWorkflowSchedule> = {};
  if (input.definitionId !== undefined) patch.definitionId = input.definitionId;
  if (input.name !== undefined) patch.name = input.name;
  if (input.initiatorId !== undefined) patch.initiatorId = input.initiatorId;
  if (input.titleTemplate !== undefined) patch.titleTemplate = input.titleTemplate ?? null;
  if (input.formData !== undefined) patch.formData = input.formData ?? null;
  const normalizeCron = (value: string) => value.trim().split(/\s+/).join(' ');
  const nextCron = normalizeCron(input.cronExpression ?? existing.cronExpression);
  const nextTimezone = input.timezone !== undefined ? input.timezone?.trim() || null : existing.timezone;
  const nextStatus = input.status ?? existing.status;
  const expressionChanged = nextCron !== normalizeCron(existing.cronExpression)
    || (nextTimezone || WORKFLOW_SCHEDULE_DEFAULT_TZ) !== (existing.timezone || WORKFLOW_SCHEDULE_DEFAULT_TZ);
  const statusChanged = nextStatus !== existing.status;
  const nextRun = expressionChanged || (statusChanged && nextStatus === 'enabled')
    ? computeWorkflowScheduleNextRun(nextCron, nextTimezone, now) : undefined;
  if (nextRun === null) throw new HTTPException(400, { message: 'cron 表达式或时区无效' });
  if (input.cronExpression !== undefined) patch.cronExpression = nextCron;
  if (input.timezone !== undefined) patch.timezone = nextTimezone;
  if (input.status !== undefined) patch.status = nextStatus;
  if (nextStatus === 'disabled' && statusChanged) patch.nextRunAt = null;
  else if (nextStatus === 'enabled' && (expressionChanged || statusChanged)) patch.nextRunAt = nextRun!;
  // A changed future plan must not silently erase the old, already-due occurrence.
  const preserveDue = expressionChanged && existing.status === 'enabled' && nextStatus === 'enabled'
    && existing.nextRunAt !== null && existing.nextRunAt.getTime() <= now.getTime();
  return { patch, preserveDue };
}
