import { eq } from 'drizzle-orm';
import { asyncTasks } from '../../db/schema';
import { runWithCurrentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { anchorIdsWhere, numericAnchorResolver } from '../platform/relations/anchor-batch';
import type { EntityAnchorResolver, RelationAccessContext, VisibleEntityAnchor } from '../platform/relations/types';
import { resolveAsyncTaskAccessScope } from './public/access';

async function resolveAsyncTasks(ids: number[], access: RelationAccessContext): Promise<VisibleEntityAnchor[]> {
  return runWithCurrentUser(access.user, async () => {
    const scope = await resolveAsyncTaskAccessScope();
    const rows = await access.db.select({ id: asyncTasks.id, title: asyncTasks.title, tenantId: asyncTasks.tenantId })
      .from(asyncTasks).where(buildWhere(anchorIdsWhere(asyncTasks.id, ids), tenantCondition(asyncTasks, access.user),
        scope.global ? undefined : eq(asyncTasks.createdBy, scope.userId))).limit(ids.length);
    return rows.map((row): VisibleEntityAnchor => ({ ref: { type: 'tasks.async', key: String(row.id) }, title: row.title, tenantId: row.tenantId }));
  });
}

export const taskAnchorResolvers: readonly EntityAnchorResolver[] = [numericAnchorResolver('tasks.async', resolveAsyncTasks)];
