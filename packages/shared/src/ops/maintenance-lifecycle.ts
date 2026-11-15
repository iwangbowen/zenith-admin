/** Pure clock decision shared by worker and Demo; every execution re-reads the current open period. */
export function maintenanceClockAction(period: { status: string; scheduledStartAt: number | null; estimatedEndAt: number | null; autoEndAt: number | null; reminderSent: boolean; remindMinutes: number }, now: number): 'start' | 'finish' | 'cancel' | 'remind' | null {
  if (period.status === 'ongoing') return period.autoEndAt !== null && period.autoEndAt <= now ? 'finish' : null;
  if (period.status !== 'scheduled' || period.scheduledStartAt === null) return null;
  if (period.scheduledStartAt <= now) {
    if ((period.autoEndAt !== null && period.autoEndAt <= now) || (period.estimatedEndAt !== null && period.estimatedEndAt <= now)) return 'cancel';
    return 'start';
  }
  if (!period.reminderSent && period.remindMinutes > 0 && period.scheduledStartAt - now <= period.remindMinutes * 60_000) return 'remind';
  return null;
}
