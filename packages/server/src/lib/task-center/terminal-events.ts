import { and, eq, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { asyncTasks, asyncTaskSubjects, type AsyncTaskRow } from '../../db/schema';
import { exactTenantCondition } from '../tenant';
import { recordDomainEvent } from '../../services/platform/relations/events.service';

const TERMINAL_EVENTS = {
  success: 'tasks.async-task.succeeded',
  failed: 'tasks.async-task.failed',
  cancelled: 'tasks.async-task.cancelled',
} as const;

/** The state transition and its safe business event either both commit or both roll back. */
export async function completeAsyncTasks(
  values: Partial<typeof asyncTasks.$inferInsert> & { status: keyof typeof TERMINAL_EVENTS; completedAt: Date },
  where: SQL | undefined,
): Promise<AsyncTaskRow[]> {
  if (!where) throw new Error('Task completion requires a state transition condition');
  return db.transaction(async (tx) => {
    const rows = await tx.update(asyncTasks).set(values).where(where).returning();
    for (const row of rows) {
      const subjects = await tx.select({ type: asyncTaskSubjects.entityType, key: asyncTaskSubjects.entityKey, role: asyncTaskSubjects.role })
        .from(asyncTaskSubjects).where(and(eq(asyncTaskSubjects.taskId, row.id), exactTenantCondition(asyncTaskSubjects.tenantId, row.tenantId)));
      const source = { type: 'tasks.async', key: String(row.id) } as const;
      await recordDomainEvent(tx, {
        eventType: TERMINAL_EVENTS[values.status],
        payload: { taskType: row.taskType, status: values.status, attempt: row.attempts },
        subjects: subjects.length ? subjects : [{ ...source, role: 'primary' }],
        source, tenantId: row.tenantId, traceId: row.traceId, parentRef: row.parentRef,
        // A manual restart resets attempts; the persisted completion time separates execution rounds.
        dedupeKey: `async-task:${row.id}:${values.status}:${row.attempts}:${row.completedAt!.getTime()}`,
      });
    }
    return rows;
  });
}
