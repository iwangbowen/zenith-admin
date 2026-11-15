import * as z from 'zod';

/** Reject date overflow rather than rolling February 31 into March. */
export function isMaintenanceDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}
export const maintenanceDateSchema = z.string().refine(isMaintenanceDate, '请输入有效时间 YYYY-MM-DD HH:mm:ss');
export const maintenanceContentSchema = z.object({
  message: z.string().trim().min(1, '请填写维护提示').max(512),
  estimatedEndAt: maintenanceDateSchema.nullable(),
});
export const updateMaintenanceSchema = maintenanceContentSchema.extend({
  autoEndAt: maintenanceDateSchema.nullable(),
  version: z.int().min(0), enabled: z.boolean(), reason: z.string().trim().min(1, '请填写操作原因').max(500),
});
export const maintenancePlanSchema = maintenanceContentSchema.extend({
  version: z.int().min(0), scheduledStartAt: maintenanceDateSchema, autoEndAt: maintenanceDateSchema.nullable(),
  reason: z.string().trim().min(1).max(500), notifyUserIds: z.array(z.int().positive()).max(100).default(() => []),
  remindMinutes: z.int().min(0).max(1440).default(15),
}).refine((value) => !value.estimatedEndAt || value.estimatedEndAt > value.scheduledStartAt, { path: ['estimatedEndAt'], message: '预计结束必须晚于开始时间' })
  .refine((value) => !value.autoEndAt || value.autoEndAt > value.scheduledStartAt, { path: ['autoEndAt'], message: '自动恢复必须晚于开始时间' });
export const maintenanceActionSchema = z.object({ version: z.int().min(0), reason: z.string().trim().min(1).max(500) });
export type UpdateMaintenanceInput = z.output<typeof updateMaintenanceSchema>;
