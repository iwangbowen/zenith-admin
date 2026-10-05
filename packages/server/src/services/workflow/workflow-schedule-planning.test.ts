import { describe, expect, it } from 'vitest';
import type { WorkflowScheduleRow } from '../../db/schema';
import { planWorkflowScheduleUpdate, computeWorkflowScheduleNextRun } from './workflow-schedule-planning';

const now = new Date('2026-10-05T11:01:03Z');
const due = new Date('2026-10-05T11:01:00Z');
const existing = {
  id: 2, cronExpression: '* * * * *', timezone: 'Asia/Shanghai', status: 'enabled', nextRunAt: due,
} as WorkflowScheduleRow;

describe('workflow schedule edits preserve due occurrences', () => {
  it.each([
    { name: '新名称' }, { formData: { quantity: 15 } }, { titleTemplate: '新标题' },
    { initiatorId: 9 }, { definitionId: 10 }, {},
    { cronExpression: '* * * * *', timezone: 'Asia/Shanghai', status: 'enabled', name: '新名称' },
    { cronExpression: '  *   * * * * ', timezone: null, status: 'enabled' },
  ])('does not reschedule unrelated or same-value form saves: %j', (input) => {
    const { patch, preserveDue } = planWorkflowScheduleUpdate(existing, input, now);
    expect(patch).not.toHaveProperty('nextRunAt');
    expect(preserveDue).toBe(false);
  });

  it('retains a due original occurrence before applying a new frequency', () => {
    const plan = planWorkflowScheduleUpdate(existing, { cronExpression: '0 9 1 * *' }, now);
    expect(plan.preserveDue).toBe(true);
    expect(plan.patch.nextRunAt).toEqual(new Date('2026-11-01T01:00:00Z'));
  });

  it('timezone changes also preserve the already-due old timezone occurrence', () => {
    const plan = planWorkflowScheduleUpdate(existing, { timezone: 'America/New_York' }, now);
    expect(plan.preserveDue).toBe(true);
    expect(plan.patch.nextRunAt).toEqual(new Date('2026-10-05T11:02:00Z'));
  });

  it('a future occurrence is replaced only when the effective expression changes', () => {
    const plan = planWorkflowScheduleUpdate({ ...existing, nextRunAt: new Date('2026-10-05T12:00:00Z') }, { cronExpression: '0 * * * *' }, now);
    expect(plan.preserveDue).toBe(false);
    expect(plan.patch.nextRunAt).toEqual(new Date('2026-10-05T12:00:00Z'));
  });

  it('disable clears the future plan, while enabling computes a new future due time', () => {
    const disabled = planWorkflowScheduleUpdate(existing, { status: 'disabled' }, now);
    expect(disabled.patch.nextRunAt).toBeNull();
    expect(disabled.preserveDue).toBe(false);
    const enabled = planWorkflowScheduleUpdate({ ...existing, status: 'disabled', nextRunAt: null }, { status: 'enabled' }, now);
    expect(enabled.patch.nextRunAt).toEqual(new Date('2026-10-05T11:02:00Z'));
  });

  it('cron edits to a disabled rule keep it without an automatic plan', () => {
    const plan = planWorkflowScheduleUpdate({ ...existing, status: 'disabled', nextRunAt: null }, { cronExpression: '0 9 1 * *' }, now);
    expect(plan.patch).not.toHaveProperty('nextRunAt');
    expect(plan.preserveDue).toBe(false);
  });

  it('rejects an invalid changed expression without producing any update', () => {
    expect(() => planWorkflowScheduleUpdate(existing, { cronExpression: 'invalid' }, now)).toThrow('cron 表达式或时区无效');
  });

  it('advances catch-up from the original scheduled time rather than now', () => {
    expect(computeWorkflowScheduleNextRun(existing.cronExpression, existing.timezone, due)).toEqual(new Date('2026-10-05T11:02:00Z'));
    const late = new Date('2026-10-05T11:10:03Z');
    expect(computeWorkflowScheduleNextRun(existing.cronExpression, existing.timezone, due)!.getTime()).toBeLessThan(late.getTime());
  });
});
