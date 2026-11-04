import { eq, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import type { DbExecutor } from '../../../db/types';
import { users } from '../../../db/schema';
import { currentUser } from '../../../lib/context';
import { tenantCondition } from '../../../lib/tenant';
import { buildWhere } from '../../../lib/where-helpers';

/** IDs must already belong to visible workflow records; batch projection exposes no management fields. */
export async function loadUserDisplays(ids: readonly number[], executor: DbExecutor = db) {
  const result = new Map<number, { name: string; avatar: string | null }>();
  const unique = [...new Set(ids)].filter(id => id > 0);
  if (!unique.length) return result;
  const rows = await executor.select({ id: users.id, nickname: users.nickname, username: users.username, avatar: users.avatar }).from(users).where(inArray(users.id, unique));
  for (const row of rows) result.set(row.id, { name: row.nickname ?? row.username, avatar: row.avatar ?? null });
  return result;
}

/** Tenant collaboration directory; cross-department routing intentionally ignores management data scope. */
export async function listSelectableUsers() {
  const rows = await db.query.users.findMany({ columns: { id: true, username: true, nickname: true, avatar: true },
    with: { department: { columns: { name: true } } },
    where: buildWhere(eq(users.status, 'enabled'), tenantCondition(users, currentUser())), orderBy: users.id });
  return rows.map(row => ({ id: row.id, username: row.username, nickname: row.nickname, avatar: row.avatar ?? null, departmentName: row.department?.name ?? null }));
}
