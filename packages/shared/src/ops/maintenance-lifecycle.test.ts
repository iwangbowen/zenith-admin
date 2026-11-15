import { describe, expect, it } from 'vitest';
import { maintenanceClockAction } from './maintenance-lifecycle';
describe('maintenance clock transitions', () => {
  const plan = { status: 'scheduled', scheduledStartAt: 100_000, estimatedEndAt: null, autoEndAt: null, reminderSent: false, remindMinutes: 1 };
  it('reminds once and starts only when due', () => {
    expect(maintenanceClockAction(plan, 30_000)).toBeNull();
    expect(maintenanceClockAction(plan, 50_000)).toBe('remind');
    expect(maintenanceClockAction({ ...plan, reminderSent: true }, 50_000)).toBeNull();
    expect(maintenanceClockAction(plan, 100_000)).toBe('start');
  });
  it('skips missed windows instead of enabling stale maintenance after restart', () => {
    expect(maintenanceClockAction({ ...plan, estimatedEndAt: 150_000 }, 160_000)).toBe('cancel');
    expect(maintenanceClockAction({ ...plan, autoEndAt: 150_000 }, 160_000)).toBe('cancel');
  });
  it('estimated end never opens an ongoing maintenance window', () => {
    expect(maintenanceClockAction({ ...plan, status: 'ongoing', estimatedEndAt: 150_000 }, 160_000)).toBeNull();
    expect(maintenanceClockAction({ ...plan, status: 'ongoing', autoEndAt: 150_000 }, 160_000)).toBe('finish');
    expect(maintenanceClockAction({ ...plan, status: 'completed', autoEndAt: 150_000 }, 160_000)).toBeNull();
  });
});
