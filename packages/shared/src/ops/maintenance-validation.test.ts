import { describe, expect, it } from 'vitest';
import { isMaintenanceDate, maintenancePlanSchema, updateMaintenanceSchema } from './maintenance-validation';
describe('maintenance input rules', () => {
  it.each(['2026-02-31 00:00:00', '2026-01-01 24:00:00', 'not-a-date', '2026-13-01 00:00:00'])('rejects %s', (value) => expect(isMaintenanceDate(value)).toBe(false));
  it('accepts leap dates and requires version, content and reason', () => {
    expect(isMaintenanceDate('2028-02-29 23:59:59')).toBe(true);
    expect(updateMaintenanceSchema.safeParse({ enabled: true, message: '   ', version: 0, reason: 'update', estimatedEndAt: null }).success).toBe(false);
    expect(updateMaintenanceSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(updateMaintenanceSchema.safeParse({ enabled: true, message: '维护', version: 0, reason: 'update', estimatedEndAt: null, autoEndAt: null }).success).toBe(true);
  });
  it('never turns an estimated end into automatic recovery', () => {
    const parsed = maintenancePlanSchema.parse({ version: 0, message: '升级', reason: '测试', scheduledStartAt: '2030-01-01 01:00:00', estimatedEndAt: '2030-01-01 02:00:00', autoEndAt: null });
    expect(parsed.autoEndAt).toBeNull();
    expect(maintenancePlanSchema.safeParse({ ...parsed, autoEndAt: '2029-01-01 00:00:00' }).success).toBe(false);
  });
});
