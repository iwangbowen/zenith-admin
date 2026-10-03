import { and, eq, gte, inArray, notExists, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import { asyncTasks } from '../../db/schema';
import { HEARTBEAT_STALE_MS } from '../task-center/types';

export const ORPHAN_GRACE_MS = 2 * 60_000;

/** Pending executor tasks are alive; only running tasks require a recent heartbeat. */
export function orphanTaskCondition(taskIdColumn: AnyPgColumn | SQL, asOf = new Date()) {
  const heartbeatCutoff = new Date(asOf.getTime() - HEARTBEAT_STALE_MS);
  return notExists(db.select({ id: asyncTasks.id }).from(asyncTasks).where(and(
    eq(asyncTasks.id, taskIdColumn),
    or(eq(asyncTasks.status, 'pending'), and(eq(asyncTasks.status, 'running'),
      gte(sql`coalesce(${asyncTasks.heartbeatAt}, ${asyncTasks.updatedAt})`, heartbeatCutoff.toISOString()))),
  )));
}

export interface OrphanRunOptions {
  table: AnyPgTable; statusColumn: AnyPgColumn; activeStatuses: readonly string[];
  taskIdColumn: AnyPgColumn | SQL; startedAtColumn: AnyPgColumn | SQL;
  graceMs?: number; asOf?: Date;
}

/** A correlated anti-join uses the task primary key and is reusable by counts and lists. */
export function orphanRunCondition(options: OrphanRunOptions) {
  const now = options.asOf ?? new Date();
  return and(inArray(options.statusColumn, [...options.activeStatuses]),
    sql`${options.startedAtColumn} < ${sql.param(new Date(now.getTime() - (options.graceMs ?? ORPHAN_GRACE_MS)), asyncTasks.updatedAt)}`,
    orphanTaskCondition(options.taskIdColumn, now));
}

export async function countOrphanRuns(options: OrphanRunOptions) {
  return db.$count(options.table, orphanRunCondition(options));
}
